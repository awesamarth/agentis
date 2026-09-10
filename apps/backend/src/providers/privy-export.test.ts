import { expect, mock, spyOn, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { PrivyClient } from '@privy-io/node'
import { privyIdentity } from './privy'

test('quorum export uses only owner JWT authorization and fails closed without leaking provider errors', async () => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const serverKey = keys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  let threshold = 1, reject = false
  const exportKey = mock(async () => {
    if (reject) throw new Error('sensitive-provider-payload')
    return { private_key: 'fixture-not-a-wallet-key' }
  })
  const walletSpy = spyOn(PrivyClient.prototype, 'wallets').mockReturnValue({
    get: async () => ({ id: 'wallet', address: 'address', owner_id: 'quorum', chain_type: 'ethereum' }),
    export: exportKey,
  } as never)
  const quorumSpy = spyOn(PrivyClient.prototype, 'keyQuorums').mockReturnValue({
    get: async () => ({ authorization_threshold: threshold, user_ids: ['owner'], key_quorum_ids: [], authorization_keys: [{ public_key: publicKey }] }),
  } as never)
  const authSpy = spyOn(PrivyClient.prototype, 'utils').mockReturnValue({ auth: () => ({ verifyAccessToken: async () => ({ user_id: 'owner' }) }) } as never)
  try {
    const identity = privyIdentity('fixture-app', 'fixture-secret', serverKey)
    expect(await identity.exportWallet('wallet', 'owner', 'address', 'ethereum', 'fixture-user-jwt')).toEqual({ privateKey: 'fixture-not-a-wallet-key' })
    expect(exportKey).toHaveBeenCalledWith('wallet', { authorization_context: { user_jwts: ['fixture-user-jwt'] }, request_expiry: expect.any(Number) })
    reject = true
    await expect(identity.exportWallet('wallet', 'owner', 'address', 'ethereum', 'fixture-user-jwt')).rejects.toThrow('Wallet export failed in the SDK or network connection. Export was not completed.')
    expect(exportKey).toHaveBeenCalledTimes(2)
    threshold = 2
    await expect(identity.exportWallet('wallet', 'owner', 'address', 'ethereum', 'fixture-user-jwt')).rejects.toThrow('Unexpected wallet ownership')
    expect(exportKey).toHaveBeenCalledTimes(2)
  } finally { walletSpy.mockRestore(); quorumSpy.mockRestore(); authSpy.mockRestore() }
})

test('real SDK JWT rejection is diagnosed before export without logging secrets', async () => {
  const calls: string[] = []
  const logs: unknown[][] = []
  let rejectJwt = true
  const logSpy = spyOn(console, 'error').mockImplementation((...args) => { logs.push(args) })
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: string | Request | URL) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname
    calls.push(path)
    if (path === '/v1/wallets/wallet') return Response.json({ id: 'wallet', address: 'address', owner_id: 'quorum', chain_type: 'ethereum' })
    if (path === '/v1/key_quorums/quorum') return Response.json({ authorization_threshold: 1, user_ids: ['owner'], key_quorum_ids: [], authorization_keys: [] })
    if (path === '/v1/wallets/authenticate') return rejectJwt ? Response.json({ error: 'Invalid JWT token provided', code: 'invalid_data' }, { status: 400, headers: { 'x-request-id': 'fixture-request' } }) : Response.json({ encrypted_authorization_key: { encryption_type: 'HPKE', ciphertext: 'fixture-encrypted-secret', encapsulated_key: 'fixture-encapsulation' }, expires_at: Date.now() + 60_000, wallets: [] })
    throw new Error('Unexpected outbound request')
  }) as typeof fetch)
  const authSpy = spyOn(PrivyClient.prototype, 'utils').mockReturnValue({ auth: () => ({ verifyAccessToken: async () => ({ user_id: 'owner', app_id: 'fixture-app', issuer: 'privy.io', session_id: 'fixture-session', issued_at: Math.floor(Date.now() / 1000), expiration: Math.floor(Date.now() / 1000) + 3600 }) }) } as never)
  try {
    const identity = privyIdentity('fixture-app', 'fixture-secret')
    await expect(identity.exportWallet('wallet', 'owner', 'address', 'ethereum', 'fixture-user-jwt')).rejects.toThrow('Privy rejected the owner token during wallet authorization')
    expect(calls).toContain('/v1/wallets/authenticate')
    expect(calls).not.toContain('/v1/wallets/wallet/export')
    expect(logs).toContainEqual(['Privy owner authorization failed', { stage: 'user JWT exchange', status: 400, jwtRejected: true }])
    expect(JSON.stringify(logs)).not.toContain('fixture-user-jwt')
    expect(JSON.stringify(logs)).not.toContain('fixture-secret')
    const failed = await identity.testAuthorization('owner', 'fixture-user-jwt')
    expect(failed.exchange).toEqual({ ok: false, status: 400, requestId: 'fixture-request', error: 'Invalid JWT token provided' })
    expect(failed.token.audienceMatches).toBe(true)
    rejectJwt = false
    const passed = await identity.testAuthorization('owner', 'fixture-user-jwt')
    expect(passed.exchange.ok).toBe(true)
    expect(JSON.stringify(passed)).not.toContain('fixture-encrypted-secret')
    expect(JSON.stringify(passed)).not.toContain('fixture-user-jwt')
    expect(calls.filter(path => path.endsWith('/authenticate'))).toHaveLength(3)
    expect(calls.some(path => path.endsWith('/export') || path.endsWith('/rpc'))).toBe(false)
  } finally { fetchSpy.mockRestore(); authSpy.mockRestore(); logSpy.mockRestore() }
})
