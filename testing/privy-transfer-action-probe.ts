// Non-spending probe: never authorizes a transfer or imports a wallet key.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { PrivyClient } from '@privy-io/node'

assert(process.argv[2] === '--probe', 'Explicit --probe required')
assert(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET)
const state = JSON.parse(readFileSync(new URL('../.agentis-test-keys/privy-authorization-probe.json', import.meta.url), 'utf8'))
assert(state.solanaWalletId && state.solanaRecipientId, 'Use the isolated Solana proof wallets')
const client = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET })
const testBase = process.argv[3] === 'base'
const source = await client.wallets().get(testBase ? state.walletId : state.solanaWalletId)
const recipient = testBase ? source : await client.wallets().get(state.solanaRecipientId)
assert(source.chain_type === (testBase ? 'ethereum' : 'solana') && recipient.chain_type === source.chain_type && source.owner_id)
const owner = await client.keyQuorums().get(source.owner_id)
assert(owner.authorization_threshold === 1 && owner.authorization_keys.length === 1 && owner.authorization_keys[0]!.public_key === state.publicKey && (owner.user_ids?.length ?? 0) === 0)
const body = { source: testBase ? { asset: 'eth' as const, chain: 'base_sepolia' as const } : { asset: 'sol' as const, chain: 'solana_devnet' as const }, destination: { address: recipient.address }, amount: testBase ? '0.000001' : '0.001', amount_type: 'exact_input' as const, nonce: crypto.randomUUID() }
try {
  await client.wallets().transfer(source.id, body)
  throw new Error('SECURITY FAILURE: app-only transfer was accepted')
} catch (error) {
  const status = (error as { status?: number }).status
  console.log(JSON.stringify({ step: 'app-only transfer action', status }))
  assert(status === 401 || status === 403, 'Expected owner authorization rejection')
}
// Capture SDK-generated signing input without providing any signature or sending a transfer.
const capture = new Error('Captured unsigned request')
let request: unknown
await assert.rejects(client.wallets().transfer(source.id, { ...body, authorization_context: { sign_fns: [async payload => { request = JSON.parse(new TextDecoder().decode(payload)); throw capture }] } }), error => error === capture)
assert(request)
writeFileSync(new URL('../.agentis-test-keys/privy-transfer-action-request.json', import.meta.url), JSON.stringify(request), { mode: 0o600 })
console.log(JSON.stringify({ step: 'Privy transfer authorization request captured', serialization: 'handled by Privy', broadcast: false }))
try {
  const intent = await client.intents().transfer(source.id, { ...body, 'privy-request-expiry': String(Date.now() + 60_000) })
  console.log(JSON.stringify({ step: 'transfer intent created', id: intent.intent_id, status: intent.status }))
  assert(intent.status === 'pending', 'Intent must not execute without owner authorization')
  const rejected = await client.intents().reject(intent.intent_id, { body: {} })
  assert(rejected.status === 'rejected')
  console.log(JSON.stringify({ step: 'test intent cancelled', status: rejected.status }))
} catch (error) {
  console.log(JSON.stringify({ step: 'transfer intent probe', status: (error as { status?: number }).status, error: (error as Error).name, message: (error as Error).message.replaceAll(process.env.PRIVY_APP_SECRET!, '[redacted]').replaceAll(process.env.PRIVY_APP_ID!, '[app]').replaceAll(state.privateKey, '[redacted]').replace(/https?:\/\/\S+/g, '[URL]') }))
  throw new Error('Transfer intent probe did not complete; no owner signature was supplied')
}
