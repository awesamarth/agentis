import { Entry } from '@napi-rs/keyring'
import { API_BASE } from './config'

const entry = new Entry('agentis-cli', 'account-key')

export type OAuthCredentials = {
  version: 2
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string[]
  clientId: string
}

export type StoredCredentials =
  | { type: 'legacy'; token: string }
  | { type: 'oauth'; credentials: OAuthCredentials }

function readPassword(): string | null {
  try {
    return entry.getPassword()
  } catch {
    return null
  }
}

export async function saveOAuthCredentials(credentials: OAuthCredentials): Promise<void> {
  entry.setPassword(JSON.stringify(credentials))
}

export async function getStoredCredentials(): Promise<StoredCredentials | null> {
  const envToken = process.env.AGENTIS_ACCOUNT_KEY
  if (envToken) return { type: 'legacy', token: envToken }

  const stored = readPassword()
  if (!stored) return null
  if (!stored.startsWith('{')) return { type: 'legacy', token: stored }

  try {
    const credentials = JSON.parse(stored) as OAuthCredentials
    if (
      credentials.version === 2 &&
      credentials.accessToken?.startsWith('agt_oauth_') &&
      credentials.refreshToken?.startsWith('agt_refresh_')
    ) {
      return { type: 'oauth', credentials }
    }
  } catch {
    // Treat malformed keychain data as unauthenticated.
  }
  return null
}

async function refresh(credentials: OAuthCredentials): Promise<OAuthCredentials | null> {
  const response = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId,
    }),
  }).catch(() => null)
  if (!response?.ok) return null

  const body = await response.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
    scope: string
  }
  const updated: OAuthCredentials = {
    ...credentials,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    scope: body.scope.split(/\s+/).filter(Boolean),
  }
  await saveOAuthCredentials(updated)
  return updated
}

export async function getToken(): Promise<string | null> {
  const stored = await getStoredCredentials()
  if (!stored) return null
  if (stored.type === 'legacy') return stored.token

  if (stored.credentials.expiresAt > Date.now() + 60_000) {
    return stored.credentials.accessToken
  }
  return (await refresh(stored.credentials))?.accessToken ?? null
}

export async function deleteToken(): Promise<void> {
  try {
    entry.deletePassword()
  } catch {
    // Already removed.
  }
}
