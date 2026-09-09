// Explicit Solana devnet proof; no local/EVM key is imported into Privy.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { PublicKey } from '@solana/web3.js'
import { PrivyClient } from '@privy-io/node'
import { and, eq } from 'drizzle-orm'
import { solanaConnection, solanaDevnet, solanaUsdc } from '../apps/backend/src/modules/solana'
import { createPrivyExecutor } from '../apps/backend/src/providers/privy-executor'
import { connectDatabase } from '../apps/backend/src/db'
import { wallets } from '../apps/backend/src/db/schema'
import { OperationService } from '../apps/backend/src/operations'
import { pluginConfig } from '../apps/backend/src/plugins'

assert(process.argv[2] === '--execute', 'Explicit --execute required')
const tokenTest = process.argv[3] === 'usdc'
assert(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET, 'Private Privy environment required')
const file = new URL('../.agentis-test-keys/privy-authorization-probe.json', import.meta.url)
const state = JSON.parse(readFileSync(file, 'utf8')) as { publicKey: string; privateKey: string; solanaWalletId?: string; solanaRecipientId?: string; airdropStarted?: boolean; airdropSignature?: string }
const save = () => writeFileSync(file, JSON.stringify(state), { mode: 0o600 })
const privy = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET })
for (const key of ['solanaWalletId', 'solanaRecipientId'] as const) {
  if (!state[key]) {
    const externalId = `agentis_proof_${key}_v1`
    const existing = await privy.wallets().list({ external_id: externalId })
    const wallet = existing.data[0] ?? await privy.wallets().create({ chain_type: 'solana', owner: { public_key: state.publicKey }, external_id: externalId, idempotency_key: externalId })
    state[key] = wallet.id; save()
  }
}
const inspect = async (id: string) => {
  assert([state.solanaWalletId, state.solanaRecipientId].includes(id))
  const wallet = await privy.wallets().get(id)
  assert(wallet.owner_id && wallet.chain_type === 'solana')
  const owner = await privy.keyQuorums().get(wallet.owner_id)
  assert(owner.authorization_keys.some(key => key.public_key === state.publicKey))
  return { ...wallet, serverAuthorized: true }
}
const source = await inspect(state.solanaWalletId!)
const destination = await inspect(state.solanaRecipientId!)
const rpc = solanaConnection()
assert((await rpc.getGenesisHash()).startsWith(solanaDevnet.slice(7)), 'Devnet only')
const address = new PublicKey(source.address)
if (BigInt(await rpc.getBalance(address)) < 1_010_000n) {
  if (!state.airdropStarted) {
    state.airdropStarted = true; save()
    try { state.airdropSignature = await rpc.requestAirdrop(address, 100_000_000); save() }
    catch (error) { console.log(JSON.stringify({ step: 'devnet faucet unavailable', address: source.address, error: (error as Error).name })); throw new Error('Fund this isolated hosted wallet with devnet SOL to continue') }
  }
  for (let i = 0; i < 30 && BigInt(await rpc.getBalance(address)) < 1_010_000n; i++) await Bun.sleep(1000)
  assert(BigInt(await rpc.getBalance(address)) >= 1_010_000n, `Devnet SOL funding required: ${source.address}`)
}
const connection = connectDatabase('postgres://agentis:agentis-local-only@127.0.0.1:55432/agentis_dev')
try {
  const ownerId = 'isolated-privy-provider-proof'
  await connection.db.insert(wallets).values({ ownerId, provider: 'privy-probe', providerWalletId: source.id, address: source.address, chainId: solanaDevnet, policy: { mode: 'ask', maxPerOperationAtomic: '10000000', maxDailyAtomic: '10000000', maxLifetimeAtomic: '10000000', allowedRecipients: [destination.address] } }).onConflictDoNothing()
  const [wallet] = await connection.db.select().from(wallets).where(and(eq(wallets.ownerId, ownerId), eq(wallets.chainId, solanaDevnet)))
  assert(wallet)
  const executor = { ...createPrivyExecutor(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET, inspect, state.privateKey), id: 'privy-probe' }
  const service = new OperationService(connection.db, executor, pluginConfig.parse({}), 'http://localhost:3000')
  const principal = { kind: 'owner' as const, ownerId }
  const asset = tokenTest ? `spl:${solanaUsdc}` as const : 'native'
  if (tokenTest && !wallet.policy.tokenLimits?.[asset]) await service.setPolicy(principal, wallet.id, { ...wallet.policy, tokenLimits: { ...wallet.policy.tokenLimits, [asset]: { perOperation: '10000', daily: '10000', lifetime: '10000' } } })
  const operation = await service.create(principal, { walletId: wallet.id, action: 'transfer', asset, chainId: solanaDevnet, to: destination.address, amountAtomic: tokenTest ? '10000' : '1000000', maxFeeAtomic: tokenTest ? '3000000' : '10000', reason: 'Isolated Privy Solana devnet authorization proof' }, tokenTest ? 'hosted-solana-usdc-proof-v1' : 'hosted-solana-proof-v1')
  if (operation.status === 'pending_approval') {
    await service.decide(principal, operation.id, operation.operationHash, true)
  }
  for (let i = 0; i < 30; i++) {
    await service.tick()
    const result = await service.get(principal, operation.id)
    if (result.status === 'confirmed') { console.log(JSON.stringify({ step: 'hosted Solana confirmed', asset, destination: destination.address, operationId: result.id, receipt: result.receipt, browserUserFlow: 'not exercised by this key-owned test' })); break }
    assert(!['failed', 'expired', 'denied', 'rejected'].includes(result.status), `Inspect operation ${result.id}: ${result.status}`)
    assert(i < 29, `Reconcile operation ${result.id}; never blindly resend`)
    await Bun.sleep(2000)
  }
} finally { await connection.close() }
