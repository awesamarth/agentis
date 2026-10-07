import { test, expect } from 'bun:test'
import { Hono } from 'hono'
import { z } from 'zod'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { AgentisClient } from '@agentis-hq/sdk'
import { createAgentisMcpServer } from '@agentis-hq/mcp'
import { networkByKey, tempoTokens } from '@agentis-hq/core/networks'
import { createDiscovery, discoveryRoutes, catalogOffer } from '../apps/backend/src/modules/discovery'
import { ApiError } from '../apps/backend/src/errors'
import { formatOutput } from '../packages/cli/src/lib/output'

const offer = { protocol: 'mpp', method: 'tempo', intent: 'charge', network: 'eip155:4217', currency: tempoTokens.usdcMainnet, decimals: 6, amount: '2000', amountHint: '$0.002' }
const endpoint = { method: 'POST', path: '/search', description: 'Search', requestFormat: 'json', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }, inputExample: { q: 'Tempo docs' }, paymentOffers: [offer] }
const service = { id: 'search-api', name: 'Search API', description: 'Search provider', serviceUrl: 'https://gateway.example/search-api', integration: 'third-party', isFirstParty: false, provider: { name: 'Search Provider', url: 'https://provider.example' }, docs: { homepage: 'https://provider.example/docs' }, endpoints: [endpoint] }
function fixture(failDetails = false) {
  const calls: string[] = []
  const discovery = createDiscovery(async input => {
    expect(input.method).toBe('GET')
    expect(input.headers).toEqual({ accept: 'application/json' })
    expect(input.body).toBeUndefined()
    const url = new URL(input.url)
    expect(url.origin).toBe('https://mercator.sh')
    calls.push(url.pathname)
    let data: unknown
    let status = 200
    if (url.pathname === '/v1/services/search') {
      expect(url.searchParams.get('resolution')).toBe('static')
      data = { resolution: 'static', endpoints: [1, 2].map(rank => ({ ...endpoint, serviceId: service.id, serviceName: service.name, rank, score: 0.9, estimatedPrice: { amount: '0.002', currency: 'USDC' } })) }
    } else if (url.pathname === '/v1/services/search-api') {
      status = failDetails ? 503 : 200
      data = { service }
    } else { status = 404; data = {} }
    return { status, headers: {}, bodyBase64: Buffer.from(JSON.stringify(data)).toString('base64') }
  })
  return { discovery, calls }
}
function router(discovery: ReturnType<typeof createDiscovery>) {
  const app = new Hono()
  app.onError((error, c) => c.json({ error: { code: error instanceof ApiError ? error.code : 'invalid_request', message: error instanceof ApiError ? error.message : 'Invalid discovery input' } }, error instanceof ApiError ? error.status : 400))
  app.route('/v1/discovery', discoveryRoutes(discovery))
  app.use('/v1/*', c => c.json({ error: { code: 'unauthorized' } }, 401))
  return app
}

test('discovery enriches once per service, preserves gateway prefixes/schemas and separates estimates from atomic offers', async () => {
  const { discovery, calls } = fixture()
  const result = await discovery.search({ query: 'web search', limit: 2 })
  expect(calls).toEqual(['/v1/services/search', '/v1/services/search-api'])
  expect(result.partial).toBe(false)
  expect(result.advisory).toBe(true)
  expect(result.endpoints.map(item => item.rank)).toEqual([1, 2])
  const item = result.endpoints[0]!
  expect(item.url).toBe('https://gateway.example/search-api/search')
  expect(item.integration).toBe('third-party')
  expect(item.inputSchema).toEqual(endpoint.inputSchema)
  expect(item.estimatedPrice?.amountDecimal).toBe('0.002')
  expect(item.paymentOffers[0]?.amountAtomic).toBe('2000')
  expect(item.paymentOffers[0]?.symbol).toBe('USDC.e')
  expect(item.compatibility.status).toBe('candidate')
  expect(catalogOffer({ ...offer, intent: 'session' }).compatibility.status).toBe('unsupported')
  expect(catalogOffer({ ...offer, currency: '0x20c0000000000000000000000000000000000002' }).compatibility.status).toBe('unsupported')
  expect(catalogOffer({ ...offer, network: undefined }).compatibility.status).toBe('unknown')
  for (const key of ['base', 'solana']) {
    const network = networkByKey(key)!
    const accepted = { protocol: 'x402', method: 'http', intent: 'charge', scheme: 'exact', network: network.chainId, currency: network.x402!.token, decimals: 6 }
    expect(catalogOffer(accepted).compatibility.status).toBe('candidate')
    expect(catalogOffer({ ...accepted, scheme: 'upto' }).compatibility.status).toBe('unsupported')
    if (key === 'solana') expect(catalogOffer({ ...accepted, currency: accepted.currency.toLowerCase() }).compatibility.status).toBe('unsupported')
  }
  const unsafe = createDiscovery(async () => ({ status: 200, headers: {}, bodyBase64: Buffer.from(JSON.stringify({ service: { ...service, serviceUrl: 'https://127.0.0.1/private' } })).toString('base64') }))
  expect((await unsafe.describe(service.id)).service.endpoints[0]?.url).toBeNull()
  const malicious = structuredClone(result)
  malicious.endpoints[0]!.description = '\x1b[31mexternal\x9b0m'
  expect(formatOutput('discover', malicious, false)).not.toMatch(/[\x1b\x9b]/)
})

test('discovery reports partial/unknown results and rejects invalid input without outgoing requests', async () => {
  const { discovery, calls } = fixture(true)
  const result = await discovery.search({ query: 'search' })
  expect(result.partial).toBe(true)
  expect(result.endpoints[0]?.url).toBeNull()
  expect(result.endpoints[0]?.paymentOffers).toEqual([])
  expect(result.endpoints[0]?.compatibility.status).toBe('unknown')
  const count = calls.length
  await expect(discovery.describe('../jobs')).rejects.toBeInstanceOf(z.ZodError)
  await expect(discovery.search({ query: 'x', limit: 26 })).rejects.toBeInstanceOf(z.ZodError)
  expect(calls.length).toBe(count)
  await expect(discovery.describe('missing')).rejects.toMatchObject({ status: 404, code: 'discovery_not_found' })
  const invalid = createDiscovery(async () => ({ status: 200, headers: {}, bodyBase64: Buffer.from('{"service":{}}').toString('base64') }))
  await expect(invalid.describe('search-api')).rejects.toMatchObject({ status: 503, code: 'discovery_unavailable' })
})

test('public SDK, CLI and MCP discovery read catalogs without credentials, wallets or payment calls', async () => {
  const { discovery } = fixture()
  const app = router(discovery)
  let requests = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    expect(request.headers.has('authorization')).toBe(false)
    requests++
    return app.fetch(request)
  } })
  const home = mkdtempSync(join(tmpdir(), 'agentis-discovery-'))
  const baseUrl = `http://127.0.0.1:${server.port}`
  const sdk = new AgentisClient({ baseUrl, token: () => { throw Error('Discovery must not access credentials') } })
  const mcp = createAgentisMcpServer({ delegations: [{ agentId: crypto.randomUUID(), name: 'fixture', client: sdk }], networks: [] })
  const client = new Client({ name: 'discovery-fixture', version: '1' })
  try {
    expect((await sdk.discovery.describe('search-api')).service.endpoints[0]?.url).toBe('https://gateway.example/search-api/search')
    expect((await fetch(`${baseUrl}/v1/wallets`)).status).toBe(401)
    const [a, b] = InMemoryTransport.createLinkedPair()
    await mcp.connect(a); await client.connect(b)
    const tools = (await client.listTools()).tools
    expect(tools.find(tool => tool.name === 'agentis_discover')?.annotations?.readOnlyHint).toBe(true)
    const search = await client.callTool({ name: 'agentis_discover', arguments: { query: 'search' } })
    expect(search.isError).not.toBe(true)
    const detail = await client.callTool({ name: 'agentis_describe_service', arguments: { serviceId: 'search-api' } })
    expect(detail.isError).not.toBe(true)
    const env = { ...process.env, HOME: home, AGENTIS_API_URL: baseUrl, AGENTIS_TOKEN: 'fixture-token-must-not-be-forwarded' }
    for (const args of [['discover', 'web search', '--json'], ['discover', 'describe', 'search-api', '--json']]) {
      const process = Bun.spawn([Bun.which('bun')!, 'packages/cli/src/index.ts', ...args], { env, stdout: 'pipe', stderr: 'pipe' })
      const [out, err, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
      expect(code, err).toBe(0)
      expect(JSON.parse(out).source).toBe('mercator')
    }
    expect(existsSync(join(home, '.agentis'))).toBe(false)
    expect(requests).toBe(6)
  } finally { await client.close(); await mcp.close(); await server.stop(true); rmSync(home, { recursive: true, force: true }) }
}, 20000)
