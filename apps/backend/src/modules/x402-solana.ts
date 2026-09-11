import { x402Client } from '@x402/core/client'
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http'
import type { PaymentPayload } from '@x402/core/types'
import { ExactSvmScheme } from '@x402/svm/exact/client'
import { DEFAULT_COMPUTE_UNIT_LIMIT, DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS, MEMO_PROGRAM_ADDRESS, MAX_MEMO_BYTES } from '@x402/svm'
import { createSolanaKitSigner } from '@privy-io/node/solana-kit'
import type { PrivyClient } from '@privy-io/node'
import { address, getCompiledTransactionMessageDecoder, decompileTransactionMessage, getPublicKeyFromAddress, verifySignature, getBase58Decoder, getTransactionDecoder, type TransactionPartialSigner } from '@solana/kit'
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, getTransferCheckedInstructionDataEncoder } from '@solana-program/token'
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget'
import { PublicKey } from '@solana/web3.js'
import { x402Payment, type FetchRequest, type OperationInput, type Operation, type PaidHttpResponse } from '@agentis-hq/core/operations'
import type { WalletRow } from '../db/schema'
import { solanaConnection, solanaDevnet, solanaUsdc } from './solana'
import { paymentHttp } from './payment-http'
import { settlementHeaders, type SavePaymentHash } from './x402-settlement'
import { fail } from '../errors'

const origins = () => (process.env.AGENTIS_PAID_FETCH_LOCAL_ORIGINS ?? '').split(',').filter(Boolean)
const rpcUrl = () => process.env.SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com'
const equalBytes = (a: ArrayLike<number>, b: ArrayLike<number>) => Buffer.from(a).equals(Buffer.from(b))
export async function discoverSvm(input: FetchRequest): Promise<OperationInput> {
  let response
  try { response = await paymentHttp({ url: input.url, method: 'GET', headers: {} }, {}, origins()) }
  catch { fail(400, 'paid_fetch_unavailable', 'Paid URL was blocked or unavailable; no payment was created') }
  if (response.status !== 402 || !response.headers['payment-required']) fail(400, 'x402_required', 'Expected an x402 payment challenge')
  let challenge
  try { challenge = decodePaymentRequiredHeader(response.headers['payment-required']) } catch { fail(400, 'invalid_challenge', 'Invalid x402 challenge') }
  if (challenge.x402Version !== 2 || !Array.isArray(challenge.accepts)) fail(400, 'invalid_challenge', 'Expected x402 v2')
  const selected = challenge.accepts.find(r => r.network === solanaDevnet && r.scheme === 'exact' && r.asset === solanaUsdc && typeof r.extra?.feePayer === 'string')
  if (!selected) fail(400, 'unsupported_payment', 'Expected sponsored Solana devnet USDC x402')
  const payment = x402Payment.parse({ url: input.url, maxAmountAtomic: input.maxAmountAtomic, requirements: { ...selected, extra: { feePayer: selected.extra!.feePayer, ...(selected.extra!.memo ? { memo: selected.extra!.memo } : {}) } } })
  if (BigInt(selected.amount) > BigInt(input.maxAmountAtomic) || BigInt(selected.amount) > (1n << 64n) - 1n) fail(409, 'price_limit', 'Seller price exceeds the payment ceiling')
  return { walletId: input.walletId, action: 'paid_fetch', chainId: solanaDevnet, asset: `spl:${solanaUsdc}`, to: address(selected.payTo), amountAtomic: selected.amount, maxFeeAtomic: '0', reason: input.reason ?? '', payment }
}
export function validateSvm(wallet: WalletRow, input: OperationInput) {
  const p = input.payment
  if (!p || input.mpp || input.action !== 'paid_fetch' || wallet.chainId !== solanaDevnet || input.chainId !== solanaDevnet || input.asset !== `spl:${solanaUsdc}` || input.maxFeeAtomic !== '0' || p.requirements.network !== solanaDevnet || p.requirements.asset !== solanaUsdc || p.requirements.scheme !== 'exact' || p.requirements.payTo !== input.to || p.requirements.amount !== input.amountAtomic || BigInt(input.amountAtomic) > BigInt(p.maxAmountAtomic) || !('feePayer' in p.requirements.extra) || p.requirements.extra.feePayer === wallet.address || input.to === wallet.address) throw new Error('Solana payment terms differ from approval')
  return p.requirements.extra
}
type SignedPayment = { input: OperationInput; payer: string; source: string; destination: string; fromSlot: string; message: string; payerSignature: string; payload: PaymentPayload }
export function createPrivySvm(privy: PrivyClient, authorizationKey: string, inspect: (id: string, owner: string) => Promise<{ address: string; serverAuthorized?: boolean }>) {
  return {
    async prepare(wallet: WalletRow, input: OperationInput, execution: { id: string; expiresAt: Date }) {
      const extra = validateSvm(wallet, input)
      if (Date.now() + 120_000 >= execution.expiresAt.getTime()) throw new Error('Not enough approval time remains')
      const owned = await inspect(wallet.providerWalletId, wallet.ownerId)
      if (!owned.serverAuthorized || owned.address !== wallet.address) throw new Error('Wallet ownership changed')
      const connection = solanaConnection(rpcUrl())
      if (!(await connection.getGenesisHash()).startsWith(solanaDevnet.slice(7))) throw new Error('RPC is not Solana devnet')
      const fromSlot = String(await connection.getSlot())
      const [source] = await findAssociatedTokenPda({ mint: address(solanaUsdc), owner: address(wallet.address), tokenProgram: TOKEN_PROGRAM_ADDRESS })
      const [destination] = await findAssociatedTokenPda({ mint: address(solanaUsdc), owner: address(input.to), tokenProgram: TOKEN_PROGRAM_ADDRESS })
      const native = createSolanaKitSigner(privy, { walletId: wallet.providerWalletId, address: address(wallet.address), authorizationContext: { authorization_private_keys: [authorizationKey] } })
      let message: string | undefined, payerSignature: string | undefined, attempted = false
      // Expose only partial signing, never the SDK's sign-and-send or message signer.
      const signer: TransactionPartialSigner = { address: native.address, async signTransactions(transactions) {
        if (attempted || transactions.length !== 1) throw new Error('Only one Solana payment signature is allowed')
        attempted = true
        const transaction = transactions[0]!
        const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
        if (compiled.version !== 0 || compiled.addressTableLookups?.length || compiled.header.numSignerAccounts !== 2 || compiled.header.numReadonlySignerAccounts !== 1 || compiled.staticAccounts[0] !== extra.feePayer || compiled.staticAccounts[1] !== wallet.address) throw new Error('Unexpected Solana signers or lookup tables')
        const recentBlockhash = compiled.lifetimeToken as Parameters<typeof connection.isBlockhashValid>[0]
        const decoded = decompileTransactionMessage(compiled)
        const ix = decoded.instructions
        const budget = [getSetComputeUnitLimitInstruction({ units: DEFAULT_COMPUTE_UNIT_LIMIT }), getSetComputeUnitPriceInstruction({ microLamports: DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS })]
        if (ix.length !== 4 || budget.some((expected, i) => ix[i]!.programAddress !== expected.programAddress || (ix[i]!.accounts?.length ?? 0) !== 0 || !equalBytes(ix[i]!.data ?? [], expected.data))) throw new Error('Unexpected Solana instructions')
        const transfer = ix[2]!, memo = ix[3]!
        const accounts = [source, address(solanaUsdc), destination, native.address]
        const data = getTransferCheckedInstructionDataEncoder().encode({ amount: BigInt(input.amountAtomic), decimals: 6 })
        if (transfer.programAddress !== TOKEN_PROGRAM_ADDRESS || transfer.accounts?.length !== 4 || transfer.accounts.some((account, i) => account.address !== accounts[i]) || !equalBytes(transfer.data ?? [], data)) throw new Error('Solana transfer differs from approved terms')
        if (memo.programAddress !== MEMO_PROGRAM_ADDRESS || (memo.accounts?.length ?? 0) !== 0 || !memo.data || memo.data.length > MAX_MEMO_BYTES || (extra.memo ? !equalBytes(memo.data, Buffer.from(extra.memo)) : !/^[0-9a-f]{32}$/.test(Buffer.from(memo.data).toString()))) throw new Error('Unexpected payment memo')
        if (!recentBlockhash || !(await connection.isBlockhashValid(recentBlockhash)).value) throw new Error('Expired Solana blockhash')
        const signatures = await native.signTransactions(transactions)
        const signature = signatures[0]?.[native.address]
        if (!signature || !await verifySignature(await getPublicKeyFromAddress(native.address), signature, transaction.messageBytes) || !(await connection.isBlockhashValid(recentBlockhash)).value) throw new Error('Invalid or expired Privy signature')
        message = Buffer.from(transaction.messageBytes).toString('base64')
        payerSignature = getBase58Decoder().decode(signature)
        return signatures
      } }
      const client = new x402Client().register(solanaDevnet, new ExactSvmScheme(signer, { rpcUrl: rpcUrl() }))
      client.setSpendControls({ allowedAssets: [{ network: solanaDevnet, asset: solanaUsdc, maxAmountPerPayment: input.amountAtomic }] })
      const payload = await client.createPaymentPayload({ x402Version: 2, resource: { url: input.payment!.url }, accepts: [input.payment!.requirements] })
      const wire = getTransactionDecoder().decode(Buffer.from((payload.payload as { transaction: string }).transaction, 'base64'))
      if (!message || !payerSignature || Buffer.from(wire.messageBytes).toString('base64') !== message || !wire.signatures[native.address] || getBase58Decoder().decode(wire.signatures[native.address]!) !== payerSignature) throw new Error('Unexpected signed Solana payload')
      const stored: SignedPayment = { input, payer: wallet.address, source, destination, fromSlot, message, payerSignature, payload }
      return { signedTransaction: `svm-x402:${JSON.stringify(stored)}`, transactionHash: null }
    },
    async broadcast(serialized: string, savePaymentHash?: SavePaymentHash): Promise<PaidHttpResponse> {
      const stored: SignedPayment = JSON.parse(serialized.slice(9))
      const header = encodePaymentSignatureHeader(stored.payload)
      const response = await paymentHttp({ url: stored.input.payment!.url, method: 'GET', headers: {} }, { 'PAYMENT-SIGNATURE': header }, origins(), settlementHeaders(stored.input.chainId, stored.payer, savePaymentHash))
      const body = Buffer.from(response.bodyBase64, 'base64'), wire = (stored.payload.payload as { transaction: string }).transaction
      const reflected = [Buffer.from(header), Buffer.from(wire), Buffer.from(wire, 'base64'), Buffer.from(stored.payerSignature)].some(value => body.includes(value))
      return { status: reflected ? 502 : response.status, headers: { 'content-type': reflected ? 'text/plain' : response.headers['content-type'] ?? 'application/octet-stream' }, bodyBase64: reflected ? Buffer.from('Upstream returned payment credentials; response withheld').toString('base64') : response.bodyBase64 }
    },
    async receipt(serialized: string, input: OperationInput, transactionHash?: string | null): Promise<Operation['receipt']> {
      const stored: SignedPayment = JSON.parse(serialized.slice(9))
      if (JSON.stringify(stored.input) !== JSON.stringify(input)) throw new Error('Persisted Solana payment mismatch')
      const connection = solanaConnection(rpcUrl())
      if (!(await connection.getGenesisHash()).startsWith(solanaDevnet.slice(7))) throw new Error('RPC is not Solana devnet')
      // Use the seller's hash first; paginated history is only lost-response recovery.
      let before: Parameters<typeof connection.getTransaction>[0] | undefined
      while (true) {
        const candidates = transactionHash
          ? [{ signature: transactionHash as Parameters<typeof connection.getTransaction>[0], slot: BigInt(stored.fromSlot) }]
          : await connection.getSignaturesForAddress(new PublicKey(stored.source), { limit: 100, before })
        for (const candidate of candidates) {
          if (BigInt(candidate.slot) < BigInt(stored.fromSlot)) return null
          const tx = await connection.getTransaction(candidate.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
          if (!tx?.meta) continue
          if (Buffer.from(tx.transaction.message.serialize()).toString('base64') !== stored.message || String(tx.transaction.signatures[1]) !== stored.payerSignature) {
            if (transactionHash) throw new Error('Settlement transaction differs from signed Solana payment')
            continue
          }
          const keys = tx.transaction.message.getAccountKeys()
          const amount = (balances: typeof tx.meta.preTokenBalances, account: string) => balances?.find(balance => keys.get(balance.accountIndex)?.toBase58() === account && balance.mint === solanaUsdc)?.uiTokenAmount.amount
          if (!tx.meta.err) {
            const before = amount(tx.meta.preTokenBalances, stored.source), after = amount(tx.meta.postTokenBalances, stored.source)
            const receivedBefore = amount(tx.meta.preTokenBalances, stored.destination), receivedAfter = amount(tx.meta.postTokenBalances, stored.destination)
            if (before === undefined || after === undefined || receivedBefore === undefined || receivedAfter === undefined || BigInt(before) - BigInt(after) !== BigInt(input.amountAtomic) || BigInt(receivedAfter) - BigInt(receivedBefore) !== BigInt(input.amountAtomic)) throw new Error('Solana settled amount differs from approval')
          }
          return { transactionHash: candidate.signature, chainId: solanaDevnet, blockNumber: String(tx.slot), feeAtomic: '0', success: !tx.meta.err, feePayment: { asset: 'native', amountAtomic: '0', decimals: 9 } }
        }
        if (transactionHash || candidates.length < 100) return null
        const next = candidates[candidates.length - 1]!.signature
        if (next === before) throw new Error('Solana history pagination did not advance')
        before = next
      } // Unknown/expired submissions retain reservations; never create a fresh proof automatically.
    },
  }
}
