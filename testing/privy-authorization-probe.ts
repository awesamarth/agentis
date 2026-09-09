// Live Privy API probe: creates one isolated authorization-key-owned test wallet.
// Signs a Base Sepolia transaction but NEVER broadcasts or imports a wallet key.
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { PrivyClient } from '@privy-io/node'
import { baseSepolia } from 'viem/chains'
import { parseTransaction, recoverTransactionAddress, type TransactionSerialized } from 'viem'

const directory = resolve(import.meta.dir, '../.agentis-test-keys')
mkdirSync(directory, { recursive: true, mode: 0o700 })
const file = resolve(directory, 'privy-authorization-probe.json')
type State = { privateKey: string; publicKey: string; walletId?: string; address?: string }
let state: State
if (existsSync(file)) state = JSON.parse(readFileSync(file, 'utf8'))
else {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  state = { privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }
  writeFileSync(file, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
}
assert(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET, 'Privy app credentials required in private environment')
const client = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET })
try {
  if (!state.walletId) {
    const externalId = 'agentis_hosted_authorization_probe_v1'
    const existing = await client.wallets().list({ external_id: externalId })
    const wallet = existing.data[0] ?? await client.wallets().create({ chain_type: 'ethereum', owner: { public_key: state.publicKey }, external_id: externalId, idempotency_key: externalId })
    state.walletId = wallet.id; state.address = wallet.address
    writeFileSync(file, JSON.stringify(state), { mode: 0o600 })
  }
  const wallet = await client.wallets().get(state.walletId)
  assert(wallet.owner_id, 'Test wallet must have an owner')
  const quorum = await client.keyQuorums().get(wallet.owner_id)
  assert(quorum.authorization_keys.some(key => key.public_key === state.publicKey), 'Unexpected owner; refusing to use wallet')
  const request = { params: { transaction: { chain_id: baseSepolia.id, to: wallet.address, value: '0x0', nonce: 0, gas_limit: '0x5208', gas_price: '0x3b9aca00', type: 0 } } } as const
  let denied = false
  try { await client.wallets().ethereum().signTransaction(wallet.id, request) }
  catch (error) {
    const status = (error as { status?: number }).status
    console.log(JSON.stringify({ step: 'app-secret-only signing', status, detail: (error as { error?: { error?: string; code?: string } }).error }))
    denied = status === 401 || status === 403
  }
  assert(denied, 'Expected authorization denial without owner signature')
  const result = await client.wallets().ethereum().signTransaction(wallet.id, { ...request, authorization_context: { authorization_private_keys: [state.privateKey] } })
  const serialized = result.signed_transaction as TransactionSerialized
  assert.equal(parseTransaction(serialized).chainId, baseSepolia.id)
  assert.equal((await recoverTransactionAddress({ serializedTransaction: serialized })).toLowerCase(), wallet.address.toLowerCase())
  console.log(JSON.stringify({ step: 'owner-authorized signing', ok: true, chainId: baseSepolia.id, address: wallet.address, broadcast: false, browserUserAuthorization: 'requires signed-in user; this probe tests authorization-key ownership only' }))
} catch (error) {
  console.error(JSON.stringify({ probe: 'failed', name: (error as Error).name, status: (error as { status?: number }).status, code: (error as { error?: { code?: string } }).error?.code }))
  process.exitCode = 1
}
