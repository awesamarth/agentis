import { PrivyClient } from '@privy-io/node'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { fail } from '../errors'
import { hash } from '../operations'

export function privyIdentity(appId: string, appSecret: string, authorizationKey?: string) {
  const client = new PrivyClient({ appId, appSecret, timeout: 20_000, maxRetries: 0 })
  const publicKey = authorizationKey ? createPublicKey(createPrivateKey({ key: Buffer.from(authorizationKey, 'base64'), format: 'der', type: 'pkcs8' })).export({ type: 'spki', format: 'der' }).toString('base64') : null
  async function ownerQuorum(ownerId: string) {
    if (!publicKey) fail(503, 'server_authorization_missing', 'Hosted execution is not configured')
    return client.keyQuorums().create({ authorization_threshold: 1, user_ids: [ownerId], public_keys: [publicKey] })
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
      const wallet = await client.wallets().get(id)
      if (!wallet.owner_id) fail(403, 'wallet_owner_mismatch', 'Wallet has no user-controlled owner')
      const quorum = await client.keyQuorums().get(wallet.owner_id)
      const userOwner = quorum.authorization_threshold === 1 && quorum.user_ids?.length === 1 && quorum.user_ids[0] === ownerId && !quorum.key_quorum_ids?.length
      const serverAuthorized = !!publicKey && quorum.authorization_keys.length === 1 && quorum.authorization_keys[0]!.public_key === publicKey
      if (!userOwner || (quorum.authorization_keys.length !== 0 && !serverAuthorized)) fail(403, 'wallet_owner_mismatch', 'Unexpected wallet ownership; no signing authority will be assumed')
      return { providerWalletId: wallet.id, address: wallet.address, chainType: wallet.chain_type, serverAuthorized }
    },
    async enableServerExecution(id: string, ownerId: string, userJwt: string) {
      const wallet = await this.inspectWallet(id, ownerId)
      if (wallet.serverAuthorized) return wallet
      if (await this.authenticate(userJwt) !== ownerId) fail(403, 'wallet_owner_mismatch', 'Only the owner can enable hosted execution')
      const quorum = await ownerQuorum(ownerId)
      // Replace only this wallet's owner. Never mutate a potentially shared user quorum.
      await client.wallets().update(id, { owner_id: quorum.id, authorization_context: { user_jwts: [userJwt] }, request_expiry: Date.now() + 60_000 })
      const updated = await this.inspectWallet(id, ownerId)
      if (!updated.serverAuthorized || updated.address !== wallet.address) throw new Error('Wallet authorization update could not be verified')
      return updated
    },
  }
}
