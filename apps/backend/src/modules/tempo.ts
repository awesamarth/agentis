import { createWalletClient, http, toHex, type Address, type Hex } from 'viem'
import { tempo } from 'viem/chains'
import { requireNetwork } from '@agentis-hq/core/networks'
import { getTransactionCount } from 'viem/actions'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'

import { tempoFeeAsset } from '@agentis-hq/core/tempo'
export { tempoFeeScale, roundedTempoFee } from '@agentis-hq/core/tempo'

export async function prepareTempoTransfer(account: Address, call: { to: Address; value: bigint; data: Hex }, expiresAt: Date, rpcUrl?: string, chainId = 'eip155:4217', feeAsset?: string) {
  const network = requireNetwork(chainId)
  if (network.family !== 'tempo' || !network.feeToken) throw Error('Unsupported Tempo network')
  const chain = network.chain as typeof tempo
  const feeToken = tempoFeeAsset({ chainId, feeAsset }).id.slice(6) as Address
  const client = createWalletClient({ chain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 0 }) })
  const nonce = await getTransactionCount(client, { address: account, blockTag: 'pending' })
  const tx = await client.prepareTransactionRequest({ account, nonce, type: 'tempo', calls: [call], feeToken, nonceKey: 0n, validBefore: Math.floor(expiresAt.getTime() / 1000) })
  if (tx.maxFeePerGas === undefined || tx.maxPriorityFeePerGas === undefined) throw new Error('Tempo fee estimate missing')
  return { type: 118, chain_id: chain.id, calls: [{ to: call.to, value: toHex(call.value), data: call.data }], fee_token: feeToken, nonce_key: '0x0', nonce: tx.nonce, valid_before: Math.floor(expiresAt.getTime() / 1000), gas_limit: toHex(tx.gas), max_fee_per_gas: toHex(tx.maxFeePerGas), max_priority_fee_per_gas: toHex(tx.maxPriorityFeePerGas) }
}

export function verifyTempoTransfer(serialized: Hex, account: Address, transaction: Awaited<ReturnType<typeof prepareTempoTransfer>>) {
  const actual = TxEnvelopeTempo.deserialize(serialized as `0x76${string}`)
  const expected = TxEnvelopeTempo.from({ chainId: transaction.chain_id, calls: transaction.calls.map(call => ({ to: call.to, data: call.data, value: BigInt(call.value) })), feeToken: transaction.fee_token, nonceKey: 0n, nonce: BigInt(transaction.nonce), validBefore: transaction.valid_before, gas: BigInt(transaction.gas_limit), maxFeePerGas: BigInt(transaction.max_fee_per_gas), maxPriorityFeePerGas: BigInt(transaction.max_priority_fee_per_gas) })
  const payload = TxEnvelopeTempo.getSignPayload(actual)
  if (!actual.validBefore || actual.validBefore * 1000 <= Date.now() || payload !== TxEnvelopeTempo.getSignPayload(expected) || !actual.signature || SignatureEnvelope.extractAddress({ payload, signature: actual.signature }).toLowerCase() !== account.toLowerCase()) throw new Error('Tempo transaction differs from approved terms')
  return TxEnvelopeTempo.hash({ ...actual, signature: actual.signature })
}
