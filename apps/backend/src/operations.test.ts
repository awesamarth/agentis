import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { eq } from 'drizzle-orm'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, createTestClient, http, parseEther } from 'viem'
import { foundry } from 'viem/chains'
import { connectDatabase } from './db'
import { wallets, operations, grants, onboarding } from './db/schema'
import { OperationService, type Principal } from './operations'
import { pluginConfig } from './plugins'
import { createApp } from './app'
import { createAnvilExecutor } from './providers/anvil'
import type { Executor } from './providers/types'
import type { Operation, OperationInput, WalletPolicy } from '@agentis-hq/core/operations'

const url = process.env.AGENTIS_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const owner: Principal = { kind: 'owner', ownerId: 'owner-a' }
const recipient = '0x0000000000000000000000000000000000001234'
const policy: WalletPolicy = { mode: 'ask', maxPerOperationAtomic: '100', maxDailyAtomic: '100', maxLifetimeAtomic: '100', allowedRecipients: [] }

suite('transactional execution foundation (isolated PostgreSQL)', () => {
  let connection: ReturnType<typeof connectDatabase>
  let admin: ReturnType<typeof postgres>
  const name = `agentis_test_${randomUUID().replaceAll('-', '')}`
  beforeAll(async () => {
    const parsed = new URL(url!)
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('Tests refuse non-loopback PostgreSQL')
    admin = postgres(url!, { max: 1 })
    await admin.unsafe(`CREATE DATABASE "${name}"`)
    parsed.pathname = `/${name}`
    connection = connectDatabase(parsed.toString())
    await migrate(connection.db, { migrationsFolder: join(import.meta.dir, '../drizzle') })
  })
  afterAll(async () => {
    if (connection) await connection.close()
    if (admin) { await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end() }
  })

  async function setup(overrides: Partial<WalletPolicy> = {}) {
    let broadcasts = 0, preparations = 0, uncertain = false
    const receipts = new Map<string, Operation['receipt']>()
    const executor: Executor = {
      id: `fake-${randomUUID()}`,
      validate(wallet, input) { if (input.chainId !== wallet.chainId) throw new Error('Wrong chain') },
      async prepare(_wallet, input) {
        preparations++
        const transactionHash = `0x${randomUUID().replaceAll('-', '').padEnd(64, '0')}`
        receipts.set(transactionHash, { transactionHash, chainId: input.chainId, blockNumber: '1', feeAtomic: '1', success: true })
        return { signedTransaction: transactionHash, transactionHash }
      },
      async broadcast() { broadcasts++; if (uncertain) throw new Error('Timeout AFTER submission') },
      async receipt(id) { return receipts.get(id) ?? null },
    }
    const [wallet] = await connection.db.insert(wallets).values({ ownerId: owner.ownerId, provider: executor.id, providerWalletId: randomUUID(), address: recipient, chainId: 'eip155:31337', policy: { ...policy, ...overrides } }).returning()
    const service = new OperationService(connection.db, executor, pluginConfig.parse({}), 'http://localhost:3000')
    const input: OperationInput = { walletId: wallet!.id, action: 'transfer', chainId: 'eip155:31337', asset: 'native', to: recipient, amountAtomic: '9', maxFeeAtomic: '1', reason: 'test payment' }
    const grant = await service.createGrant(owner, { walletId: wallet!.id, agentName: 'test-agent', expiresAt: new Date(Date.now() + 60_000).toISOString() })
    const agent: Principal = { kind: 'agent', ownerId: owner.ownerId, grantId: grant.id }
    const app = createApp(service, { async authenticate(token) { if (token === 'owner-a' || token === 'owner-b') return token; throw new Error('invalid') } }, [])
    return { service, input, wallet: wallet!, grant, agent, app, executor, receipts, counts: () => ({ broadcasts, preparations }), loseResponse: () => { uncertain = true } }
  }

  test('ask mode waits for an owner button approval, without a wallet signature', async () => {
    const s = await setup()
    const row = await s.service.create(s.agent, s.input, 'button-approval')
    await s.service.tick()
    expect(s.counts().preparations).toBe(0)
    await expect(s.service.decide(s.agent, row.id, row.operationHash, true)).rejects.toThrow('Only the wallet owner')
    await s.service.decide(owner, row.id, row.operationHash, true)
    await s.service.tick(); await s.service.tick()
    expect((await s.service.get(s.agent, row.id)).status).toBe('confirmed')
  })
  test('token reservations never mix token atomic units with native fee units', async () => {
    const asset = 'erc20:0x0000000000000000000000000000000000004321' as const
    const s = await setup({ maxDailyAtomic: '5', maxLifetimeAtomic: '5', tokenLimits: { [asset]: { perOperation: '10000000', daily: '10000000', lifetime: '10000000' } } })
    const input = { ...s.input, asset, amountAtomic: '6000000' }
    const rows = await Promise.all([s.service.create(s.agent, input, 'token-1'), s.service.create(s.agent, input, 'token-2')])
    expect(rows.filter(row => row.status === 'pending_approval')).toHaveLength(1)
    expect(rows.filter(row => row.status === 'denied')).toHaveLength(1)
    expect((await s.service.create(s.agent, { ...input, asset: 'erc20:0x0000000000000000000000000000000000004322' }, 'unapproved-asset')).status).toBe('denied')
  })
  test('agents have independent wallets and enforced limits; editing one preserves the other', async () => {
    const s = await setup()
    const executor: Executor = { ...s.executor, id: 'privy' }
    const service = new OperationService(connection.db, executor, pluginConfig.parse({}), 'http://localhost:3000', async () => ({ assetPrice: '1000000000000000000', feePrice: '1000000000000000000', assetDecimals: 0, feeDecimals: 0, expiresAt: Date.now() + 30_000 }))
    const principal: Principal = { kind: 'owner', ownerId: 'onboarding-user' }
    let authorizationCalls = 0
    const app = createApp(service, { authenticate: async token => token === 'other' ? 'other-user' : principal.ownerId, enableServerExecution: async () => { authorizationCalls++; return { serverAuthorized: true } },  createWallet: async (_owner, chainType, agentId) => ({ providerWalletId: `${agentId}-${chainType}`, address: `0x${agentId!.replaceAll('-', '').padEnd(40, '0')}`, chainType }) }, [])
    const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' }
    const a = randomUUID(), b = randomUUID()
    const settings = { name: 'Research', selection: { networks: ['base', 'arc'], defaultNetwork: 'base' }, limits: { perTransaction: '10', hourly: '100', daily: '100', total: '100' }, mode: 'ask', allowedRecipients: [] }
    const submit = (id: string, body: object, method = 'PATCH') => app.request(`/v1/agents${method === 'POST' ? '' : `/${id}`}`, { method, headers, body: JSON.stringify({ ...body, id }) })
    expect((await app.request('/v1/agents', { headers: { authorization: `Bearer ${s.grant.token}` } })).status).toBe(403)
    expect((await submit(a, settings, 'POST')).status).toBe(200)
    expect((await submit(a, settings, 'POST')).status).toBe(200)
    expect((await submit(b, { ...settings, name: 'Trading' }, 'POST')).status).toBe(200)
    const before = await connection.db.select().from(wallets).where(eq(wallets.ownerId, principal.ownerId))
    expect(before).toHaveLength(4)
    const wa = before.find(wallet => wallet.agentId === a && wallet.chainId === 'eip155:84532')!
    const wb = before.find(wallet => wallet.agentId === b && wallet.chainId === 'eip155:84532')!
    expect(wa.address).not.toBe(wb.address)
    const inputA = { ...s.input, walletId: wa.id, chainId: wa.chainId }
    const paid = await service.create(principal, inputA, 'agent-a-payment')
    await service.decide(principal, paid.id, paid.operationHash, true)
    await service.tick(); await service.tick()
    expect((await service.get(principal, paid.id)).usdSettledMicros).toBe('10000000')
    const pendingB = await service.create(principal, { ...s.input, walletId: wb.id, chainId: wb.chainId }, 'agent-b-payment')
    expect(pendingB.status).toBe('pending_approval')
    const callsBeforeRename = authorizationCalls
    expect((await submit(b, { ...settings, name: 'Trading renamed' })).status).toBe(200)
    expect((await submit(b, { ...settings, name: 'Trading renamed' })).status).toBe(200)
    expect(authorizationCalls).toBe(callsBeforeRename)
    for (const [key, limit, message] of [['perTransaction', '9', 'Per-payment'], ['hourly', '19', 'Hourly'], ['daily', '19', 'Daily'], ['total', '19', 'Total']]) {
      expect((await submit(a, { ...settings, mode: 'automatic', limits: { ...settings.limits, [key!]: limit }, selection: { networks: ['base'], defaultNetwork: 'base' } })).status).toBe(200)
      const denied = await service.create(principal, inputA, `limit-${key}`)
      expect(denied.status).toBe('denied')
      expect(denied.error).toContain(message!)
    }
    expect((await submit(a, { ...settings, mode: 'automatic', selection: { networks: ['base'], defaultNetwork: 'base' } })).status).toBe(200)
    const delegated = await service.createGrant(principal, { walletId: wa.id, agentName: 'Research', expiresAt: new Date(Date.now() + 60_000).toISOString() })
    const auto = await service.create({ kind: 'agent', ownerId: principal.ownerId, grantId: delegated.id }, inputA, 'automatic-payment')
    expect(auto.status).toBe('queued')
    await service.tick(); await service.tick()
    expect((await service.get(principal, auto.id)).status).toBe('confirmed')
    expect((await service.get(principal, pendingB.id)).status).toBe('pending_approval')
    const after = await connection.db.select().from(wallets).where(eq(wallets.ownerId, principal.ownerId))
    expect(after.filter(wallet => wallet.agentId === b)).toEqual(before.filter(wallet => wallet.agentId === b))
    expect(after.find(wallet => wallet.agentId === a && wallet.chainId === 'eip155:5042002')?.enabled).toBe(false)
    expect(new Set(after.map(wallet => wallet.id))).toEqual(new Set(before.map(wallet => wallet.id)))
    expect((await app.request(`/v1/agents/${a}`, { method: 'PATCH', headers: { ...headers, authorization: 'Bearer other' }, body: JSON.stringify(settings) })).status).toBe(404)
  })

  test('shared USD budget serializes different wallets, blocks price increases and charges fixed execution rates', async () => {
    const s = await setup({ budgetMode: 'usd' })
    const principal: Principal = { kind: 'owner', ownerId: randomUUID() }
    await connection.db.update(wallets).set({ ownerId: principal.ownerId }).where(eq(wallets.id, s.wallet.id))
    const [second] = await connection.db.insert(wallets).values({ ...s.wallet, id: randomUUID(), providerWalletId: randomUUID(), ownerId: principal.ownerId }).returning()
    await connection.db.insert(onboarding).values({ ownerId: principal.ownerId, networks: ['base'], defaultNetwork: 'base', totalBudgetUsdMicros: '15000000' })
    let price = '1000000000000000000', stale = false
    const service = new OperationService(connection.db, s.executor, pluginConfig.parse({}), 'http://localhost:3000', async () => ({ assetPrice: price, feePrice: price, assetDecimals: 0, feeDecimals: 0, expiresAt: Date.now() + (stale ? -1 : 30_000) }))
    const a = await service.createGrant(principal, { walletId: s.wallet.id, agentName: 'A', expiresAt: new Date(Date.now() + 60_000).toISOString() })
    const b = await service.createGrant(principal, { walletId: second!.id, agentName: 'B', expiresAt: new Date(Date.now() + 60_000).toISOString() })
    const results = await Promise.all([service.create({ kind: 'agent', ownerId: principal.ownerId, grantId: a.id }, s.input, 'usd-a'), service.create({ kind: 'agent', ownerId: principal.ownerId, grantId: b.id }, { ...s.input, walletId: second!.id }, 'usd-b')])
    expect(results.filter(row => row.status === 'pending_approval')).toHaveLength(1)
    expect(results.filter(row => row.status === 'denied')).toHaveLength(1)
    const approved = results.find(row => row.status === 'pending_approval')!
    expect(approved.usdReservedMicros).toBe('10000000')
    await service.decide(principal, approved.id, approved.operationHash, true)
    price = '2000000000000000000'
    await service.tick()
    expect((await service.get(principal, approved.id)).status).toBe('denied')
    expect(s.counts().preparations).toBe(0)
    price = '1000000000000000000'
    const payment = await service.create(principal, s.input, 'usd-c')
    await service.decide(principal, payment.id, payment.operationHash, true)
    await service.tick()
    price = '3000000000000000000'
    await service.tick()
    expect((await service.get(principal, payment.id)).usdSettledMicros).toBe('10000000')
    stale = true
    expect((await service.create(principal, s.input, 'usd-c')).id).toBe(payment.id)
    await expect(service.create(principal, s.input, 'usd-stale')).rejects.toThrow('expired')
  })

  test('eight concurrent requests with one key create one operation/reservation', async () => {
    const s = await setup()
    const results = await Promise.all(Array.from({ length: 8 }, () => s.service.create(s.agent, s.input, 'same')))
    expect(new Set(results.map(row => row.id)).size).toBe(1)
    expect((await s.service.list(s.agent)).length).toBe(1)
    await expect(s.service.create(s.agent, { ...s.input, amountAtomic: '8' }, 'same')).rejects.toThrow('different operation')
  })
  test('concurrent different keys reserve budgets atomically', async () => {
    const s = await setup({ maxDailyAtomic: '30', maxLifetimeAtomic: '30' })
    const results = await Promise.all(Array.from({ length: 8 }, (_, n) => s.service.create(s.agent, s.input, `key-${n}`)))
    expect(results.filter(row => row.status === 'pending_approval')).toHaveLength(3)
    expect(results.filter(row => row.status === 'denied')).toHaveLength(5)
  })
  test('API denies self-approval, privilege escalation, cross-tenant access and legacy routes', async () => {
    const s = await setup()
    const operation = await s.service.create(s.agent, s.input, 'auth')
    const headers = { authorization: `Bearer ${s.grant.token}`, 'content-type': 'application/json' }
    expect((await s.app.request(`/v1/operations/${operation.id}/approve`, { method: 'POST', headers, body: JSON.stringify({ operationHash: operation.operationHash }) })).status).toBe(403)
    expect((await s.app.request(`/v1/wallets/${s.wallet.id}/policy`, { method: 'PATCH', headers, body: JSON.stringify(policy) })).status).toBe(403)
    expect((await s.app.request('/v1/grants', { method: 'POST', headers, body: JSON.stringify({ walletId: s.wallet.id, agentName: 'escalation', expiresAt: new Date(Date.now() + 5000).toISOString() }) })).status).toBe(403)
    expect((await s.app.request(`/v1/operations/${operation.id}`, { headers: { authorization: 'Bearer owner-b' } })).status).toBe(404)
    expect((await s.app.request('/sdk/agent/fetch-paid', { method: 'POST', headers, body: '{}' })).status).toBe(404)
    expect((await s.app.request('/agents/anything/regen-key', { method: 'POST', headers })).status).toBe(404)
    const other = await setup()
    await expect(s.service.create(s.agent, other.input, 'other-wallet')).rejects.toThrow('not valid for this wallet')
  })
  test('approval is bound, expires, and can be consumed only once concurrently', async () => {
    const s = await setup()
    const operation = await s.service.create(s.agent, s.input, 'approval')
    await expect(s.service.decide(owner, operation.id, '0'.repeat(64), true)).rejects.toThrow('does not match')
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => s.service.decide(owner, operation.id, operation.operationHash, true)))
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    const expiring = await s.service.create(s.agent, s.input, 'expired')
    await connection.db.update(operations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(operations.id, expiring.id))
    await expect(s.service.decide(owner, expiring.id, expiring.operationHash, true)).rejects.toThrow('expired')
  })
  test('policy changes and revocation invalidate queued authorizations', async () => {
    const s = await setup()
    const operation = await s.service.create(s.agent, s.input, 'policy')
    await s.service.decide(owner, operation.id, operation.operationHash, true)
    await s.service.setPolicy(owner, s.wallet.id, { ...policy, mode: 'paused' })
    await s.service.tick()
    expect((await s.service.get(owner, operation.id)).status).toBe('denied')
    expect(s.counts().broadcasts).toBe(0)
    await s.service.setPolicy(owner, s.wallet.id, policy)
    const next = await s.service.create(s.agent, s.input, 'revocation')
    await s.service.revoke(owner, s.grant.id)
    expect((await s.service.get(owner, next.id)).status).toBe('denied')
    expect((await s.app.request('/v1/operations', { headers: { authorization: `Bearer ${s.grant.token}` } })).status).toBe(401)
  })
  test('concurrent workers sign/broadcast once; lost response reconciles', async () => {
    const s = await setup({ mode: 'automatic' })
    s.loseResponse()
    const operation = await s.service.create(s.agent, s.input, 'lost')
    await Promise.all(Array.from({ length: 4 }, () => s.service.tick()))
    await s.service.tick()
    expect((await s.service.get(owner, operation.id)).status).toBe('confirmed')
    expect(s.counts()).toEqual({ preparations: 1, broadcasts: 1 })
    const duplicate = await s.service.create(s.agent, s.input, 'lost')
    expect(duplicate.id).toBe(operation.id)
    expect(JSON.stringify(duplicate)).not.toContain('signedTransaction')
  })
  test('unknown outcome retains reservation, blocks nonce lane, never blindly resends', async () => {
    const s = await setup({ mode: 'automatic', maxDailyAtomic: '20', maxLifetimeAtomic: '20' })
    const first = await s.service.create(s.agent, s.input, 'unknown')
    await s.service.tick()
    s.receipts.clear()
    await s.service.create(s.agent, s.input, 'next')
    for (let i = 0; i < 3; i++) await s.service.tick()
    expect((await s.service.get(owner, first.id)).status).toBe('unknown')
    expect((await s.service.create(s.agent, s.input, 'over')).status).toBe('denied')
    expect(s.counts()).toEqual({ preparations: 1, broadcasts: 1 })
  })
  test('invalid amounts/fields fail closed, no Privy fallback', async () => {
    const s = await setup()
    for (const amountAtomic of ['NaN', '-1', '1.5', '1e5', 1, '0']) await expect(s.service.create(s.agent, { ...s.input, amountAtomic }, randomUUID())).rejects.toThrow()
    await expect(s.service.create(s.agent, { ...s.input, policy: { mode: 'automatic' } }, 'extra')).rejects.toThrow()
    const disabled = new OperationService(connection.db, null, pluginConfig.parse({}), 'http://localhost:3000')
    await expect(disabled.create(s.agent, s.input, 'disabled')).rejects.toThrow('not enabled')
    expect(() => pluginConfig.parse({ jupiter: true })).toThrow()
  })
  test('grant expiry before execution prevents signing', async () => {
    const s = await setup({ mode: 'automatic' })
    const operation = await s.service.create(s.agent, s.input, 'grant-expiry')
    await connection.db.update(grants).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(grants.id, s.grant.id))
    await s.service.tick()
    expect((await s.service.get(owner, operation.id)).status).toBe('denied')
    expect(s.counts().broadcasts).toBe(0)
  })
  test('Anvil native transfer: sign, persist, send, confirm via viem', async () => {
    const port = 32000 + Math.floor(Math.random() * 10000)
    const proc = Bun.spawn(['anvil', '--host', '127.0.0.1', '--port', String(port), '--silent'], { stdout: 'ignore', stderr: 'ignore' })
    const rpc = `http://127.0.0.1:${port}`
    const transport = http(rpc, { retryCount: 0 })
    const reader = createPublicClient({ chain: foundry, transport })
    try {
      let started = false
      for (let i = 0; i < 50; i++) { try { await reader.getChainId(); started = true; break } catch { await Bun.sleep(100) } }
      if (!started) throw new Error('Anvil failed to start')
      const privateKey = generatePrivateKey()
      const account = privateKeyToAccount(privateKey)
      const testClient = createTestClient({ chain: foundry, mode: 'anvil', transport })
      await testClient.setBalance({ address: account.address, value: parseEther('2') })
      const [wallet] = await connection.db.insert(wallets).values({ ownerId: owner.ownerId, provider: 'anvil', providerWalletId: randomUUID(), address: account.address, chainId: 'eip155:31337', policy: { mode: 'ask', maxPerOperationAtomic: parseEther('1').toString(), maxDailyAtomic: parseEther('1').toString(), maxLifetimeAtomic: parseEther('1').toString(), allowedRecipients: [] } }).returning()
      const service = new OperationService(connection.db, createAnvilExecutor(rpc, privateKey), pluginConfig.parse({}), 'http://localhost:3000')
      const before = await reader.getBalance({ address: recipient })
      const operation = await service.create(owner, { walletId: wallet!.id, action: 'transfer', asset: 'native', chainId: 'eip155:31337', to: recipient, amountAtomic: parseEther('0.01').toString(), maxFeeAtomic: parseEther('0.001').toString(), reason: 'Local E2E' }, 'anvil')
      await service.decide(owner, operation.id, operation.operationHash, true)
      await service.tick()
      await service.tick()
      const result = await service.get(owner, operation.id)
      expect(result.status).toBe('confirmed')
      expect(result.receipt?.success).toBe(true)
      expect(await reader.getBalance({ address: recipient }) - before).toBe(parseEther('0.01'))
      expect(() => createAnvilExecutor('https://mainnet.base.org', privateKey)).toThrow('loopback')
    } finally { proc.kill(); await proc.exited }
  }, 30_000)
})
