import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'

let directory = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agentis-oauth-'))
  process.env.AGENTIS_DB_PATH = join(directory, 'db.json')
  process.env.AGENTIS_KEY_SECRETS_PATH = join(directory, 'key-secrets.json')
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('OAuth grant storage', () => {
  test('authorization codes are one-time and refresh rotation revokes old tokens', async () => {
    const db = await import(`./db.ts?oauth-test=${Date.now()}`)
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    await db.createOAuthAuthorizationCode({
      code: 'authorization-code',
      clientId: 'test-client',
      redirectUri: 'http://127.0.0.1:3000/callback',
      codeChallenge: 'challenge',
      scope: ['wallets:read'],
      userId: 'did:privy:test',
      expiresAt,
    })

    const expected = {
      clientId: 'test-client',
      redirectUri: 'http://127.0.0.1:3000/callback',
      codeChallenge: 'challenge',
    }
    expect(await db.consumeOAuthAuthorizationCode('authorization-code', {
      ...expected,
      codeChallenge: 'wrong',
    })).toBeUndefined()
    expect(await db.consumeOAuthAuthorizationCode('authorization-code', expected)).toBeDefined()
    expect(await db.consumeOAuthAuthorizationCode('authorization-code', expected)).toBeUndefined()

    await db.createOAuthGrant({
      id: 'grant-1',
      userId: 'did:privy:test',
      clientId: 'test-client',
      clientName: 'Test client',
      scope: ['wallets:read'],
      resource: 'https://mcp.agentis.systems/mcp',
      accessToken: 'agt_oauth_old',
      accessTokenExpiresAt: expiresAt,
      refreshToken: 'agt_refresh_old',
      refreshTokenExpiresAt: expiresAt,
    })
    expect(await db.getOAuthGrantByAccessToken('agt_oauth_old')).toBeDefined()

    await db.rotateOAuthGrantTokens({
      grantId: 'grant-1',
      accessToken: 'agt_oauth_new',
      accessTokenExpiresAt: expiresAt,
      refreshToken: 'agt_refresh_new',
      refreshTokenExpiresAt: expiresAt,
    })
    expect(await db.getOAuthGrantByAccessToken('agt_oauth_old')).toBeUndefined()
    expect(await db.getOAuthGrantByRefreshToken('agt_refresh_old')).toBeUndefined()
    expect(await db.getOAuthGrantByAccessToken('agt_oauth_new')).toBeDefined()

    await db.revokeOAuthToken('agt_refresh_new')
    expect(await db.getOAuthGrantByAccessToken('agt_oauth_new')).toBeUndefined()
  })
})
