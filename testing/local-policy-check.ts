// Focused local budget checks; no public RPC, price HTTP or money.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createLocalWallet, localWalletDirectory, loadLocalWallet } from '../packages/cli/src/lib/local-wallet'
import { reserveLocal, signWithPolicy, releaseUnissued, settleLocal, setLocalPolicy, showLocalPolicy, costUsd } from '../packages/cli/src/lib/local-policy'
const home = process.env.AGENTIS_LOCAL_POLICY_CHECK_HOME ?? mkdtempSync(join(tmpdir(), 'agentis-policy-check-'))
if (!process.env.AGENTIS_LOCAL_POLICY_CHECK_HOME) {
  const child = Bun.spawn(['bun', import.meta.path], { env: { ...process.env, HOME: home, AGENTIS_LOCAL_POLICY_CHECK_HOME: home }, stdout: 'inherit', stderr: 'inherit' })
  const code = await child.exited
  rmSync(home, { recursive: true, force: true }); process.exit(code)
}
assert(localWalletDirectory().startsWith(home + '/'), 'Tests must use an isolated wallet directory')
try {
  const wallet = await createLocalWallet('policy-check', undefined, ['base', 'tempo', 'solana'])
  const secretBefore = loadLocalWallet(wallet.id).mnemonic
  await setLocalPolicy(wallet.id, { perTransaction: '1', hourly: '1.5', daily: '2', total: '2' })
  const terms = { chain: 'tempo' as const, asset: 'alphaUSD', amountAtomic: '400000', maxFeeAtomic: '1000000000000000' }
  await assert.rejects(reserveLocal(wallet.id, 'over', { ...terms, amountAtomic: '1000000' }), /per-transaction/)
  await reserveLocal(wallet.id, 'first', terms)
  assert.equal(await signWithPolicy(wallet.id, 'first', async () => 'signed'), 'signed')
  await settleLocal(wallet.id, 'first', true, '500000000000000')
  await settleLocal(wallet.id, 'first', true, '500000000000000')
  assert.equal((await showLocalPolicy(wallet.id)).spent, '$0.4005')
  const concurrent = await Promise.allSettled(['second', 'third'].map(key => reserveLocal(wallet.id, key, { ...terms, amountAtomic: '600000' })))
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1)
  const heldKey = concurrent[0]!.status === 'fulfilled' ? 'second' : 'third'
  await setLocalPolicy(wallet.id, { paused: true })
  await assert.rejects(signWithPolicy(wallet.id, heldKey, async () => { throw Error('Must not reach signer') }), /paused/)
  await releaseUnissued(wallet.id, heldKey)
  assert.equal((await showLocalPolicy(wallet.id)).reserved, '$0')
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) { const rpc = await request.json() as { id: number }; return Response.json({ id: rpc.id, jsonrpc: '2.0', result: '0xa5bf' }) } })
  try {
    const child = Bun.spawn(['bun', resolve('packages/cli/src/index.ts'), 'wallet', 'send', '--local', '--wallet', wallet.id, '--chain', 'tempo', '--to', '0x0000000000000000000000000000000000000001', '--amount', '0.01', '--key', 'paused-yes', '--yes'], { env: { ...process.env, TEMPO_TESTNET_RPC_URL: `http://127.0.0.1:${server.port}` }, stdout: 'pipe', stderr: 'pipe' })
    const error = await new Response(child.stderr).text(); assert.equal(await child.exited, 1); assert(error.includes('paused'), error)
  } finally { server.stop(true) }
  await setLocalPolicy(wallet.id, { paused: false })
  await reserveLocal(wallet.id, 'failed', terms)
  await signWithPolicy(wallet.id, 'failed', async () => 'signed')
  await settleLocal(wallet.id, 'failed', false, '500000000000000')
  assert.equal((await showLocalPolicy(wallet.id)).spent, '$0.401')
  await reserveLocal(wallet.id, 'uncertain', terms)
  await assert.rejects(signWithPolicy(wallet.id, 'uncertain', async () => { throw Error('Simulated interruption') }))
  await releaseUnissued(wallet.id, 'uncertain')
  assert.equal((await showLocalPolicy(wallet.id)).reserved, '$0.401')
  await assert.rejects(signWithPolicy(wallet.id, 'uncertain', async () => 'must-not-sign'), /already authorized/)
  const directory = join(localWalletDirectory(), 'policies')
  const file = join(directory, readdirSync(directory).find(file => file.endsWith('.json'))!)
  const ledger = JSON.parse(readFileSync(file, 'utf8'))
  for (const entry of ledger.entries) { entry.createdAt -= 172800000; if (entry.signedAt) entry.signedAt -= 172800000 }
  writeFileSync(file, JSON.stringify(ledger), { mode: 0o600 })
  await setLocalPolicy(wallet.id, { hourly: '0.5' })
  await assert.rejects(reserveLocal(wallet.id, 'old-unknown-still-counts', terms), /hourly/)
  await setLocalPolicy(wallet.id, { hourly: null, daily: null, total: '0.8' })
  await assert.rejects(reserveLocal(wallet.id, 'total-never-resets', terms), /total/)
  await setLocalPolicy(wallet.id, { perTransaction: '0' })
  await assert.rejects(reserveLocal(wallet.id, 'zero', terms), /per-transaction/)
  assert.equal(loadLocalWallet(wallet.id).mnemonic, secretBefore)
  assert.equal(costUsd({ ...terms, amountAtomic: '1', maxFeeAtomic: '0' }, { amountPrice: '999800000000000000', feePrice: '0', amountDecimals: 6, feeDecimals: 18, expiresAt: 0 }), 1n)
  console.log('Local policy checks passed: fee-inclusive caps, atomic concurrent reservations, pause/--yes, signing recheck, failures, unknown retention, rolling windows, total, zero, rounding and key preservation.')
} finally { /* Parent removes this isolated HOME after child exit. */ }
