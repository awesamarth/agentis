import { createHash, randomBytes } from 'crypto'
import { execFile } from 'child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MCP_URL = new URL(process.env.AGENTIS_MCP_URL ?? 'https://mcp.agentis.systems/mcp')
const API_URL = process.env.AGENTIS_API_URL ?? 'https://api.agentis.systems'
const MODE = process.env.AGENTIS_MCP_TEST_MODE ?? 'read'
const WRITE_AGENT = process.env.AGENTIS_MCP_WRITE_AGENT ?? 'cli-test-agent'

function openBrowser(url: string) {
  if (process.platform === 'darwin') execFile('open', [url], () => {})
  else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {})
  else execFile('xdg-open', [url], () => {})
}

const callbackResult = Promise.withResolvers<{ code?: string; state?: string; error?: string }>()
let handled = false
const callbackServer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname !== '/callback') return new Response('Not found', { status: 404 })
    if (!handled) {
      handled = true
      callbackResult.resolve({
        code: url.searchParams.get('code') ?? undefined,
        state: url.searchParams.get('state') ?? undefined,
        error: url.searchParams.get('error') ?? undefined,
      })
    }
    return new Response('Agentis MCP authorization complete. You can close this window.')
  },
})

const redirectUri = `http://127.0.0.1:${callbackServer.port}/callback`
const registrationResponse = await fetch(`${API_URL}/oauth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'Agentis remote MCP E2E',
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
  }),
})
if (!registrationResponse.ok) throw new Error(`Client registration failed: ${await registrationResponse.text()}`)
const registration = await registrationResponse.json() as { client_id: string }

const verifier = randomBytes(48).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')
const state = randomBytes(24).toString('base64url')
const authorizeUrl = new URL(`${API_URL}/oauth/authorize`)
authorizeUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: registration.client_id,
  redirect_uri: redirectUri,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  scope: MODE === 'write'
    ? 'wallets:read policy:read policy:write'
    : 'wallets:read policy:read privacy:read earn:read',
  state,
  resource: MCP_URL.toString(),
}).toString()

console.log(`Opening Agentis authorization for ${MCP_URL.origin}...`)
openBrowser(authorizeUrl.toString())

let timeoutId: ReturnType<typeof setTimeout> | undefined
const timeout = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(() => reject(new Error('Authorization timed out')), 10 * 60 * 1000)
})

try {
  const callback = await Promise.race([callbackResult.promise, timeout])
  if (callback.error) throw new Error(`Authorization failed: ${callback.error}`)
  if (!callback.code || callback.state !== state) throw new Error('Invalid OAuth callback')

  const tokenResponse = await fetch(`${API_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: callback.code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: registration.client_id,
    }),
  })
  if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${await tokenResponse.text()}`)
  const tokens = await tokenResponse.json() as { access_token: string; refresh_token: string }

  const client = new Client({ name: 'agentis-remote-e2e', version: '1.0.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(MCP_URL, {
    requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
  })
  await client.connect(transport)
  const tools = await client.listTools()
  const agents = await client.callTool({ name: 'agentis_list_agents', arguments: {} })
  const agentList = JSON.parse(String((agents.content as Array<{ text?: string }>)[0]?.text ?? '[]'))
  let writeResult: unknown
  if (MODE === 'write') {
    writeResult = await client.callTool({
      name: 'agentis_policy_update',
      arguments: { agent: WRITE_AGENT, maxPerTx: 1111 },
    })
  }
  console.log(JSON.stringify({
    toolCount: tools.tools.length,
    firstTool: tools.tools[0]?.name,
    lastTool: tools.tools.at(-1)?.name,
    agentCount: agentList.length,
    firstAgent: agentList[0],
    writeMode: MODE === 'write',
    writeResult,
  }, null, 2))
  await client.close()

  await fetch(`${API_URL}/oauth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: tokens.refresh_token }),
  })
} finally {
  if (timeoutId) clearTimeout(timeoutId)
  callbackServer.stop(true)
}
