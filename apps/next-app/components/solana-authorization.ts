import { Connection } from '@solana/web3.js'
import { getTokenSize } from '@solana-program/token'
import { assertSolanaTransfer, solanaDevnet } from '@agentis-hq/core/solana-transfer'
import type { Operation, AgentisClient } from '@agentis-hq/sdk'

export async function assertSolanaAuthorization(operation: Operation, request: Awaited<ReturnType<AgentisClient['operations']['authorization']>>, appId: string, walletAddress: string) {
  const params = request.body.params as { transaction?: string; encoding?: string } | undefined
  if (operation.chainId !== solanaDevnet || request.version !== 1 || request.method !== 'POST' || !/^https:\/\/api\.privy\.io\/v1\/wallets\/[A-Za-z0-9_-]+\/rpc$/.test(request.url) || request.headers['privy-app-id'] !== appId || request.headers['privy-idempotency-key'] !== operation.id || Number(request.headers['privy-request-expiry']) !== Date.parse(operation.expiresAt) || Date.parse(operation.expiresAt) <= Date.now() || request.body.method !== 'signTransaction' || Object.keys(request.body).length !== 2 || !params || Object.keys(params).length !== 2 || params.encoding !== 'base64' || typeof params.transaction !== 'string' || params.transaction.length > 8192) throw new Error('Invalid Solana authorization request')
  const transaction = await assertSolanaTransfer(walletAddress, operation, params.transaction)
  const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed')
  if (!(await connection.getGenesisHash()).startsWith(solanaDevnet.slice(7))) throw new Error('Expected Solana devnet')
  const fee = (await connection.getFeeForMessage(transaction.compileMessage())).value
  const rent = operation.asset === 'native' ? 0n : BigInt(await connection.getMinimumBalanceForRentExemption(getTokenSize()))
  if (fee === null || BigInt(fee) + rent > BigInt(operation.maxFeeAtomic)) throw new Error('Solana fee or account rent exceeds the reviewed budget')
}
