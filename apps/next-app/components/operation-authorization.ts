import { encodeFunctionData, erc20Abi } from 'viem'
import type { Operation } from '@agentis-hq/sdk'

// Verify the request against the operation the human reviewed before asking their
// Privy user key to sign. Never expose a general-purpose request-signing button.
export function assertTransferAuthorization(operation: Operation, request: Awaited<ReturnType<import('@agentis-hq/sdk').AgentisClient['operations']['authorization']>>, appId: string) {
  const body = request.body
  const params = body.params as { transaction?: Record<string, unknown> } | undefined
  const tx = params?.transaction
  const tempo = operation.chainId === 'eip155:42431'
  const keys = ['type', 'chain_id', 'nonce', 'gas_limit', 'max_fee_per_gas', 'max_priority_fee_per_gas', ...(tempo ? ['calls', 'fee_token', 'nonce_key', 'valid_before'] : ['to', 'value', 'data'])]
  if (request.version !== 1 || request.method !== 'POST' || !/^https:\/\/api\.privy\.io\/v1\/wallets\/[A-Za-z0-9_-]+\/rpc$/.test(request.url) || request.headers['privy-app-id'] !== appId || request.headers['privy-idempotency-key'] !== operation.id || Number(request.headers['privy-request-expiry']) !== Date.parse(operation.expiresAt) || Date.parse(operation.expiresAt) <= Date.now() || body.method !== 'eth_signTransaction' || Object.keys(body).length !== 2 || !params || Object.keys(params).length !== 1 || !tx || Object.keys(tx).some(key => !keys.includes(key))) throw new Error('Authorization request does not match this operation')
  const to = operation.asset === 'native' ? operation.to : operation.asset.slice(6)
  const data = operation.asset === 'native' ? '0x' : encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [operation.to as `0x${string}`, BigInt(operation.amountAtomic)] })
  if (tempo && (!Array.isArray(tx.calls) || tx.calls.length !== 1 || String(tx.fee_token).toLowerCase() !== '0x20c0000000000000000000000000000000000001' || BigInt(String(tx.nonce_key)) !== 0n || tx.valid_before !== Math.floor(Date.parse(operation.expiresAt) / 1000))) throw new Error('Tempo authorization differs from the reviewed payment')
  const call = tempo ? (tx.calls as Record<string, unknown>[])[0]! : tx
  if (tempo && Object.keys(call).some(key => !['to', 'value', 'data'].includes(key))) throw new Error('Unexpected Tempo call fields')
  if (tx.type !== (tempo ? 118 : 2) || `eip155:${tx.chain_id}` !== operation.chainId || String(call.to).toLowerCase() !== to.toLowerCase() || BigInt(String(call.value)) !== (operation.asset === 'native' ? BigInt(operation.amountAtomic) : 0n) || String(call.data).toLowerCase() !== data.toLowerCase() || BigInt(String(tx.gas_limit)) <= 0n || BigInt(String(tx.max_fee_per_gas)) < 0n || BigInt(String(tx.gas_limit)) * BigInt(String(tx.max_fee_per_gas)) > BigInt(operation.maxFeeAtomic)) throw new Error('Transaction differs from the payment you reviewed')
}
