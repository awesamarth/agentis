// No browser, Privy calls or payments. Uses transaction-local temporary tables;
// all fixtures and issued test keys are rolled back. Run after local migrations.
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { connectDatabase, type Database } from '../apps/backend/src/db'
import { agents, wallets, cliLogins } from '../apps/backend/src/db/schema'
import { createApp } from '../apps/backend/src/app'
import { OperationService, hash } from '../apps/backend/src/operations'

const env = Bun.YAML.parse(await Bun.file(new URL('../compose.yaml', import.meta.url)).text()).services.postgres.environment
assert.equal(env.POSTGRES_DB, 'agentis_dev')
const url = new URL('postgres://127.0.0.1:55432/agentis_dev')
url.username = env.POSTGRES_USER; url.password = env.POSTGRES_PASSWORD
const connection = connectDatabase(url.href)
const rollback = new Error('Fixture rollback')
try {
  await connection.db.transaction(async tx => {
    for (const table of ['agents', 'wallets', 'grants', 'operations', 'cli_logins']) await tx.execute(sql.raw(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`))
    const owner = 'cli-fixture-owner', a = randomUUID(), b = randomUUID(), other = randomUUID()
    for (const [id, ownerId] of [[a, owner], [b, owner], [other, 'other-owner']]) await tx.insert(agents).values({ id, ownerId, name: id, mode: 'ask', limits: { perTransaction: null, hourly: null, daily: null, total: null }, allowedRecipients: [], networks: ['base'], defaultNetwork: 'base' })
    const fixtureWallets = [{ agentId: a, chainId: 'eip155:84532', ownerId: owner }, { agentId: a, chainId: 'eip155:5042002', ownerId: owner }, { agentId: b, chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', ownerId: owner }, { agentId: other, chainId: 'eip155:84532', ownerId: 'other-owner' }]
    for (const row of fixtureWallets) await tx.insert(wallets).values({ ...row, provider: 'privy', providerWalletId: randomUUID(), address: 'fixture-address', policy: { mode: 'ask', maxPerOperationAtomic: '0', maxDailyAtomic: '0', maxLifetimeAtomic: '0', allowedRecipients: [] } })
    const service = new OperationService(tx as unknown as Database, null, {}, 'http://localhost:3000')
    // Explicit mocked identity in isolated fixtures, not a real owner token.
    const app = createApp(service, { authenticate: async token => { if (token !== 'fixture-owner-auth') throw Error('Invalid identity'); return owner } }, ['http://localhost:3000'])
    async function request(path: string, body?: unknown, token?: string, method = body ? 'POST' : 'GET') {
      const response = await app.request(`/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      return { status: response.status, body: await response.json() }
    }
    const secret = randomBytes(32).toString('hex')
    const start = await request('/cli/logins', { challenge: hash(secret) })
    assert.equal(start.status, 201)
    assert(!start.body.approvalUrl.includes(secret))
    const path = `/cli/logins/${start.body.id}`
    assert.equal((await request(`${path}/exchange`, { secret: '00'.repeat(32) })).status, 410)
    assert.equal((await request(`${path}/exchange`, { secret })).body.status, 'pending')
    const choices = [{ agentId: a, chainIds: ['eip155:84532'] }, { agentId: b, chainIds: [fixtureWallets[2]!.chainId] }]
    const approval = { selections: choices, code: start.body.code, confirm: true }
    assert.equal((await request(`${path}/approve`, approval)).status, 401)
    assert.equal((await request(`${path}/approve`, { ...approval, selections: [{ agentId: other, chainIds: ['eip155:84532'] }] }, 'fixture-owner-auth')).status, 400)
    assert.equal((await request(`${path}/approve`, approval, 'fixture-owner-auth')).status, 200)
    const exchanged = await request(`${path}/exchange`, { secret })
    assert.equal(exchanged.body.status, 'complete')
    assert.equal(exchanged.body.credentials.length, 2)
    for (const credential of exchanged.body.credentials) {
      assert.match(credential.token, /^agt_exec_[a-f0-9]{64}$/)
      const accessible = await request('/wallets', undefined, credential.token)
      assert.equal(accessible.body.length, 1)
      assert.equal(accessible.body[0].agentId, credential.agentId)
      assert(credential.chainIds.includes(accessible.body[0].chainId))
      assert.equal((await request(`${path}/approve`, approval, credential.token)).status, 403)
      assert.equal((await request('/grants', { agentId: a, agentName: 'Escalation' }, credential.token)).status, 403)
      assert.equal((await request(`/operations/${randomUUID()}/approve`, { operationHash: '00'.repeat(32) }, credential.token)).status, 403)
    }
    assert.equal((await request(`${path}/exchange`, { secret })).status, 409)
    // Exercise the actual CLI handoff/storage against the fixture API. Owner
    // consent is simulated here; this is not a Privy/browser authenticated test.
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
    const home = mkdtempSync(join(tmpdir(), 'agentis-cli-login-'))
    const environment = { ...process.env, HOME: home, AGENTIS_API_URL: `http://127.0.0.1:${server.port}`, AGENTIS_TOKEN: '' }
    const cli = Bun.spawn([process.execPath, resolve('packages/cli/src/index.ts'), 'login', '--no-browser'], { env: environment, stdout: 'pipe', stderr: 'pipe' })
    try {
      let pending: typeof cliLogins.$inferSelect | undefined
      for (let i = 0; i < 100; i++) {
        pending = (await tx.select().from(cliLogins)).find(row => row.ownerId === null)
        if (pending) break
        await Bun.sleep(100)
      }
      assert(pending, 'CLI must create a login request')
      assert.equal((await request(`/cli/logins/${pending.id}/approve`, { ...approval, code: pending.challenge.slice(0, 8).toUpperCase() }, 'fixture-owner-auth')).status, 200)
      assert.equal(await cli.exited, 0)
      const output = await new Response(cli.stdout).text()
      assert(!output.includes('agt_exec_'))
      const file = join(home, '.agentis/cli-session.json')
      assert.equal(statSync(file).mode & 0o777, 0o600)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      assert.equal(saved.credentials.length, 2)
      assert(!readFileSync(file, 'utf8').includes('fixture-owner-auth'))
      const listing = Bun.spawn([process.execPath, resolve('packages/cli/src/index.ts'), 'wallet', 'list', '--json'], { env: environment, stdout: 'pipe', stderr: 'pipe' })
      assert.equal(await listing.exited, 0)
      assert.equal(JSON.parse(await new Response(listing.stdout).text()).length, 2)
    } finally { cli.kill(); server.stop(true); rmSync(home, { recursive: true, force: true }) }
    const expiredSecret = randomBytes(32).toString('hex')
    const expired = await request('/cli/logins', { challenge: hash(expiredSecret) })
    await tx.update(cliLogins).set({ expiresAt: new Date(0) })
    assert.equal((await request(`/cli/logins/${expired.body.id}/exchange`, { secret: expiredSecret })).status, 410)
    console.log('CLI login checks passed: explicit owner consent, multiple scoped keys, network/owner isolation, no self-approval or delegation, one-time exchange and expiry.')
    throw rollback
  })
} catch (error) { if (error !== rollback) throw error }
finally { await connection.close() }
