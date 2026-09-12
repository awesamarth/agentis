import { x402Client } from '@x402/core/client'
import { ExactSvmScheme } from '@x402/svm/exact/client'
import { DEFAULT_COMPUTE_UNIT_LIMIT, DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS, MEMO_PROGRAM_ADDRESS, MAX_MEMO_BYTES } from '@x402/svm'
import { address, createKeyPairSignerFromBytes, getCompiledTransactionMessageDecoder, decompileTransactionMessage, getBase58Decoder, getTransactionDecoder, type TransactionPartialSigner } from '@solana/kit'
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, getTransferCheckedInstructionDataEncoder } from '@solana-program/token'
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget'
import { Connection, PublicKey } from '@solana/web3.js'
import { solanaDevnet, solanaUsdc } from '@agentis-hq/core/solana-transfer'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import { deriveSolanaKey, type LocalWallet } from './local-wallet'
import { solanaGenesis } from './local-networks'
import { signWithPolicy } from './local-policy'
const equal = (a: ArrayLike<number>, b: ArrayLike<number>) => Buffer.from(a).equals(Buffer.from(b))
const rpcUrl = () => process.env.SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com'
const connection = () => new Connection(rpcUrl(), { commitment: 'confirmed', fetch: ((url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) })) as typeof fetch })
export type SolanaProof = { source: string; destination: string; fromSlot: string; message: string; payerSignature: string }
export async function prepareLocalSvm(wallet: LocalWallet, key: string, url: string, requirements: PaymentRequirements): Promise<{ payload: PaymentPayload; proof: SolanaProof }> {
  const rpc = connection()
  if (await rpc.getGenesisHash() !== solanaGenesis) throw Error('Not Solana devnet')
  const native = await createKeyPairSignerFromBytes((await deriveSolanaKey(wallet.mnemonic)).secretKey)
  if (native.address !== wallet.addresses.solana || requirements.extra?.feePayer === native.address || requirements.payTo === native.address || !requirements.extra?.feePayer) throw Error('Invalid Solana payment signer/recipient')
  const [source] = await findAssociatedTokenPda({ mint: address(solanaUsdc), owner: native.address, tokenProgram: TOKEN_PROGRAM_ADDRESS })
  const [destination] = await findAssociatedTokenPda({ mint: address(solanaUsdc), owner: address(requirements.payTo), tokenProgram: TOKEN_PROGRAM_ADDRESS })
  const fromSlot = String(await rpc.getSlot())
  let message = '', payerSignature = '', attempted = false
  const signer: TransactionPartialSigner = { address: native.address, async signTransactions(transactions) {
    if (attempted || transactions.length !== 1) throw Error('Only one payment signature allowed')
    attempted = true
    const transaction = transactions[0]!, compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
    if (compiled.version !== 0 || compiled.addressTableLookups?.length || compiled.header.numSignerAccounts !== 2 || compiled.header.numReadonlySignerAccounts !== 1 || compiled.staticAccounts[0] !== requirements.extra!.feePayer || compiled.staticAccounts[1] !== native.address) throw Error('Unexpected Solana signers or lookup tables')
    const ix = decompileTransactionMessage(compiled).instructions
    const budget = [getSetComputeUnitLimitInstruction({ units: DEFAULT_COMPUTE_UNIT_LIMIT }), getSetComputeUnitPriceInstruction({ microLamports: DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS })]
    if (ix.length !== 4 || budget.some((expected, i) => ix[i]!.programAddress !== expected.programAddress || (ix[i]!.accounts?.length ?? 0) !== 0 || !equal(ix[i]!.data ?? [], expected.data))) throw Error('Unexpected Solana instructions')
    const transfer = ix[2]!, memo = ix[3]!, accounts = [source, address(solanaUsdc), destination, native.address]
    if (transfer.programAddress !== TOKEN_PROGRAM_ADDRESS || transfer.accounts?.length !== 4 || transfer.accounts.some((a, i) => a.address !== accounts[i]) || !equal(transfer.data ?? [], getTransferCheckedInstructionDataEncoder().encode({ amount: BigInt(requirements.amount), decimals: 6 }))) throw Error('Solana transfer differs from requested terms')
    if (memo.programAddress !== MEMO_PROGRAM_ADDRESS || memo.accounts?.length || !memo.data || memo.data.length > MAX_MEMO_BYTES || (requirements.extra?.memo ? !equal(memo.data, Buffer.from(String(requirements.extra.memo))) : !/^[0-9a-f]{32}$/.test(Buffer.from(memo.data).toString()))) throw Error('Unexpected Solana memo')
    if (!(await rpc.isBlockhashValid(compiled.lifetimeToken as Parameters<typeof rpc.isBlockhashValid>[0])).value) throw Error('Expired blockhash')
    const signatures = await signWithPolicy(wallet.id, key, () => native.signTransactions(transactions))
    if (!signatures[0]?.[native.address]) throw Error('Missing payer signature')
    message = Buffer.from(transaction.messageBytes).toString('base64'); payerSignature = getBase58Decoder().decode(signatures[0][native.address]!)
    return signatures
  } }
  const client = new x402Client().register(solanaDevnet, new ExactSvmScheme(signer, { rpcUrl: rpcUrl() }))
  client.setSpendControls({ allowedAssets: [{ network: solanaDevnet, asset: solanaUsdc, maxAmountPerPayment: requirements.amount }] })
  const payload = await client.createPaymentPayload({ x402Version: 2, resource: { url }, accepts: [requirements] })
  const wire = getTransactionDecoder().decode(Buffer.from((payload.payload as { transaction: string }).transaction, 'base64'))
  if (!message || !payerSignature || Buffer.from(wire.messageBytes).toString('base64') !== message || !wire.signatures[native.address] || getBase58Decoder().decode(wire.signatures[native.address]!) !== payerSignature) throw Error('Unexpected signed payment payload')
  return { payload, proof: { source, destination, fromSlot, message, payerSignature } }
}
export async function localSvmReceipt(proof: SolanaProof, amountAtomic: string, hash?: string) {
  const rpc = connection()
  if (await rpc.getGenesisHash() !== solanaGenesis) throw Error('Wrong Solana network')
  let before: Parameters<typeof rpc.getTransaction>[0] | undefined
  while (true) {
    const candidates = hash ? [{ signature: hash as Parameters<typeof rpc.getTransaction>[0], slot: BigInt(proof.fromSlot) }] : await rpc.getSignaturesForAddress(new PublicKey(proof.source), { limit: 100, before })
    for (const candidate of candidates) {
      if (BigInt(candidate.slot) < BigInt(proof.fromSlot)) return null
      const tx = await rpc.getTransaction(candidate.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      if (!tx?.meta) continue
      if (Buffer.from(tx.transaction.message.serialize()).toString('base64') !== proof.message || String(tx.transaction.signatures[1]) !== proof.payerSignature) { if (hash) throw Error('Wrong settlement transaction'); continue }
      const keys = tx.transaction.message.getAccountKeys()
      const balance = (balances: typeof tx.meta.preTokenBalances, account: string) => balances?.find(b => keys.get(b.accountIndex)?.toBase58() === account && b.mint === solanaUsdc)?.uiTokenAmount.amount
      if (!tx.meta.err) {
        const a = balance(tx.meta.preTokenBalances, proof.source), b = balance(tx.meta.postTokenBalances, proof.source), c = balance(tx.meta.preTokenBalances, proof.destination), d = balance(tx.meta.postTokenBalances, proof.destination)
        if ([a,b,c,d].some(v => v === undefined) || BigInt(a!) - BigInt(b!) !== BigInt(amountAtomic) || BigInt(d!) - BigInt(c!) !== BigInt(amountAtomic)) throw Error('Wrong settled amount')
      }
      return { hash: String(candidate.signature), success: !tx.meta.err, fee: '0' }
    }
    if (hash || candidates.length < 100) return null
    const next = candidates[candidates.length - 1]!.signature
    if (before === next) throw Error('History pagination did not advance')
    before = next
  }
}
