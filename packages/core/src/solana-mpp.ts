import { createHash } from 'node:crypto'
import { z } from 'zod'
import { Challenge, Credential, Receipt } from 'mppx'
import { solana } from '@solana/mpp/client'
import { address, signature, appendTransactionMessageInstruction, appendTransactionMessageInstructions, assertIsTransactionWithinSizeLimit, compileTransaction, compileTransactionMessage, createTransactionMessage, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder, getBase58Decoder, getPublicKeyFromAddress, getTransactionDecoder, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, verifySignature, type Blockhash, type Instruction, type TransactionModifyingSigner, type TransactionPartialSigner } from '@solana/kit'
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget'
import { getTransferSolInstruction } from '@solana-program/system'
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction, getTokenSize, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { Connection, PublicKey, VersionedMessage } from '@solana/web3.js'
import { requireNetwork } from './networks'
import { httpFields, paymentRequest, paymentTransfers, type FetchRequest, type OperationInput, type Operation } from './operations'
import { paymentHttp } from './payment-http'

const publicKey = z.string().refine(value => { try { address(value); return true } catch { return false } }, 'Invalid Solana address')
const amount = z.string().regex(/^[1-9]\d{0,19}$/).refine(value => BigInt(value) <= (1n << 64n) - 1n)
const terms = z.object({
  amount, currency: z.string(), recipient: publicKey,
  description: z.string().max(2000).optional(), externalId: z.string().max(256).optional(),
  methodDetails: z.object({
    network: z.enum(['mainnet-beta', 'devnet']).optional(), decimals: z.number().int().optional(),
    tokenProgram: z.literal(TOKEN_PROGRAM_ADDRESS).optional(),
    feePayer: z.boolean().optional(), feePayerKey: publicKey.optional(), recentBlockhash: publicKey.optional(),
    splits: z.array(z.object({ recipient: publicKey, amount, memo: z.string().refine(value => Buffer.byteLength(value) <= 566, 'Solana memo exceeds 566 bytes').optional() }).strict()).max(8).optional(),
  }).strict(),
}).strict()

export function solanaMppAsset(chainId: string, selector = 'USDC') {
  const network = requireNetwork(chainId)
  if (network.family !== 'solana') throw Error('Expected a Solana network')
  const asset = network.assets.find(asset => asset.id === selector || asset.symbol === selector || (selector === 'sol' && asset.id === 'native') || asset.id === `spl:${selector}`)
  if (!asset) throw Error('Choose SOL or the catalog USDC mint on this Solana network')
  return asset
}
export function parseSolanaChallenge(header: string, chainId: string) {
  if (!header || header.length > 16384) throw Error('Invalid Solana MPP challenge')
  const offers = Challenge.deserializeList(header)
  if (offers.length !== 1) throw Error('Expected one exact Solana MPP offer')
  const challenge = offers[0]!, request = terms.parse(challenge.request), network = requireNetwork(chainId)
  const asset = solanaMppAsset(chainId, request.currency)
  if (challenge.method !== 'solana' || challenge.intent !== 'charge' ||
      (request.methodDetails.network ?? 'mainnet-beta') !== (network.testnet ? 'devnet' : 'mainnet-beta') ||
      (request.currency !== 'sol' && request.currency !== asset.id.slice(4)) ||
      (request.methodDetails.decimals !== undefined && request.methodDetails.decimals !== asset.decimals) ||
      (asset.id !== 'native' && request.methodDetails.decimals === undefined) ||
      (!!request.methodDetails.feePayer !== !!request.methodDetails.feePayerKey) ||
      (challenge.header && !['authorization', 'payment-authorization'].includes(challenge.header.toLowerCase())) ||
      (challenge.expires && !Number.isFinite(Date.parse(challenge.expires)))) throw Error('Unsupported Solana charge')
  paymentTransfers({ to: request.recipient, amountAtomic: request.amount, mpp: { splits: request.methodDetails.splits?.map(split => ({ to: split.recipient, amountAtomic: split.amount })) } })
  return { challenge: { ...challenge, method: 'solana' as const, intent: 'charge' as const, request }, asset }
}
export function solanaMppTerms(input: FetchRequest, chainId: string, header: string): OperationInput {
  if (input.feeAsset) throw Error('Solana fees are paid in SOL; do not select a Tempo fee token')
  const selected = solanaMppAsset(chainId, input.asset), now = Date.now()
  if (!header || header.length > 16384) throw Error('Expected a Solana MPP charge')
  const offers = Challenge.deserializeList(header)
  if (offers.length > 32) throw Error('Too many payment offers')
  for (const offer of offers) {
    try {
      const { challenge, asset } = parseSolanaChallenge(Challenge.serialize(offer), chainId)
      const { request } = challenge, sponsored = request.methodDetails.feePayer === true
      const expiresAt = challenge.expires ?? new Date(now + 300_000).toISOString()
      if (asset.id !== selected.id || BigInt(request.amount) > BigInt(input.maxAmountAtomic) ||
          (!sponsored && (!input.maxFeeAtomic || BigInt(input.maxFeeAtomic) === 0n)) ||
          Date.parse(expiresAt) < now + 30_000 || Date.parse(expiresAt) > now + 600_000) continue
      const result: OperationInput = { walletId: input.walletId, action: 'paid_fetch', chainId, asset: asset.id, to: request.recipient, amountAtomic: request.amount, maxFeeAtomic: sponsored ? '0' : input.maxFeeAtomic!, reason: input.reason ?? '', mpp: { ...httpFields(input), ...(request.methodDetails.splits?.length ? { splits: request.methodDetails.splits.map(split => ({ to: split.recipient, amountAtomic: split.amount })) } : {}), url: input.url, sponsored, challenge: Challenge.serialize(challenge), maxAmountAtomic: input.maxAmountAtomic, expiresAt } }
      validateSolanaMpp(result)
      return result
    } catch { /* Only select an exact supported offer; never reinterpret other methods. */ }
  }
  throw Error('No supported Solana MPP charge: check token, network, expiry, amount and SOL fee ceiling')
}
export function validateSolanaMpp(input: OperationInput, payer?: string) {
  if (input.action !== 'paid_fetch' || !input.mpp || input.payment || input.feeAsset) throw Error('Invalid Solana MPP operation')
  const { challenge, asset } = parseSolanaChallenge(input.mpp.challenge, input.chainId), { request } = challenge
  paymentRequest(input.mpp)
  if (input.mpp.mode && input.mpp.mode !== 'pull') throw Error('Solana MPP supports pull credentials only')
  if (JSON.stringify(input.mpp.splits ?? []) !== JSON.stringify((request.methodDetails.splits ?? []).map(split => ({ to: split.recipient, amountAtomic: split.amount })))) throw Error('Solana split recipients differ from approval')
  const transfers = paymentTransfers(input)
  if (asset.id !== input.asset || request.recipient !== input.to || request.amount !== input.amountAtomic ||
      BigInt(input.amountAtomic) > BigInt(input.mpp.maxAmountAtomic) ||
      (challenge.expires && challenge.expires !== input.mpp.expiresAt) ||
      !!request.methodDetails.feePayer !== !!input.mpp.sponsored ||
      (input.mpp.sponsored ? input.maxFeeAtomic !== '0' : BigInt(input.maxFeeAtomic) <= 0n) ||
      (payer && (transfers.some(transfer => transfer.to === payer) || request.methodDetails.feePayerKey === payer))) throw Error('Solana MPP terms differ from approval')
  if ((!challenge.header || challenge.header.toLowerCase() === 'authorization') && Object.keys(input.mpp.headers ?? {}).some(key => key.toLowerCase() === 'authorization')) throw Error('Seller must advertise Payment-Authorization to combine application authentication and payment')
  return challenge
}
export function solanaMppConnection(chainId: string) {
  const network = requireNetwork(chainId)
  if (network.family !== 'solana') throw Error('Expected Solana network')
  const rpcUrl = process.env[network.rpcEnv] ?? network.rpcUrl
  return { rpcUrl, rpc: new Connection(rpcUrl, { commitment: 'confirmed', fetch: ((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) })) as typeof fetch }) }
}
export type SolanaMppProof = { input: OperationInput; payer: string; credential: string; signed: string; message: string; payerSignature: string; fromSlot: string; hash: string | null }

// The SDK receives a one-use guarded signer, never sign-and-send access.
// Hosted and local custody share these exact transaction and settlement checks.
export async function prepareSolanaMpp(input: OperationInput, native: TransactionPartialSigner, rpc: Connection, rpcUrl: string, expiresAt: number, authorizationId: string): Promise<SolanaMppProof> {
  const challenge = validateSolanaMpp(input, native.address), network = requireNetwork(input.chainId)
  const deadline = Math.min(expiresAt, Date.parse(input.mpp!.expiresAt))
  if (await rpc.getGenesisHash() !== network.genesisHash) throw Error('Solana RPC network mismatch')
  if (deadline <= Date.now() + 30_000) throw Error('Not enough Solana approval time remains')
  const sponsored = !!input.mpp!.sponsored, feePayer = address(sponsored ? challenge.request.methodDetails.feePayerKey! : native.address)
  const source = input.asset === 'native' ? native.address : (await findAssociatedTokenPda({ mint: address(input.asset.slice(4)), owner: native.address, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]
  const transfers = paymentTransfers(input)
  const computeUnitLimit = Math.min(1_400_000, 200_000 * transfers.length)
  const fromSlot = String(await rpc.getSlot())
  if (!authorizationId) throw Error('An operation/idempotency identity is required')
  // Same transfer + blockhash otherwise produces the same signature for distinct
  // purchases. Bind each authorized purchase without changing its payment terms.
  const memo: Instruction = { programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Buffer.from(`agentis:${createHash('sha256').update(JSON.stringify([authorizationId, input])).digest('hex')}`) }
  let attempted = false, message = '', payerSignature = ''
  const signer: TransactionModifyingSigner = { address: native.address, async modifyAndSignTransactions(transactions) {
    if (attempted || transactions.length !== 1) throw Error('Only one approved Solana payment may be signed')
    attempted = true
    const tx = transactions[0]!, compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
    if (compiled.version !== 0 || compiled.addressTableLookups?.length) throw Error('Unexpected Solana transaction version or lookup table')
    const refuse: TransactionPartialSigner = { address: feePayer, signTransactions: async () => { throw Error('Fee payer signing is not exposed') } }
    const instructions: Instruction[] = [getSetComputeUnitPriceInstruction({ microLamports: 1n }), getSetComputeUnitLimitInstruction({ units: computeUnitLimit })]
    const signedInstructions = [...instructions]
    for (const [index, transfer] of transfers.entries()) {
      const paymentInstructions: Instruction[] = []
      if (input.asset === 'native') {
        paymentInstructions.push(getTransferSolInstruction({ source: native, destination: address(transfer.to), amount: BigInt(transfer.amountAtomic) }))
      } else {
        const mint = address(input.asset.slice(4)), destination = (await findAssociatedTokenPda({ mint, owner: address(transfer.to), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]
        paymentInstructions.push(getCreateAssociatedTokenIdempotentInstruction({ payer: refuse, ata: destination, owner: address(transfer.to), mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))
        paymentInstructions.push(getTransferCheckedInstruction({ source, mint, destination, authority: native, amount: BigInt(transfer.amountAtomic), decimals: 6 }))
      }
      instructions.push(...paymentInstructions)
      signedInstructions.push(...paymentInstructions)
      const splitMemo = index > 0 ? challenge.request.methodDetails.splits?.[index - 1]?.memo : undefined
      if (splitMemo !== undefined) signedInstructions.push({ programAddress: memo.programAddress, data: Buffer.from(splitMemo) })
    }
    const expected = appendTransactionMessageInstructions(instructions, setTransactionMessageLifetimeUsingBlockhash({ blockhash: compiled.lifetimeToken as Blockhash, lastValidBlockHeight: 0n }, setTransactionMessageFeePayer(feePayer, createTransactionMessage({ version: 0 }))))
    if (!Buffer.from(getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(expected))).equals(Buffer.from(tx.messageBytes))) throw Error('Solana transaction differs from approved payment')
    // The seller's recentBlockhash is an optional RPC-saving hint, not a charge
    // term. Keep the original challenge intact; after checking the SDK's exact
    // instructions, bind a fresh finalized lifetime before the one custody call.
    // The installed seller SDK uses default (finalized) send preflight, so a
    // confirmed-only blockhash can pass simulation but fail before broadcast.
    const latest = await rpc.getLatestBlockhashAndContext({ commitment: 'finalized' })
    const blockhash = latest.value.blockhash
    const validBlockhash = async () => (await rpc.isBlockhashValid(blockhash, { commitment: 'finalized', minContextSlot: latest.context.slot })).value
    if (!await validBlockhash()) throw Error('Fresh Solana payment blockhash unavailable; no payment signed')
    const refreshed = setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash as Blockhash, lastValidBlockHeight: latest.value.lastValidBlockHeight }, { ...expected, instructions: signedInstructions })
    const payment = compileTransaction(appendTransactionMessageInstruction(memo, refreshed))
    assertIsTransactionWithinSizeLimit(payment)
    const balance = BigInt(await rpc.getBalance(new PublicKey(native.address)))
    let fees = 0n
    if (!sponsored) {
      const quoted = (await rpc.getFeeForMessage(VersionedMessage.deserialize(Buffer.from(payment.messageBytes)))).value
      if (quoted === null) throw Error('Unable to quote Solana fees')
      // An existing recipient ATA can close before submission. Reserve worst-case rent.
      fees = BigInt(quoted) + (input.asset === 'native' ? 0n : BigInt(await rpc.getMinimumBalanceForRentExemption(getTokenSize())) * BigInt(new Set(transfers.map(transfer => transfer.to)).size))
      if (fees > BigInt(input.maxFeeAtomic)) throw Error('Solana fee and account-rent exposure exceeds approval')
    }
    if (balance < fees + (input.asset === 'native' ? BigInt(input.amountAtomic) : 0n)) throw Error('Insufficient SOL for payment, fees or account rent')
    if (input.asset !== 'native' && BigInt((await rpc.getTokenAccountBalance(new PublicKey(source))).value.amount) < BigInt(input.amountAtomic)) throw Error('Insufficient Solana payment token balance')
    if (Date.now() >= deadline || !await validBlockhash()) throw Error('Solana approval or blockhash expired')
    const signatures = await native.signTransactions([payment])
    const signed = signatures[0]?.[native.address]
    if (!signed || !await verifySignature(await getPublicKeyFromAddress(native.address), signed, payment.messageBytes) || Date.now() >= deadline || !await validBlockhash()) throw Error('Invalid or expired Solana signature')
    message = Buffer.from(payment.messageBytes).toString('base64'); payerSignature = getBase58Decoder().decode(signed)
    return [{ ...payment, signatures: Object.freeze({ ...payment.signatures, [native.address]: signed }) }]
  } }
  const method = solana.charge({ signer, rpcUrl, broadcast: false, computeUnitLimit, computeUnitPrice: 1n })
  const credential = await method.createCredential({ challenge })
  const decoded = Credential.deserialize<{ type: string; transaction: string }>(credential)
  if (decoded.payload.type !== 'transaction' || decoded.challenge.id !== challenge.id || !message || !payerSignature) throw Error('Unexpected Solana MPP credential')
  const wire = getTransactionDecoder().decode(Buffer.from(decoded.payload.transaction, 'base64'))
  if (Buffer.from(wire.messageBytes).toString('base64') !== message || !wire.signatures[native.address] || getBase58Decoder().decode(wire.signatures[native.address]!) !== payerSignature) throw Error('SDK changed the signed Solana payment')
  return { input, payer: native.address, credential, signed: decoded.payload.transaction, message, payerSignature, fromSlot, hash: sponsored ? null : payerSignature }
}
export function solanaMppHeaders(proof: SolanaMppProof, save?: (hash: string) => Promise<void>) {
  return async (headers: Record<string, string>) => {
    if (!headers['payment-receipt']) return
    const receipt = Receipt.deserialize(headers['payment-receipt'])
    signature(receipt.reference)
    if (receipt.method !== 'solana' || (proof.hash && receipt.reference !== proof.hash)) throw Error('Invalid Solana MPP settlement reference')
    await save?.(receipt.reference)
  }
}
export async function submitSolanaMpp(proof: SolanaMppProof, origins: readonly string[], save?: (hash: string) => Promise<void>) {
  const challenge = validateSolanaMpp(proof.input, proof.payer)
  const response = await paymentHttp(paymentRequest(proof.input.mpp!), { [challenge.header ?? 'Authorization']: proof.credential }, origins, solanaMppHeaders(proof, save))
  const body = Buffer.from(response.bodyBase64, 'base64')
  const reflected = [Buffer.from(proof.credential), Buffer.from(proof.signed), Buffer.from(proof.signed, 'base64'), Buffer.from(proof.payerSignature)].some(value => body.includes(value))
  return { status: reflected ? 502 : response.status, headers: { 'content-type': reflected ? 'text/plain' : response.headers['content-type'] ?? 'application/octet-stream' }, bodyBase64: reflected ? Buffer.from('Upstream returned payment credentials; response withheld').toString('base64') : response.bodyBase64 }
}
export async function reconcileSolanaMpp(proof: SolanaMppProof, rpc: Connection, hash?: string | null): Promise<Operation['receipt']> {
  const { input } = proof, network = requireNetwork(input.chainId)
  validateSolanaMpp(input, proof.payer)
  if (await rpc.getGenesisHash() !== network.genesisHash) throw Error('Solana RPC network mismatch')
  hash ??= proof.hash
  if (hash) signature(hash)
  const signerIndex = input.mpp!.sponsored ? 1 : 0
  let before: Parameters<typeof rpc.getTransaction>[0] | undefined
  while (true) {
    const candidates = hash ? [{ signature: hash as Parameters<typeof rpc.getTransaction>[0], slot: BigInt(proof.fromSlot) }] : await rpc.getSignaturesForAddress(new PublicKey(proof.payer), { limit: 100, before })
    for (const candidate of candidates) {
      if (BigInt(candidate.slot) < BigInt(proof.fromSlot)) return null
      const tx = await rpc.getTransaction(candidate.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      if (!tx?.meta) continue
      if (Buffer.from(tx.transaction.message.serialize()).toString('base64') !== proof.message || String(tx.transaction.signatures[signerIndex]) !== proof.payerSignature) {
        if (hash) throw Error('Settlement differs from signed Solana MPP payment')
        continue
      }
      const { meta } = tx, success = !meta.err
      if (success && input.mpp!.splits?.length) {
        const keys = tx.transaction.message.getAccountKeys()
        const totals = new Map<string, bigint>()
        for (const transfer of paymentTransfers(input)) totals.set(transfer.to, (totals.get(transfer.to) ?? 0n) + BigInt(transfer.amountAtomic))
        for (const [recipient, expected] of totals) {
          if (input.asset === 'native') {
            const index = meta.preBalances.findIndex((_, index) => keys.get(index)?.toBase58() === recipient)
            if (index < 0 || BigInt(meta.postBalances[index]!) - BigInt(meta.preBalances[index]!) + (index === 0 ? BigInt(meta.fee) : 0n) !== expected) throw Error('Solana split settlement differs from approved amounts')
          } else {
            const mint = input.asset.slice(4), [ata] = await findAssociatedTokenPda({ mint: address(mint), owner: address(recipient), tokenProgram: TOKEN_PROGRAM_ADDRESS })
            const balance = (values: typeof meta.preTokenBalances) => values?.find(value => keys.get(value.accountIndex)?.toBase58() === ata && value.mint === mint)?.uiTokenAmount.amount
            const after = balance(meta.postTokenBalances)
            if (after === undefined || BigInt(after) - BigInt(balance(meta.preTokenBalances) ?? '0') !== expected) throw Error('Solana split token settlement differs from approval')
          }
        }
      }
      const debit = BigInt(meta.preBalances[signerIndex]!) - BigInt(meta.postBalances[signerIndex]!)
      const nativeAmount = success && input.asset === 'native' ? BigInt(input.amountAtomic) : 0n
      const fee = debit - nativeAmount
      if (fee < 0n || (input.mpp!.sponsored ? fee !== 0n : fee < BigInt(meta.fee) || fee > BigInt(input.maxFeeAtomic))) throw Error('Unexpected Solana payment fee or rent')
      return { transactionHash: String(candidate.signature), chainId: input.chainId, blockNumber: String(tx.slot), feeAtomic: fee.toString(), success, ...(input.mpp!.sponsored ? { sponsored: true } : {}), feePayment: { asset: 'native', amountAtomic: fee.toString(), decimals: 9, ...(input.mpp!.sponsored ? { payer: tx.transaction.message.getAccountKeys().get(0)!.toBase58() } : {}) } }
    }
    if (hash || candidates.length < 100) return null
    const next = candidates[candidates.length - 1]!.signature
    if (next === before) throw Error('Solana history pagination did not advance')
    before = next
  }
}
