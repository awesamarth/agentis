import { createHash, randomBytes } from 'crypto'
import { execFile } from 'child_process'
import { API_BASE } from '../lib/config'
import {
  deleteToken,
  getStoredCredentials,
  getToken,
  saveOAuthCredentials,
} from '../lib/keychain'

const CLIENT_ID = 'agentis-cli'
const SCOPES = [
  'wallets:read',
  'wallets:write',
  'payments:execute',
  'policy:read',
  'policy:write',
  'privacy:read',
  'privacy:write',
  'earn:read',
  'earn:write',
]

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function openBrowser(url: string) {
  if (process.platform === 'darwin') {
    execFile('open', [url], () => {})
  } else if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], () => {})
  } else {
    execFile('xdg-open', [url], () => {})
  }
}

export async function login() {
  const existing = await getStoredCredentials()
  if (existing) {
    console.log('Already logged in. Run `agentis logout` first.')
    return
  }

  const verifier = base64url(randomBytes(48))
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = base64url(randomBytes(24))

  let resolveCallback: (value: { code?: string; error?: string; state?: string }) => void
  const callback = new Promise<{ code?: string; error?: string; state?: string }>(resolve => {
    resolveCallback = resolve
  })
  let handled = false
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname !== '/callback') return new Response('Not found', { status: 404 })
      if (!handled) {
        handled = true
        resolveCallback({
          code: url.searchParams.get('code') ?? undefined,
          error: url.searchParams.get('error') ?? undefined,
          state: url.searchParams.get('state') ?? undefined,
        })
      }
      return new Response(
        '<!doctype html><html><body style="font-family:monospace;padding:40px">Agentis authorization complete. You can close this window.</body></html>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      )
    },
  })

  const redirectUri = `http://127.0.0.1:${server.port}/callback`
  const authorizeUrl = new URL(`${API_BASE}/oauth/authorize`)
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: SCOPES.join(' '),
    state,
    resource: API_BASE,
  }).toString()

  console.log('\nOpen this URL in your browser to authenticate:\n')
  console.log(`  ${authorizeUrl}\n`)
  openBrowser(authorizeUrl.toString())
  console.log('Waiting for authorization...')

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Login timed out. Run `agentis login` again.')), 10 * 60 * 1000)
  })

  try {
    const result = await Promise.race([callback, timeout])
    if (result.error) throw new Error(`Authorization failed: ${result.error}`)
    if (!result.code || result.state !== state) throw new Error('Invalid OAuth callback')

    const response = await fetch(`${API_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        client_id: CLIENT_ID,
      }),
    })
    const body = await response.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      scope?: string
      error_description?: string
    }
    if (!response.ok || !body.access_token || !body.refresh_token || !body.expires_in) {
      throw new Error(body.error_description ?? 'OAuth token exchange failed')
    }

    await saveOAuthCredentials({
      version: 2,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
      scope: body.scope?.split(/\s+/).filter(Boolean) ?? SCOPES,
      clientId: CLIENT_ID,
    })
    console.log('\nAuthenticated. You can now use the Agentis CLI.\n')
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : 'Login failed'}`)
    process.exitCode = 1
  } finally {
    server.stop(true)
  }
}

export async function logout() {
  const stored = await getStoredCredentials()
  if (!stored) {
    console.log('Not logged in.')
    return
  }

  if (stored.type === 'oauth') {
    await fetch(`${API_BASE}/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: stored.credentials.refreshToken }),
    }).catch(() => null)
  }
  await deleteToken()
  console.log('Logged out.')
}

export async function whoami() {
  const stored = await getStoredCredentials()
  const token = await getToken()
  if (!stored || !token) {
    console.log('Not logged in. Run `agentis login`.')
    return
  }
  const masked = token.slice(0, 13) + '••••••••' + token.slice(-4)
  console.log(`Logged in via ${stored.type === 'oauth' ? 'OAuth' : 'account key'} as ${masked}`)
}
