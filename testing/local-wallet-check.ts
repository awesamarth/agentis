// No network calls or money. Run: bun testing/local-wallet-check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mnemonicToAccount } from 'viem/accounts'
import { createLocalWallet, deriveLocalAddress, listLocalWallets, loadLocalWallet } from '../packages/cli/src/lib/local-wallet'
import { exactAmount } from '../packages/cli/src/lib/local-send'
import { parseChains } from '../packages/cli/src/lib/local-networks'
const directory = mkdtempSync(join(tmpdir(), 'agentis-local-check-'))
try {
  const wallet = await createLocalWallet('all-chains', directory, ['base', 'arc', 'tempo', 'solana'])
  assert.equal(wallet.networks.length, 4)
  assert.equal(new Set(wallet.networks.slice(0, 3).map(network => network.address)).size, 1)
  assert.notEqual(wallet.networks[0]!.address, wallet.networks[3]!.address)
  const stored = loadLocalWallet(wallet.id, directory)
  assert.equal(stored.addresses.evm, mnemonicToAccount(stored.mnemonic).address)
  assert.equal(stored.addresses.solana, await deriveLocalAddress(stored.mnemonic))
  assert.equal(statSync(directory).mode & 0o777, 0o700)
  assert.equal(statSync(join(directory, `${wallet.id}.json`)).mode & 0o777, 0o600)
  assert(!JSON.stringify(wallet).includes(stored.mnemonic))
  await assert.rejects(createLocalWallet('ALL-CHAINS', directory), /already exists/)
  assert.equal((await createLocalWallet('default', directory)).networks[0]!.name, 'Base')
  assert.throws(() => parseChains('mainnet'))
  assert.throws(() => parseChains('base,base'))
  assert.throws(() => exactAmount('0.0000001', 6))
  assert.throws(() => exactAmount('-1', 18))
  assert.throws(() => exactAmount('1e3', 18))
  assert.equal(exactAmount('9007199254740993.000001', 6), 9007199254740993000001n)
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  const legacyPath = join(directory, 'legacy.json')
  const legacy = JSON.stringify({ version: 2, id: crypto.randomUUID(), name: 'legacy', chain: 'solana', mnemonic, address: await deriveLocalAddress(mnemonic), createdAt: new Date().toISOString() })
  writeFileSync(legacyPath, legacy, { mode: 0o600 })
  assert.equal(listLocalWallets(directory).find(item => item.name === 'legacy')!.networks[0]!.address, await deriveLocalAddress(mnemonic))
  assert.equal(readFileSync(legacyPath, 'utf8'), legacy)
  chmodSync(legacyPath, 0o644)
  assert.throws(() => listLocalWallets(directory), /permissions/)
  chmodSync(legacyPath, 0o600)
  symlinkSync(legacyPath, join(directory, 'link.json'))
  assert.throws(() => listLocalWallets(directory), /permissions/)
  const home = join(directory, 'home'); mkdirSync(home, { mode: 0o700 })
  const run = (args: string[]) => Bun.spawnSync(['bun', resolve('packages/cli/src/index.ts'), ...args], { env: { ...process.env, HOME: home }, stdout: 'pipe', stderr: 'pipe' })
  const created = run(['wallet', 'create', '--local', '--name', 'cli-check', '--chains', 'base,solana', '--json'])
  assert.equal(created.exitCode, 0, created.stderr.toString())
  const output = JSON.parse(created.stdout.toString())
  assert.equal(output.networks.length, 2)
  assert(!created.stdout.toString().includes('mnemonic'))
  assert(!created.stdout.toString().includes('████'))
  assert.equal(run(['wallet', 'create', '--local', '--json']).exitCode, 1)
  assert.equal(run(['wallet', 'send', '--local', '--wallet', 'cli-check', '--chain', 'arc', '--to', 'invalid', '--amount', '1', '--key', 'no-payment', '--yes']).exitCode, 1)
  const calls: string[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const rpc = await request.json() as { id: number; method: string }
    calls.push(rpc.method)
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: '0x1' }) // Wrong EVM chain: mainnet.
  } })
  try {
    const child = Bun.spawn(['bun', resolve('packages/cli/src/index.ts'), 'wallet', 'send', '--local', '--wallet', 'cli-check', '--chain', 'base', '--to', '0x0000000000000000000000000000000000000001', '--amount', '0.001', '--key', 'wrong-chain', '--yes'], { env: { ...process.env, HOME: home, BASE_SEPOLIA_RPC_URL: `http://127.0.0.1:${server.port}` }, stdout: 'pipe', stderr: 'pipe' })
    const error = await new Response(child.stderr).text()
    assert.equal(await child.exited, 1)
    assert(error.includes('network-and-wallet-validation'))
    assert.deepEqual(calls, ['eth_chainId']) // No signing/submission or even fee preparation.
  } finally { server.stop(true) }
  assert.equal(run(['fetch', '--local', '--wallet', 'cli-check']).exitCode, 1)
  console.log('Local wallets: shared EVM derivation, separate Solana, Base default, legacy preservation, permissions, exact decimals, CLI JSON and wrong-chain rejection passed. No money sent.')
} finally { rmSync(directory, { recursive: true, force: true }) }
