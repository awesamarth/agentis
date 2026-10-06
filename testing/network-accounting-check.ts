// Isolated local schema. No signers, broadcasts, workers or real wallet rows.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import { OperationService } from '../apps/backend/src/operations'
import { profileSummary } from '../apps/backend/src/modules/profile'
import * as tables from '../apps/backend/src/db/schema'
import type { Executor } from '../apps/backend/src/providers/types'

const url = process.env.DATABASE_URL!
const parsed = new URL(url)
assert(['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.port === '55432', 'Local Postgres only')
const admin = postgres(url, { max: 1 }), schema = `network_check_${randomBytes(6).toString('hex')}`
await admin.unsafe(`CREATE SCHEMA ${schema}`)
const connection = postgres(url, { max: 4, connection: { search_path: schema } })
try {
  for (const table of ['agents', 'wallets', 'operations', 'onboarding', 'grants']) await admin.unsafe(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`)
  const db = drizzle(connection, { schema: tables }), ownerId = `fixture-${schema}`, agentId = crypto.randomUUID()
  const deny = async (): Promise<never> => { throw Error('Signing and execution forbidden') }
  const executor: Executor = { id: 'privy', validate() {}, prepare: deny, broadcast: deny, receipt: deny }
  const service = new OperationService(db, executor, {}, 'http://localhost:3000', async () => ({ assetPrice: '1000000000000000000', feePrice: '1000000000000000000', assetDecimals: 6, feeDecimals: 18, expiresAt: Date.now() + 60_000 }))
  const principal = { kind: 'owner' as const, ownerId }
  await db.insert(tables.agents).values({ id: agentId, ownerId, name: 'fixture', mode: 'ask', networks: ['base', 'ethereum', 'base-sepolia', 'sepolia'], defaultNetwork: 'base', limits: { perTransaction: '1000000', hourly: '1000000', daily: '1000000', total: '1000000' }, allowedRecipients: [] })
  const policy = { mode: 'ask' as const, budgetMode: 'usd' as const, maxDailyAtomic: '0', maxLifetimeAtomic: '0', maxPerOperationAtomic: '0', allowedRecipients: [] }
  const wallets = await db.insert(tables.wallets).values(['eip155:8453', 'eip155:1', 'eip155:84532', 'eip155:11155111'].map(chainId => ({ ownerId, agentId, chainId, provider: 'privy', providerWalletId: crypto.randomUUID(), address: '0x0000000000000000000000000000000000000011', policy, enabled: true, serverAuthorized: true }))).returning()
  const request = (index: number, amountAtomic: string, key = crypto.randomUUID()) => service.create(principal, { walletId: wallets[index]!.id, chainId: wallets[index]!.chainId, action: 'transfer', asset: 'native', to: '0x0000000000000000000000000000000000000022', amountAtomic, maxFeeAtomic: '1' }, key)
  const key = crypto.randomUUID(), main = await request(0, '600000', key)
  assert.equal(main.status, 'pending_approval')
  assert.equal((await request(0, '600000', key)).id, main.id, 'Idempotent retry retains one reservation')
  const simulated = await request(2, '600000')
  assert.equal(simulated.status, 'pending_approval', 'Testnet must not consume mainnet allowance')
  assert.equal((await request(1, '500000')).status, 'denied', 'Mainnet networks share one allowance')
  assert.equal((await request(3, '500000')).status, 'denied', 'Testnets share their own allowance')
  for (const index of [0, 2]) {
    const policy = await service.policyView(principal, wallets[index]!.id)
    assert.equal(policy.environment, index === 0 ? 'mainnet' : 'testnet')
    assert.equal(policy.reservedMicros, '600001')
  }
  // Simulate receipt accounting without executing a payment.
  await db.update(tables.operations).set({ status: 'confirmed', usdSettledMicros: '100000', settledAt: new Date() }).where(eq(tables.operations.id, main.id))
  await db.update(tables.operations).set({ status: 'confirmed', usdSettledMicros: '900000', settledAt: new Date() }).where(eq(tables.operations.id, simulated.id))
  const summary = await profileSummary(service, ownerId) as { totalSpendMicros: string }
  assert.equal(summary.totalSpendMicros, '100000', 'Profile must exclude simulated spending')
  await db.update(tables.wallets).set({ enabled: false }).where(eq(tables.wallets.id, wallets[0]!.id))
  assert.equal((await request(0, '1')).status, 'denied', 'Disabled network cannot reserve or execute a new payment')
  console.log('Network accounting check passed: isolated allowances, shared cross-chain limits, idempotency, mainnet analytics, disabled wallets; no execution.')
} finally {
  await connection.end()
  await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
  await admin.end()
}
