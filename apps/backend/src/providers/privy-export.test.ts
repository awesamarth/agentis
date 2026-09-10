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
    await expect(identity.exportWallet('wallet', 'owner', 'address', 'ethereum', 'fixture-user-jwt')).rejects.toThrow('Privy could not authorize the export. No server-signer fallback was attempted.')
    expect(exportKey).toHaveBeenCalledTimes(2)
    threshold = 2
    await expect(identity.exportWallet('wallet', 'owner', 'address', 'ethereum', 'fixture-user-jwt')).rejects.toThrow('Unexpected wallet ownership')
    expect(exportKey).toHaveBeenCalledTimes(2)
  } finally { walletSpy.mockRestore(); quorumSpy.mockRestore(); authSpy.mockRestore() }
})
