import { z } from 'zod'
import { Challenge, Credential } from 'mppx'
import { Proof } from 'mppx/tempo'
import { tempo as tempoChain } from 'viem/chains'
import { getAddress, erc20Abi, parseEventLogs, decodeFunctionData, encodeFunctionData, concatHex, keccak256, stringToHex, sliceHex, type Account, type Transport, type Address, type Client, type Hex, type TransactionReceipt } from 'viem'
import { getChainId, readContract, getLogs, getTransactionReceipt, prepareTransactionRequest, signTransaction, sendRawTransaction, waitForTransactionReceipt } from 'viem/actions'
import { Actions, Abis } from 'viem/tempo'
import { Transaction as TempoTransaction, TxEnvelopeTempo, SignatureEnvelope } from 'ox/tempo'
import { Secp256k1 } from 'ox'
import { requireNetwork } from './networks'
import { paymentTransfers, type PaymentDistribution } from './operations'
type TempoPayment = PaymentDistribution & { chainId: string; asset: string; feeAsset?: string }

export const tempoFeeScale = 1_000_000_000_000n
export const roundedTempoFee = (fee: bigint) => ((fee + tempoFeeScale - 1n) / tempoFeeScale) * tempoFeeScale
export function tempoAsset(chainId: string, selector: string) {
  const network = requireNetwork(chainId)
  if (network.family !== 'tempo') throw Error('Expected a Tempo network')
  const asset = network.assets.find(asset => [asset.id, asset.symbol, asset.id.slice(6)].some(value => value.toLowerCase() === selector.toLowerCase()))
  if (!asset) throw Error('Unsupported Tempo token for this network')
  return asset
}
export function tempoFeeAsset(input: { chainId: string; feeAsset?: string }) {
  const network = requireNetwork(input.chainId)
  const asset = tempoAsset(input.chainId, input.feeAsset ?? `erc20:${network.feeToken}`)
  if (asset.feeEligible === false) throw Error('This token cannot pay Tempo network fees')
  return asset
}
export function defaultTempoFeeAsset(chainId: string, payment: string) {
  const asset = tempoAsset(chainId, payment)
  // A deterministic creation-time default, persisted and displayed before approval.
  // Never substitute fee tokens during preparation or after an uncertain submission.
  return tempoFeeAsset({ chainId, feeAsset: asset.feeEligible === false ? tempoAsset(chainId, requireNetwork(chainId).defaultAsset).id : asset.id })
}
// Preparation's eth_estimateGas also checks fee liquidity/policies. Recheck funds
// against the maximum signed exposure, including when payment and gas share a token.
export async function checkTempoFunds(client: Client, input: { chainId: string; asset: string; feeAsset?: string; amountAtomic: string }, owner: Address, maxFee: bigint, sponsored = false) {
  const network = requireNetwork(input.chainId), payment = tempoAsset(input.chainId, input.asset), fee = tempoFeeAsset(input)
  if (await getChainId(client) !== network.chain?.id) throw Error('RPC network mismatch')
  if (!sponsored) await Actions.fee.validateToken(client, { token: fee.id.slice(6) as Address })
  const balance = (asset: string) => readContract(client, { address: asset.slice(6) as Address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
  const [funds, gasFunds] = await Promise.all([balance(payment.id), sponsored || fee.id === payment.id ? Promise.resolve(null) : balance(fee.id)])
  if (sponsored) { if (funds < BigInt(input.amountAtomic)) throw Error('Insufficient payment-token balance') }
  else assertTempoBalances(BigInt(input.amountAtomic), funds, gasFunds, maxFee)
}
export function assertTempoBalances(amount: bigint, funds: bigint, separateFeeFunds: bigint | null, maxFee: bigint) {
  if (amount <= 0n || maxFee <= 0n) throw Error('Invalid Tempo payment or fee exposure')
  const feeAtomic = roundedTempoFee(maxFee) / tempoFeeScale
  if (funds < amount + (separateFeeFunds === null ? feeAtomic : 0n) || (separateFeeFunds !== null && separateFeeFunds < feeAtomic)) throw Error('Insufficient payment or fee-token balance')
}
export function verifyTempoReceipt(receipt: TransactionReceipt & { feeToken?: string }, input: TempoPayment, sender: string = receipt.from, sponsor?: string) {
  const fee = tempoFeeAsset(input)
  if ((!sponsor && receipt.feeToken?.toLowerCase() !== fee.id.slice(6)) || receipt.from.toLowerCase() !== sender.toLowerCase() || sponsor?.toLowerCase() === sender.toLowerCase()) throw Error('Unexpected Tempo fee token or sender')
  if (receipt.status === 'success') {
    const transfers = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: 'Transfer' })
    for (const transfer of paymentTransfers(input)) {
      const index = transfers.findIndex(log => log.address.toLowerCase() === input.asset.slice(6).toLowerCase() && log.args.from.toLowerCase() === sender.toLowerCase() && log.args.to.toLowerCase() === transfer.to.toLowerCase() && log.args.value === BigInt(transfer.amountAtomic))
      if (index < 0) throw Error('Successful Tempo transaction missing approved transfer; reservation retained')
      transfers.splice(index, 1) // One log cannot satisfy two identical splits.
    }
  }
  const amount = sponsor ? 0n : roundedTempoFee(receipt.gasUsed * receipt.effectiveGasPrice)
  return { feeAtomic: amount.toString(), feePayment: { asset: sponsor ? `erc20:${receipt.feeToken}` : fee.id, amountAtomic: (amount / tempoFeeScale).toString(), decimals: 6, ...(sponsor ? { payer: sponsor } : {}) }, ...(sponsor ? { sponsored: true } : {}), success: receipt.status === 'success' }
}
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value => value as Address)
const termsSchema = z.object({
  amount: z.string().regex(/^[1-9]\d{0,77}$/), currency: address, recipient: address,
  // Description carries no execution authority. Unknown financial extensions fail closed.
  description: z.string().max(2000).optional(), externalId: z.string().max(256).optional(),
  methodDetails: z.object({ chainId: z.number().int().positive(), feePayer: z.boolean().optional(),
    supportedModes: z.array(z.enum(['pull', 'push'])).min(1).max(2).optional(),
    memo: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
    splits: z.array(z.object({ recipient: address, amount: z.string().regex(/^[1-9]\d{0,77}$/), memo: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() }).strict()).min(1).max(10).optional(),
  }).strict(),
}).strict()
export function parseTempoChallenge(header: string, chainId: string) {
  if (!header || header.length > 16384) throw Error('Invalid MPP challenge')
  // A persisted operation must contain exactly the selected offer, never a list.
  const offers = Challenge.deserializeList(header)
  if (offers.length !== 1) throw Error('Expected one approved MPP offer')
  const challenge = offers[0]!
  const request = termsSchema.parse(challenge.request)
  const network = requireNetwork(chainId)
  if (challenge.method !== 'tempo' || challenge.intent !== 'charge' || request.methodDetails.chainId !== network.chain?.id ||
      (challenge.header && !['authorization', 'payment-authorization'].includes(challenge.header.toLowerCase())) ||
      (request.methodDetails.feePayer && request.methodDetails.supportedModes && !request.methodDetails.supportedModes.includes('pull')) ||
      !challenge.expires || !Number.isFinite(Date.parse(challenge.expires))) throw Error('Unsupported Tempo charge')
  const asset = tempoAsset(chainId, request.currency)
  getAddress(request.recipient)
  paymentTransfers({ to: request.recipient, amountAtomic: request.amount, mpp: { splits: request.methodDetails.splits?.map(split => ({ to: getAddress(split.recipient), amountAtomic: split.amount })) } })
  const mode = request.methodDetails.supportedModes && !request.methodDetails.supportedModes.includes('pull') ? 'push' as const : 'pull' as const
  return { challenge: { ...challenge, method: 'tempo' as const, intent: 'charge' as const, request }, request, asset, mode }
}
export function selectTempoChallenge(header: string, chainId: string, maximum: string, selector?: string, now = Date.now(), sponsoredOnly = false) {
  if (!header || header.length > 16384) throw Error('Invalid MPP challenge')
  const preferred = selector ? tempoAsset(chainId, selector) : undefined
  const offers = Challenge.deserializeList(header)
  if (offers.length > 32) throw Error('Too many MPP offers')
  const candidates: ReturnType<typeof parseTempoChallenge>[] = []
  for (const offer of offers) {
    try {
      const parsed = parseTempoChallenge(Challenge.serialize(offer), chainId)
      const expiry = Date.parse(parsed.challenge.expires!)
      if ((!sponsoredOnly || parsed.request.methodDetails.feePayer === true) && (!preferred || parsed.asset.id === preferred.id) && BigInt(parsed.request.amount) <= BigInt(maximum) && expiry >= now + 30_000 && expiry <= now + 600_000) candidates.push(parsed)
    } catch { /* Ignore unsupported offers, not payment-validation failures at signing. */ }
  }
  // Catalog order expresses the preference; never choose a different token after approval.
  const order = requireNetwork(chainId).assets.map(asset => asset.id)
  candidates.sort((a, b) => order.indexOf(a.asset.id) - order.indexOf(b.asset.id))
  if (!candidates.length) throw Error('No supported, unexpired Tempo charge within the requested token and price limits')
  return candidates[0]!
}

// mppx 0.9.3's attribution v1 wire layout (its encoder is not a public export):
// tag[4], version[1], realm fingerprint[10], anonymous client[10], challenge nonce[7].
export function tempoPaymentMemo(challenge: ReturnType<typeof parseTempoChallenge>['challenge']): Hex {
  const hash = (value: string) => keccak256(stringToHex(value))
  return (challenge.request.methodDetails.memo as Hex | undefined) ?? concatHex([
    sliceHex(hash('mpp'), 0, 4), '0x01', sliceHex(hash(challenge.realm), 0, 10),
    '0x00000000000000000000', sliceHex(hash(challenge.id), 0, 7),
  ])
}

// The SDK's push helper signs AND broadcasts. Prepare with public viem actions
// instead, through the same custody guard, so callers can persist before sending.
export async function prepareTempoPush(client: Client<Transport, typeof tempoChain, Account>, challenge: ReturnType<typeof parseTempoChallenge>['challenge']) {
  const { request } = challenge
  if (request.methodDetails.feePayer || !request.methodDetails.supportedModes?.includes('push')) throw Error('Unsupported Tempo push terms')
  const transfers = paymentTransfers({ to: request.recipient, amountAtomic: request.amount, mpp: { splits: request.methodDetails.splits?.map(split => ({ to: split.recipient, amountAtomic: split.amount })) } })
  const calls = transfers.map((transfer, index) => {
    const memo = index === 0 ? tempoPaymentMemo(challenge) : request.methodDetails.splits?.[index - 1]?.memo as Hex | undefined
    return { to: request.currency, value: 0n, data: memo
      ? encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [transfer.to as Address, BigInt(transfer.amountAtomic), memo] })
      : encodeFunctionData({ abi: Abis.tip20, functionName: 'transfer', args: [transfer.to as Address, BigInt(transfer.amountAtomic)] }) }
  })
  const prepared = await prepareTransactionRequest(client, { account: client.account, calls, nonceKey: 'expiring', validBefore: Math.min(Math.floor(Date.now() / 1000) + 25, Math.floor(Date.parse(challenge.expires!) / 1000)) })
  const signed = await signTransaction(client, prepared)
  const tx = TxEnvelopeTempo.deserialize(signed as never)
  if (!tx.signature || tx.feePayerSignature !== undefined) throw Error('Invalid Tempo push proof')
  return Credential.serialize({ challenge, payload: { type: 'hash', hash: TxEnvelopeTempo.hash({ ...tx, signature: tx.signature }) }, source: Proof.proofSource({ address: client.account.address, chainId: request.methodDetails.chainId }) })
}

// Call only on the first submission of a durably persisted proof. Receipt-only
// recovery is separate: neither transport errors nor HTTP failures cause a resend.
export async function broadcastTempoPush(client: Client, input: TempoPayment, signed: Hex, hash: Hex) {
  const tx = TxEnvelopeTempo.deserialize(signed as never)
  const chainId = requireNetwork(input.chainId).chain?.id
  if (await getChainId(client) !== chainId || tx.chainId !== chainId || !tx.signature || tx.feePayerSignature !== undefined ||
      typeof tx.feeToken !== 'string' || tx.feeToken.toLowerCase() !== tempoFeeAsset(input).id.slice(6) ||
      TxEnvelopeTempo.hash({ ...tx, signature: tx.signature }).toLowerCase() !== hash.toLowerCase()) throw Error('Invalid persisted Tempo push proof')
  assertTempoPaymentCalls(tx.calls, input)
  if (!tx.validBefore || tx.validBefore * 1000 <= Date.now()) throw Error('Tempo push signing window expired; no broadcast')
  const sent = await sendRawTransaction(client, { serializedTransaction: signed })
  if (sent.toLowerCase() !== hash.toLowerCase()) throw Error('Tempo RPC returned a different transaction hash')
  await waitForTransactionReceipt(client, { hash, checkReplacement: false, timeout: 15_000, pollingInterval: 500 })
  const receipt = await reconcileTempoPayment(client, input, signed, hash)
  if (!receipt?.success) throw Error('Tempo push payment not confirmed successful; provider was not contacted')
  return receipt
}

// Validate every call in order; fee accounting still uses the total charge once.
export function assertTempoPaymentCalls(calls: readonly { to?: string; data?: string; value?: bigint | string | number }[], input: TempoPayment, memos?: readonly (string | undefined)[]) {
  const transfers = paymentTransfers(input)
  if (calls.length !== transfers.length || (memos && memos.length !== transfers.length)) throw Error('Tempo call count differs from approved payment')
  let primaryMemo: Hex | undefined
  for (const [index, transfer] of transfers.entries()) {
    const call = calls[index]!, decoded = decodeFunctionData({ abi: Abis.tip20, data: call.data as Hex })
    if (call.to?.toLowerCase() !== input.asset.slice(6).toLowerCase() || BigInt(call.value ?? 0) !== 0n ||
        (decoded.functionName !== 'transfer' && decoded.functionName !== 'transferWithMemo') ||
        decoded.args[0].toLowerCase() !== transfer.to.toLowerCase() || decoded.args[1] !== BigInt(transfer.amountAtomic)) throw Error('Tempo transfer differs from approval')
    if (call.data?.toLowerCase() !== encodeFunctionData({ abi: Abis.tip20, functionName: decoded.functionName, args: decoded.args }).toLowerCase()) throw Error('Noncanonical Tempo payment calldata')
    const memo = decoded.functionName === 'transferWithMemo' ? decoded.args[2] : undefined
    if ((index === 0 && !memo) || (memos?.[index] && memo?.toLowerCase() !== memos[index]!.toLowerCase()) || (memos && index > 0 && !memos[index] && memo)) throw Error('Tempo memo differs from approval')
    if (index === 0) primaryMemo = memo
  }
  return primaryMemo!
}

// A sponsor adds its signature and chooses its own fee token, changing the final
// transaction hash. Compare the sender's signed payload/signature, not that hash.
export function verifyTempoSettlementTransaction(raw: TempoTransaction.Rpc, signed: Hex, hash: Hex) {
  const expected = TxEnvelopeTempo.deserialize(signed as never)
  const tx = TempoTransaction.fromRpc(raw)
  if (tx?.type !== 'tempo') throw Error('Expected a Tempo settlement')
  // RPC null means no sponsor signature; envelope null instead requests sponsorship.
  const actual = TxEnvelopeTempo.from({ ...tx, feePayerSignature: tx.feePayerSignature ?? undefined } as unknown as TxEnvelopeTempo.TxEnvelopeTempo)
  const payload = TxEnvelopeTempo.getSignPayload(expected)
  if (!expected.signature || !actual.signature || TxEnvelopeTempo.getSignPayload(actual) !== payload || SignatureEnvelope.serialize(actual.signature) !== SignatureEnvelope.serialize(expected.signature) || TxEnvelopeTempo.hash({ ...actual, signature: actual.signature }).toLowerCase() !== hash.toLowerCase()) throw Error('Settlement differs from the persisted Tempo proof')
  const sender = SignatureEnvelope.extractAddress({ payload, signature: expected.signature })
  let sponsor: Address | undefined
  if (expected.feePayerSignature === null) {
    if (!actual.feePayerSignature) throw Error('Missing sponsor signature')
    sponsor = Secp256k1.recoverAddress({ payload: TxEnvelopeTempo.getFeePayerSignPayload(actual, { sender }), signature: actual.feePayerSignature })
    if (sponsor.toLowerCase() === sender.toLowerCase()) throw Error('Sender cannot be charged for a sponsored payment')
  } else if (actual.feePayerSignature) throw Error('Unexpected fee sponsorship')
  if (typeof actual.feeToken !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(actual.feeToken)) throw Error('Missing settlement fee-token evidence')
  return { sender, sponsor, feeToken: actual.feeToken }
}

export async function reconcileTempoPayment(client: Client, input: TempoPayment, signed: Hex, hash?: string | null, fromBlock?: string) {
  if (await getChainId(client) !== requireNetwork(input.chainId).chain?.id) throw Error('Wrong Tempo settlement network')
  const expected = TxEnvelopeTempo.deserialize(signed as never)
  if (!expected.signature) throw Error('Missing persisted sender signature')
  const sender = SignatureEnvelope.extractAddress({ payload: TxEnvelopeTempo.getSignPayload(expected), signature: expected.signature })
  const primaryMemo = assertTempoPaymentCalls(expected.calls, input)
  const call = expected.calls[0]!
  let candidates: Hex[] = hash ? [hash as Hex] : []
  if (!hash && fromBlock) {
    const logs = await getLogs(client, { address: call.to as Address, event: Abis.tip20.find(event => event.type === 'event' && event.name === 'TransferWithMemo')!, args: { from: sender, to: input.to as Address, memo: primaryMemo }, fromBlock: BigInt(fromBlock), toBlock: 'latest' })
    candidates = [...new Set(logs.flatMap(log => log.transactionHash ? [log.transactionHash] : []))]
  }
  for (const candidate of candidates) {
    const raw = await client.request({ method: 'eth_getTransactionByHash', params: [candidate] })
    if (!raw) continue
    let proof
    try { proof = verifyTempoSettlementTransaction(raw as never, signed, candidate) }
    catch (error) { if (hash) throw error; continue }
    let receipt
    try { receipt = await getTransactionReceipt(client, { hash: candidate }) }
    catch (error) { if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') continue; throw error }
    return { transactionHash: candidate, chainId: input.chainId, blockNumber: receipt.blockNumber.toString(), ...verifyTempoReceipt({ ...receipt, feeToken: proof.feeToken }, input, proof.sender, proof.sponsor) }
  }
  return null
}
