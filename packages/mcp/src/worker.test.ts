import { afterAll, describe, expect, test } from 'bun:test'
import worker from './worker'

const resource = 'https://mcp.test/mcp'
const api = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname !== '/oauth/introspect') return new Response('Not found', { status: 404 })
    if (request.headers.get('x-agentis-mcp-secret') !== 'test-secret') {
      return Response.json({ active: false }, { status: 401 })
    }
    return Response.json({
      active: true,
      sub: 'did:privy:test',
      client_id: 'test-client',
      scope: 'wallets:read',
      resource,
      grant_id: 'grant-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  },
})

const env = {
  AGENTIS_API_URL: `http://127.0.0.1:${api.port}`,
  AGENTIS_MCP_RESOURCE: resource,
  MCP_INTROSPECTION_SECRET: 'test-secret',
}

afterAll(() => api.stop(true))

describe('remote MCP worker', () => {
  test('publishes OAuth protected resource metadata', async () => {
    const response = await worker.fetch(
      new Request('https://mcp.test/.well-known/oauth-protected-resource'),
      env,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      resource,
      authorization_servers: [env.AGENTIS_API_URL],
    })
  })

  test('rejects requests without OAuth', async () => {
    const response = await worker.fetch(new Request(resource, { method: 'POST' }), env)
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=')
  })

  test('handles an authenticated MCP initialize request', async () => {
    const response = await worker.fetch(new Request(resource, {
      method: 'POST',
      headers: {
        authorization: 'Bearer agt_oauth_test',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'worker-test', version: '1.0.0' },
        },
      }),
    }), env)
    expect(response.status).toBe(200)
    const body = await response.json() as { result?: { serverInfo?: { name?: string } } }
    expect(body.result?.serverInfo?.name).toBe('agentis-mcp')
  })
})
