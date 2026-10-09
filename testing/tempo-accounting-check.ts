// Isolated local database + fake executor. No real wallet rows, RPC, signing or funds.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import { OperationService } from '../apps/backend/src/operations'
import * as tables from '../apps/backend/src/db/schema'
import { tempoTokens } from '../packages/core/src/networks'
import type { Executor } from '../apps/backend/src/providers/types'
import type { Operation } from '../packages/core/src/operations'

const url = process.env.DATABASE_URL!, parsed = new URL(url)
assert(['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.port === '55432', 'Isolated local Postgres only')
const admin = postgres(url, { max: 1 }), schema = `tempo_check_${randomBytes(6).toString('hex')}`
await admin.unsafe(`CREATE SCHEMA ${schema}`)
const connection = postgres(url, { max: 4, connection: { search_path: schema } })
try {
  for (const table of ['agents', 'wallets', 'operations', 'onboarding', 'grants']) await admin.unsafe(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`)
  const db = drizzle(connection, { schema: tables }), ownerId = `fixture-${schema}`, agentId = crypto.randomUUID()
  const principal = { kind: 'owner' as const, ownerId }, recipient = '0x0000000000000000000000000000000000000011'
  await db.insert(tables.agents).values({ id: agentId, ownerId, name: 'fixture', mode: 'ask', networks: ['tempo'], defaultNetwork: 'tempo', limits: { perTransaction: '10000000', hourly: '10000000', daily: '10000000', total: '10000000' }, allowedRecipients: [] })
  const [wallet] = await db.insert(tables.wallets).values({ ownerId, agentId, chainId: 'eip155:4217', provider: 'privy', providerWalletId: crypto.randomUUID(), address: recipient, enabled: true, serverAuthorized: true, policy: { mode: 'ask', budgetMode: 'usd', maxPerOperationAtomic: '0', maxDailyAtomic: '0', maxLifetimeAtomic: '0', allowedRecipients: [] } }).returning()
  const hash = `0x${'11'.repeat(32)}`
  let prepared = 0, broadcast = 0, receipt: Operation['receipt'] = null
  const executor: Executor = {
    id: 'privy', validate() {},
    async prepare(_wallet, input) { prepared++; assert.equal(input.feeAsset, `erc20:${tempoTokens.pathUSD}`); return { signedTransaction: 'fixture-proof-not-a-transaction', transactionHash: hash } },
    async broadcast() {
      broadcast++
      const [row] = await db.select().from(tables.operations).where(eq(tables.operations.transactionHash, hash))
      assert.equal(row!.status, 'submitting'); assert.equal(row!.signedTransaction, 'fixture-proof-not-a-transaction')
      throw Error('Simulated uncertain submission')
    },
    async receipt() { return receipt },
  }
  const service = new OperationService(db, executor, {}, 'http://localhost:3000', async input => {
    assert.equal(input.asset.toLowerCase(), `erc20:${tempoTokens.OUSD}`)
    return { assetPrice: '2000000000000000000', feePrice: input.feeAsset === `erc20:${tempoTokens.pathUSD}` ? '3000000000000000000' : '2000000000000000000', assetDecimals: 6, feeDecimals: 18, expiresAt: Date.now() + 60_000 }
  })
  service.plugins.tick = async () => {} // Plugin scheduling is outside this fixture.
  const body = { walletId: wallet!.id, chainId: wallet!.chainId, action: 'transfer', asset: `erc20:${tempoTokens.OUSD}`, feeAsset: `erc20:${tempoTokens.pathUSD}`, to: recipient, amountAtomic: '1000000', maxFeeAtomic: '10000000000000000' }
  const payment = await service.create(principal, body, 'separate-fees')
  assert.equal(payment.status, 'pending_approval')
  assert.equal(payment.feeAsset, body.feeAsset)
  assert.equal(payment.usdReservedMicros, '2050300', '$2 payment + $0.03 maximum fees + 1% reviewed USD price headroom')
  assert.equal((await service.create(principal, body, 'separate-fees')).id, payment.id)
  await assert.rejects(service.create(principal, { ...body, feeAsset: body.asset }, 'separate-fees'), /different operation/)
  await assert.rejects(service.decide(principal, payment.id, '00'.repeat(32), true), /does not match/)
  await service.decide(principal, payment.id, payment.operationHash, true)
  const oldError = console.error
  try { console.error = () => {}; await service.tick() } finally { console.error = oldError }
  assert.equal((await service.get(principal, payment.id)).status, 'unknown')
  assert.equal((await service.policyView(principal, wallet!.id)).reservedMicros, '2050300')
  await service.tick()
  assert.equal(prepared, 1); assert.equal(broadcast, 1, 'Unknown submission must never be resent')
  receipt = { transactionHash: hash, chainId: wallet!.chainId, blockNumber: '1', success: true, feeAtomic: '1000000000000000', feePayment: { asset: body.feeAsset, amountAtomic: '1000', decimals: 6 } }
  await service.tick()
  const settled = await service.get(principal, payment.id)
  assert.equal(settled.status, 'confirmed'); assert.equal(settled.usdSettledMicros, '2003000')
  assert.equal(settled.receipt!.feePayment!.asset, body.feeAsset)
  const [row] = await db.select().from(tables.operations).where(eq(tables.operations.id, payment.id))
  assert.equal(row!.signedTransaction, null)

  const { feeAsset: _, ...implicit } = body
  const defaultFee = await service.create(principal, implicit, 'default-fee')
  assert.equal(defaultFee.feeAsset!.toLowerCase(), body.asset)
  assert.equal((await service.create(principal, implicit, 'default-fee')).id, defaultFee.id)
  await db.update(tables.operations).set({ expiresAt: new Date(0) }).where(eq(tables.operations.id, defaultFee.id))
  await service.tick()
  assert.equal((await service.get(principal, defaultFee.id)).status, 'expired')
  assert.equal(prepared, 1, 'Expired approvals must never reach preparation')
  const unavailable = new OperationService(db, executor, {}, 'http://localhost:3000', async () => { throw Error('Oracle unavailable') })
  await assert.rejects(unavailable.create(principal, body, 'no-price'), /fresh USD price/)
  const { mock } = await import('bun:test')
  const mpp = await import('../apps/backend/src/modules/mpp')
  mock.module('../apps/backend/src/modules/mpp', () => ({ ...mpp, discoverMpp: async () => ({ ...body, action: 'paid_fetch', mpp: { mode: 'push', url: 'https://example.com/paid', challenge: 'fixture-only', maxAmountAtomic: body.amountAtomic, expiresAt: new Date(Date.now() + 300_000).toISOString() } }) }))
  const push = await service.fetch(principal, { walletId: wallet!.id, url: 'https://example.com/paid', maxAmountAtomic: body.amountAtomic, maxFeeAtomic: body.maxFeeAtomic, feeAsset: body.feeAsset }, 'push-response-race')
  await service.decide(principal, push.id, push.operationHash, true)
  executor.broadcast = async () => {
    const [saved] = await db.select().from(tables.operations).where(eq(tables.operations.id, push.id))
    assert.equal(saved!.signedTransaction, 'fixture-proof-not-a-transaction')
    await service.tick() // Another worker settles before the provider finishes its body.
    assert.equal((await service.get(principal, push.id)).status, 'confirmed')
    return { status: 200, headers: {}, bodyBase64: Buffer.from('paid result').toString('base64') }
  }
  await service.tick()
  const delivered = await service.get(principal, push.id)
  assert.equal(delivered.status, 'confirmed', 'Late HTTP delivery must not regress settlement')
  assert.equal(delivered.httpResponse?.bodyBase64, Buffer.from('paid result').toString('base64'), 'Keep the provider response after concurrent settlement')
  console.log('Tempo accounting passed: independent fee valuation, exact approvals, idempotency, proof-before-submit, unknown retention/no resend, settlement, defaults, expiry and unavailable prices. No real execution.')
} finally {
  await connection.end(); await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`); await admin.end()
}
