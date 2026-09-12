// Isolated Postgres schema + actual HTTP/MCP SDK. Never signs, broadcasts or touches real wallet rows.
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthTokens, OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createApp } from '../apps/backend/src/app'
import { OperationService } from '../apps/backend/src/operations'
import * as tables from '../apps/backend/src/db/schema'
import type { Executor } from '../apps/backend/src/providers/types'
const dbUrl = process.env.DATABASE_URL!
const parsed = new URL(dbUrl)
assert(['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.port === '55432', 'Dedicated local Postgres only')
const admin = postgres(dbUrl, { max: 1 }), schema = `mcp_check_${randomBytes(6).toString('hex')}`
await admin.unsafe(`CREATE SCHEMA ${schema}`)
for (const table of ['agents', 'wallets', 'grants', 'operations', 'onboarding', 'oauth_clients', 'oauth_connections', 'oauth_requests', 'oauth_tokens']) await admin.unsafe(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`)
const sql = postgres(dbUrl, { max: 5, connection: { search_path: schema } }), db = drizzle(sql, { schema: tables })
const previousIssuer = process.env.AGENTIS_PUBLIC_API_URL
let app: ReturnType<typeof createApp>
const http = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => app.fetch(request) })
const base = `http://localhost:${http.port}`, resource = `${base}/mcp`
process.env.AGENTIS_PUBLIC_API_URL = base
const owner = `mcp-fixture-${schema}`
const deny = async (): Promise<never> => { throw Error('Signing/broadcast forbidden in this check') }
const executor: Executor = { id: 'privy', validate() {}, prepare: deny, broadcast: deny, receipt: deny }
const service = new OperationService(db, executor, {}, 'http://localhost:3000', async input => ({ assetPrice: '1000000000000000000', feePrice: '1000000000000000000', assetDecimals: input.asset === 'native' ? 18 : 6, feeDecimals: 18, expiresAt: Date.now() + 60000 }))
app = createApp(service, { authenticate: async token => { if (token !== 'owner-fixture') throw Error(); return owner } }, ['http://localhost:3000'])
const uid = () => crypto.randomUUID()
const agentA = uid(), agentB = uid(), foreignAgent = uid(), baseWallet = uid(), excludedWallet = uid(), tempoWallet = uid()
const agentRow = (id: string, name: string, ownerId = owner) => ({ id, name, ownerId, mode: 'ask' as const, limits: { perTransaction: '1000000', hourly: '1000000', daily: '1000000', total: '10000000' }, allowedRecipients: [], networks: ['base', 'tempo'], defaultNetwork: 'base' })
const policy = { mode: 'ask' as const, budgetMode: 'usd' as const, maxDailyAtomic: '0', maxLifetimeAtomic: '0', maxPerOperationAtomic: '0', allowedRecipients: [] }
const walletRow = (id: string, agentId: string, chainId: string) => ({ id, agentId, chainId, ownerId: owner, provider: 'privy', providerWalletId: uid(), address: '0x0000000000000000000000000000000000000011', policy, serverAuthorized: true })
async function request(path: string, body?: unknown, token?: string) {
  return fetch(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function form(path: string, body: Record<string, string>) { return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }) }
async function newRequest(clientId: string, callback: string) {
  const verifier = randomBytes(32).toString('base64url')
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), resource, scope: 'agentis', state: 'fixture-state' })
  const response = await request(`/oauth/authorize?${params}`); assert.equal(response.status, 302)
  return { verifier, id: new URL(response.headers.get('location')!).searchParams.get('request')! }
}
let mcp: Client | undefined
try {
  await db.insert(tables.agents).values([agentRow(agentA, 'First'), agentRow(agentB, 'Second'), agentRow(foreignAgent, 'Other', 'other-owner')])
  await db.insert(tables.wallets).values([walletRow(baseWallet, agentA, 'eip155:84532'), walletRow(excludedWallet, agentA, 'eip155:42431'), walletRow(tempoWallet, agentB, 'eip155:42431')])
  const unauthorized = await request('/mcp'); assert.equal(unauthorized.status, 401); assert(unauthorized.headers.get('www-authenticate')!.includes('oauth-protected-resource'))
  const metadata = await (await request('/.well-known/oauth-authorization-server')).json(); assert.equal(metadata.issuer, base)
  assert.equal((await request('/oauth/register', { redirect_uris: ['https://attacker.test/#fragment'] })).status, 400)
  const callback = 'http://127.0.0.1:45678/callback'
  const registration = await request('/oauth/register', { client_name: 'Fixture MCP', redirect_uris: [callback], token_endpoint_auth_method: 'none' }); assert.equal(registration.status, 201)
  const client = await registration.json()
  const flow = await newRequest(client.client_id, callback)
  assert.equal((await request(`/v1/oauth/requests/${flow.id}`)).status, 401)
  const selection = { approve: true, confirm: true, selections: [{ agentId: agentA, chainIds: ['eip155:84532'] }, { agentId: agentB, chainIds: ['eip155:42431'] }] }
  assert.equal((await request(`/v1/oauth/requests/${flow.id}/complete`, { approve: true, confirm: true, selections: [{ agentId: foreignAgent, chainIds: ['eip155:84532'] }] }, 'owner-fixture')).status, 403)
  const consent = await request(`/v1/oauth/requests/${flow.id}/complete`, selection, 'owner-fixture'); assert.equal(consent.status, 200)
  const redirect = new URL((await consent.json()).redirectUrl); assert.equal(redirect.searchParams.get('state'), 'fixture-state')
  const exchange = { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: callback, code: redirect.searchParams.get('code')!, code_verifier: flow.verifier, resource }
  assert.equal((await form('/oauth/token', { ...exchange, code_verifier: randomBytes(32).toString('base64url') })).status, 400)
  assert.equal((await form('/oauth/token', { ...exchange, resource: 'https://other.test/mcp' })).status, 400)
  const exchanges = await Promise.all([form('/oauth/token', exchange), form('/oauth/token', exchange)])
  assert.deepEqual(exchanges.map(response => response.status).sort(), [200, 400])
  const tokens = await exchanges.find(response => response.status === 200)!.json()
  assert.equal((await request('/v1/agents', undefined, tokens.access_token)).status, 401, 'OAuth bearer is MCP-only, never an owner token')
  const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } })
  mcp = new Client({ name: 'fixture', version: '1' })
  await mcp.connect(transport)
  const tools = await mcp.listTools(); assert.equal(tools.tools.length, 10); assert(!tools.tools.some(tool => /approve|reject|export|set_policy/.test(tool.name)))
  const call = async (name: string, args: Record<string, unknown> = {}) => mcp!.callTool({ name, arguments: args })
  const unwrap = (response: Awaited<ReturnType<typeof call>>) => JSON.parse((response.content as { text: string }[])[0]!.text)
  const walletList = unwrap(await call('agentis_list_wallets'))
  assert.equal(walletList.length, 2); assert.deepEqual(walletList.flatMap((agent: { wallets: { walletId: string }[] }) => agent.wallets.map(wallet => wallet.walletId)).sort(), [baseWallet, tempoWallet].sort())
  assert((await call('agentis_policy', { agentId: foreignAgent })).isError)
  const send = { walletId: baseWallet, to: '0x0000000000000000000000000000000000000022', amount: '0.01', asset: 'USDC', idempotencyKey: 'mcp-send-one' }
  assert((await call('agentis_send', { ...send, walletId: excludedWallet })).isError)
  const pending = unwrap(await call('agentis_send', send)); assert.equal(pending.status, 'pending_approval', JSON.stringify(pending)); assert(pending.approvalUrl.includes(pending.id))
  assert.equal(unwrap(await call('agentis_send', send)).id, pending.id)
  assert.equal(unwrap(await call('agentis_get_operation', { id: pending.id })).status, 'pending_approval')
  assert.equal(unwrap(await call('agentis_policy', { agentId: agentA })).reservedMicros, '10100')
  assert.equal(unwrap(await call('agentis_history', { agentId: agentA })).length, 1)
  // Plugin settings are owner-only metadata: do not touch wallets, budgets or approvals.
  const patch = (path: string, body: unknown, token = 'owner-fixture') => fetch(base + path, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const beforeWallets = await db.select().from(tables.wallets).orderBy(tables.wallets.id)
  assert.equal((await patch(`/v1/agents/${foreignAgent}/plugins`, { plugins: ['uniswap'] })).status, 404)
  assert.equal((await patch(`/v1/agents/${agentA}/plugins`, { plugins: ['unknown'] })).status, 400)
  assert.equal((await patch(`/v1/agents/${agentA}/plugins`, { plugins: ['uniswap', 'uniswap'] })).status, 400)
  const executorKey = await (await request('/v1/grants', { agentId: agentA, agentName: 'SDK · plugin check' }, 'owner-fixture')).json()
  assert.equal((await patch(`/v1/agents/${agentA}/plugins`, { plugins: ['uniswap'] }, executorKey.token)).status, 403)
  assert.equal((await fetch(`${base}/v1/grants/${executorKey.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner-fixture' } })).status, 204)
  const added = await patch(`/v1/agents/${agentA}/plugins`, { plugins: ['uniswap'] }); assert.equal(added.status, 200)
  const addedAgent = await added.json(); assert.deepEqual(addedAgent.plugins, ['uniswap'])
  assert.deepEqual(unwrap(await call('agentis_list_wallets')).find((item: { agentId: string }) => item.agentId === agentA).plugins, ['uniswap'])
  const settings = { name: addedAgent.name, limits: addedAgent.limits, mode: addedAgent.mode, allowedRecipients: addedAgent.allowedRecipients, selection: { networks: addedAgent.networks, defaultNetwork: addedAgent.defaultNetwork } }
  assert.equal((await patch(`/v1/agents/${agentA}`, settings)).status, 200, 'Omitting plugin settings preserves selection')
  assert.deepEqual((await db.select().from(tables.agents).where(eq(tables.agents.id, agentA)))[0]!.plugins, ['uniswap'])
  assert.equal((await patch(`/v1/agents/${agentA}`, { ...settings, plugins: [] })).status, 200)
  assert.deepEqual((await db.select().from(tables.agents).where(eq(tables.agents.id, agentB)))[0]!.plugins, [])
  assert.deepEqual(await db.select().from(tables.wallets).orderBy(tables.wallets.id), beforeWallets)
  assert.equal(unwrap(await call('agentis_get_operation', { id: pending.id })).status, 'pending_approval')
  assert((await call('agentis_send', { ...send, amount: '2', idempotencyKey: 'over-cap' })).isError === undefined) // Denied is a durable operation, not a transport error.
  assert.equal(unwrap(await call('agentis_send', { ...send, amount: '2', idempotencyKey: 'over-cap' })).status, 'denied')
  const rotated = await form('/oauth/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource }); assert.equal(rotated.status, 200)
  const fresh = await rotated.json(); assert.notEqual(fresh.refresh_token, tokens.refresh_token)
  assert.equal((await form('/oauth/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource })).status, 400)
  assert.equal((await request('/mcp', undefined, fresh.access_token)).status, 401, 'Refresh reuse revokes connection')
  assert.equal((await db.select().from(tables.grants)).filter(grant => !grant.revokedAt).length, 0)
  const declined = await newRequest(client.client_id, callback)
  const denial = await (await request(`/v1/oauth/requests/${declined.id}/complete`, { approve: false }, 'owner-fixture')).json()
  assert.equal(new URL(denial.redirectUrl).searchParams.get('error'), 'access_denied')
  let savedTokens: OAuthTokens | undefined, clientInfo: OAuthClientInformationMixed | undefined, verifier = '', authorize: URL | undefined
  const provider: OAuthClientProvider = {
    redirectUrl: callback,
    clientMetadata: { client_name: 'Native SDK OAuth', redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
    state: () => 'native-sdk-state', clientInformation: () => clientInfo, saveClientInformation: value => { clientInfo = value },
    tokens: () => savedTokens, saveTokens: value => { savedTokens = value },
    redirectToAuthorization: value => { authorize = value }, saveCodeVerifier: value => { verifier = value }, codeVerifier: () => verifier,
  }
  assert.equal(await auth(provider, { serverUrl: resource }), 'REDIRECT')
  const nativeRedirect = await fetch(authorize!, { redirect: 'manual' }); assert.equal(nativeRedirect.status, 302)
  const nativeRequest = new URL(nativeRedirect.headers.get('location')!).searchParams.get('request')!
  const nativeConsent = await (await request(`/v1/oauth/requests/${nativeRequest}/complete`, selection, 'owner-fixture')).json()
  const nativeCallback = new URL(nativeConsent.redirectUrl)
  assert.equal(nativeCallback.searchParams.get('state'), 'native-sdk-state')
  assert.equal(await auth(provider, { serverUrl: resource, authorizationCode: nativeCallback.searchParams.get('code')! }), 'AUTHORIZED')
  const nativeClient = new Client({ name: 'native-oauth-check', version: '1' })
  try {
    await nativeClient.connect(new StreamableHTTPClientTransport(new URL(resource), { authProvider: provider }))
    assert.equal((await nativeClient.listTools()).tools.length, 10)
    const [accessRecord] = await db.select().from(tables.oauthTokens).where(eq(tables.oauthTokens.tokenHash, createHash('sha256').update(savedTokens!.access_token).digest('hex')))
    const [connection] = await db.select().from(tables.oauthConnections).where(eq(tables.oauthConnections.id, accessRecord!.connectionId))
    assert.equal((await fetch(`${base}/v1/grants/${connection!.grantIds[0]}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner-fixture' } })).status, 204)
    const remaining = await nativeClient.callTool({ name: 'agentis_list_wallets', arguments: {} })
    assert.equal(JSON.parse((remaining.content as { text: string }[])[0]!.text).length, 1, 'Revoking one agent must preserve other delegated agents')
    assert.equal((await form('/oauth/revoke', { token: savedTokens!.refresh_token!, client_id: clientInfo!.client_id })).status, 200)
    assert.equal((await request('/mcp', undefined, savedTokens!.access_token)).status, 401)
  } finally { await nativeClient.close() }
  console.log('Remote OAuth + real MCP HTTP SDK passed: owner-only per-agent plugins without wallet/approval mutations, native SDK OAuth connect, discovery, DCR, explicit multi-agent/network consent, PKCE/resource binding, code replay, scoped tools, ask link, idempotency, budget denial, refresh rotation/reuse revocation and cancellation. No signing or money.')
} finally {
  await mcp?.close().catch(() => {})
  http.stop(true)
  if (previousIssuer === undefined) delete process.env.AGENTIS_PUBLIC_API_URL; else process.env.AGENTIS_PUBLIC_API_URL = previousIssuer
  await sql.end(); await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`); await admin.end()
}
