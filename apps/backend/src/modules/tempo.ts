import { createWalletClient, http, toHex, type Address, type Hex } from 'viem'
import { tempoTestnet } from 'viem/chains'
import { getTransactionCount } from 'viem/actions'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'

export const tempoFeeToken = '0x20c0000000000000000000000000000000000001' as const
export const tempoFeeScale = 1_000_000_000_000n // Protocol USD wei (18) -> TIP-20 atomic units (6).
export const roundedTempoFee = (wei: bigint) => ((wei + tempoFeeScale - 1n) / tempoFeeScale) * tempoFeeScale

export async function prepareTempoTransfer(account: Address, call: { to: Address; value: bigint; data: Hex }, expiresAt: Date, rpcUrl?: string) {
  const client = createWalletClient({ chain: tempoTestnet, transport: http(rpcUrl, { timeout: 15_000, retryCount: 0 }) })
  const nonce = await getTransactionCount(client, { address: account, blockTag: 'pending' })
  const tx = await client.prepareTransactionRequest({ account, nonce, type: 'tempo', calls: [call], feeToken: tempoFeeToken, nonceKey: 0n, validBefore: Math.floor(expiresAt.getTime() / 1000) })
  if (tx.maxFeePerGas === undefined || tx.maxPriorityFeePerGas === undefined) throw new Error('Tempo fee estimate missing')
  return { type: 118, chain_id: tempoTestnet.id, calls: [{ to: call.to, value: toHex(call.value), data: call.data }], fee_token: tempoFeeToken, nonce_key: '0x0', nonce: tx.nonce, valid_before: Math.floor(expiresAt.getTime() / 1000), gas_limit: toHex(tx.gas), max_fee_per_gas: toHex(tx.maxFeePerGas), max_priority_fee_per_gas: toHex(tx.maxPriorityFeePerGas) }
}

export function verifyTempoTransfer(serialized: Hex, account: Address, transaction: Awaited<ReturnType<typeof prepareTempoTransfer>>) {
  const actual = TxEnvelopeTempo.deserialize(serialized as `0x76${string}`)
  const expected = TxEnvelopeTempo.from({ chainId: tempoTestnet.id, calls: transaction.calls.map(call => ({ to: call.to, data: call.data, value: BigInt(call.value) })), feeToken: tempoFeeToken, nonceKey: 0n, nonce: BigInt(transaction.nonce), validBefore: transaction.valid_before, gas: BigInt(transaction.gas_limit), maxFeePerGas: BigInt(transaction.max_fee_per_gas), maxPriorityFeePerGas: BigInt(transaction.max_priority_fee_per_gas) })
  const payload = TxEnvelopeTempo.getSignPayload(actual)
  if (payload !== TxEnvelopeTempo.getSignPayload(expected) || !actual.signature || SignatureEnvelope.extractAddress({ payload, signature: actual.signature }).toLowerCase() !== account.toLowerCase()) throw new Error('Tempo transaction differs from approved terms')
  return TxEnvelopeTempo.hash({ ...actual, signature: actual.signature })
}
