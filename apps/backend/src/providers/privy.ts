import { PrivyClient } from '@privy-io/node'
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { fail } from '../errors'
import { hash } from '../operations'

export function privyIdentity(appId: string, appSecret: string, authorizationKey?: string) {
  const client = new PrivyClient({ appId, appSecret, timeout: 20_000, maxRetries: 0, fetch: async (input, init) => {
    const response = await fetch(input, init)
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname
    const stage = path.endsWith('/authenticate') ? 'user JWT exchange' : path.endsWith('/export') ? 'wallet export' : null
    if (stage && !response.ok) {
      // Only fixed categories and numeric status: no headers, URLs, JWTs, keys, or raw provider payloads.
      const body = await response.clone().json().catch(() => null) as { error?: unknown } | null
      console.error('Privy owner authorization failed', { stage, status: response.status, jwtRejected: body?.error === 'Invalid JWT token provided' })
    }
    return response
  } })
  const publicKey = authorizationKey ? createPublicKey(createPrivateKey({ key: Buffer.from(authorizationKey, 'base64'), format: 'der', type: 'pkcs8' })).export({ type: 'spki', format: 'der' }).toString('base64') : null
  async function setupRequest<T>(stage: string, run: () => Promise<T>, userJwt?: string): Promise<T> {
    try { return await run() } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 'unavailable'
      let detail = error instanceof Error ? error.message : 'Unknown provider error'
      for (const secret of [appSecret, authorizationKey, userJwt]) if (secret) detail = detail.replaceAll(secret, '[redacted]')
      detail = detail.replace(/https?:\/\/\S+/g, '[url]').replace(/[A-Za-z0-9_+/=-]{24,}/g, '[redacted]').replace(/[\r\n\t]/g, ' ').slice(0, 600)
      if (userJwt) {
        try {
          const [header, payload] = userJwt.split('.').slice(0, 2).map(part => JSON.parse(Buffer.from(part!, 'base64url').toString()))
          console.error('Privy wallet auth token checks', { algorithm: ['ES256', 'EdDSA', 'RS256'].includes(header.alg) ? header.alg : 'other', audienceMatches: payload.aud === appId || (Array.isArray(payload.aud) && payload.aud.includes(appId)), secondsToExpiry: typeof payload.exp === 'number' ? Math.floor(payload.exp - Date.now() / 1000) : null })
        } catch { console.error('Privy wallet auth token checks', { malformed: true }) }
      }
      console.error('Privy wallet setup failed', { stage, status, detail })
      if (status === 400 && detail.includes('Invalid JWT token provided')) fail(401, 'wallet_reauthentication_required', 'Privy rejected the wallet authorization session. Sign out and sign in again, then retry setup. No ownership update was authorized.')
      fail(503, 'wallet_setup_failed', `Wallet setup failed during ${stage} (provider status: ${status}). Your wallet address has not been replaced.`)
    }
  }
  async function ownerQuorum(ownerId: string) {
    if (!publicKey) fail(503, 'server_authorization_missing', 'Hosted execution is not configured')
    return setupRequest('quorum creation', () => client.keyQuorums().create({ authorization_threshold: 1, user_ids: [ownerId], public_keys: [publicKey] }))
  }
  return {
    async createWallet(ownerId: string, chainType: 'ethereum' | 'solana', agentId?: string) {
      const externalId = `agentis_${hash(`${ownerId}:${chainType}${agentId ? `:${agentId}` : ''}`).slice(0, 48)}`
      const existing = await client.wallets().list({ external_id: externalId })
      const wallet = existing.data[0] ?? await client.wallets().create({ chain_type: chainType, owner_id: (await ownerQuorum(ownerId)).id, external_id: externalId, idempotency_key: externalId })
      return this.inspectWallet(wallet.id, ownerId)
    },
    async authenticate(token: string) {
      const identity = await client.utils().auth().verifyAccessToken(token)
      return identity.user_id
    },
    async inspectWallet(id: string, ownerId: string) {
      const wallet = await setupRequest('wallet lookup', () => client.wallets().get(id))
      if (!wallet.owner_id) fail(403, 'wallet_owner_mismatch', 'Wallet has no user-controlled owner')
      const quorum = await setupRequest('owner lookup', () => client.keyQuorums().get(wallet.owner_id!))
      const userOwner = quorum.authorization_threshold === 1 && quorum.user_ids?.length === 1 && quorum.user_ids[0] === ownerId && !quorum.key_quorum_ids?.length
      const serverAuthorized = !!publicKey && quorum.authorization_keys.length === 1 && quorum.authorization_keys[0]!.public_key === publicKey
      if (!userOwner || (quorum.authorization_keys.length !== 0 && !serverAuthorized)) fail(403, 'wallet_owner_mismatch', 'Unexpected wallet ownership; no signing authority will be assumed')
      return { providerWalletId: wallet.id, address: wallet.address, chainType: wallet.chain_type, serverAuthorized }
    },
    async testAuthorization(ownerId: string, userJwt: string) {
      const claims = await client.utils().auth().verifyAccessToken(userJwt)
      if (claims.user_id !== ownerId) fail(403, 'owner_required', 'Owner session mismatch')
      const token = { audienceMatches: claims.app_id === appId, issuerMatches: claims.issuer === 'privy.io', sessionPresent: !!claims.session_id, secondsToExpiry: Math.floor(claims.expiration - Date.now() / 1000), secondsSinceIssued: Math.floor(Date.now() / 1000 - claims.issued_at) }
      const requestId = (headers?: Headers) => {
        const value = headers?.get('x-request-id') ?? headers?.get('privy-request-id')
        return value && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null
      }
      try {
        const { publicKey: recipient } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
        // Test only the JWT exchange. Discard the encrypted authorization key: no decryption, signing, or export.
        const { data, response } = await client.wallets().authenticateWithJwt({ user_jwt: userJwt, encryption_type: 'HPKE', recipient_public_key: recipient.export({ type: 'spki', format: 'der' }).toString('base64') }).withResponse()
        const ok = 'encrypted_authorization_key' in data && data.encrypted_authorization_key.encryption_type === 'HPKE'
        return { token, exchange: { ok, status: response.status, requestId: requestId(response.headers), error: ok ? null : 'Expected an HPKE-encrypted user authorization key' } }
      } catch (error) {
        const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : null
        const headers = (error as { headers?: unknown })?.headers
        const jwtRejected = error instanceof Error && error.message.includes('Invalid JWT token provided')
        return { token, exchange: { ok: false, status, requestId: requestId(headers instanceof Headers ? headers : undefined), error: jwtRejected ? 'Invalid JWT token provided' : status === null ? 'SDK or network error; no HTTP response available' : 'Privy rejected the authorization request' } }
      }
    },
    async exportWallet(id: string, ownerId: string, address: string, chainType: 'ethereum' | 'solana', userJwt: string) {
      if (await this.authenticate(userJwt) !== ownerId) fail(403, 'wallet_owner_mismatch', 'Only the owner can export this wallet')
      const wallet = await this.inspectWallet(id, ownerId)
      if (wallet.address !== address || wallet.chainType !== chainType) fail(403, 'wallet_owner_mismatch', 'Wallet identity does not match')
      try {
        // User authorization only. Never fall back to the server quorum signer for export.
        const result = await client.wallets().export(id, { authorization_context: { user_jwts: [userJwt] }, request_expiry: Date.now() + 60_000 })
        return { privateKey: result.private_key }
      } catch (error) {
        // Never expose raw SDK errors: some include sensitive request/response material.
        const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : null
        const jwtRejected = error instanceof Error && error.message.includes('Invalid JWT token provided')
        console.error('Privy export failed', { status, jwtRejected, category: status === null ? 'sdk_or_transport' : 'provider_response' })
        if (jwtRejected) fail(401, 'wallet_export_jwt_rejected', 'Privy rejected the owner token during wallet authorization. Export was not completed; signing in again has not resolved this known issue.')
        if (status === 401 || status === 403) fail(403, 'wallet_export_denied', 'Privy denied this owner’s export authorization. Export was not completed.')
        fail(503, 'wallet_export_failed', status === null ? 'Wallet export failed in the SDK or network connection. Export was not completed.' : `Privy rejected the export flow (HTTP ${status}). Export was not completed.`)
      }
    },
    async enableServerExecution(id: string, ownerId: string, userJwt: string) {
      const wallet = await this.inspectWallet(id, ownerId)
      if (wallet.serverAuthorized) return wallet
      if (await this.authenticate(userJwt) !== ownerId) fail(403, 'wallet_owner_mismatch', 'Only the owner can enable hosted execution')
      const quorum = await ownerQuorum(ownerId)
      // Replace only this wallet's owner. Never mutate a potentially shared user quorum.
      await setupRequest('ownership authorization', () => client.wallets().update(id, { owner_id: quorum.id, authorization_context: { user_jwts: [userJwt] }, request_expiry: Date.now() + 60_000 }), userJwt)
      const updated = await this.inspectWallet(id, ownerId)
      if (!updated.serverAuthorized || updated.address !== wallet.address) throw new Error('Wallet authorization update could not be verified')
      return updated
    },
  }
}
