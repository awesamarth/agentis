// Explicit opt-in: disposable local wallet + public Tempo TESTNET faucet tokens.
// bun testing/tempo-splits-live-check.ts --testnet [--push]
// Not part of the offline suite. Never reads/funds an existing wallet or mainnet.
import assert from 'node:assert/strict'
import { mkdtempSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createPublicClient, http, erc20Abi } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { Actions } from 'viem/tempo'
import { Mppx, tempo } from 'mppx/server'
import { createLocalWallet, loadLocalWallet } from '../packages/cli/src/lib/local-wallet'

if (!process.argv.includes('--testnet')) throw Error('Explicit --testnet opt-in required')
const push = process.argv.includes('--push')
const scenarios = push ? [{ name: 'push', sponsored: false, httpFailure: false }, { name: 'push-http-failure', sponsored: false, httpFailure: true }] : [{ name: 'false', sponsored: false, httpFailure: false }, { name: 'true', sponsored: true, httpFailure: false }]
const rpcUrl = 'https://rpc.moderato.tempo.xyz'
const token = '0x20c0000000000000000000000000000000000001' as const
const rpc = createPublicClient({ chain: tempoModerato, transport: http(rpcUrl, { timeout: 15000, retryCount: 0 }) })
const home = mkdtempSync(`${tmpdir()}/agentis-tempo-splits-`); chmodSync(home, 0o700)
const directory = join(home, '.agentis', 'wallets-v2')
let server: ReturnType<typeof Bun.serve> | undefined, phase = 'network'
const errorLog = console.error
// Provider SDK errors can contain signed RPC payloads. Never print those objects.
console.error = (...values: unknown[]) => {
  const error = values.find(value => value instanceof Error) as Error | undefined
  errorLog({ providerError: error?.name ?? 'MPP error', message: error?.message.split('\n')[0]?.replace(/[A-Za-z0-9+/_=-]{100,}/g, '[data omitted]').slice(0, 300) })
}
try {
  assert.equal(await rpc.getChainId(), 42431)
  const created = await createLocalWallet('tempo-splits-testnet', directory, ['tempo-testnet'])
  const wallet = loadLocalWallet(created.id, directory)
  const sponsor = privateKeyToAccount(generatePrivateKey()), seller = privateKeyToAccount(generatePrivateKey()), affiliate = privateKeyToAccount(generatePrivateKey())
  phase = 'faucet'
  await Actions.faucet.fundSync(rpc, { account: wallet.addresses.evm as `0x${string}`, timeout: 30000 })
  if (!push) await Actions.faucet.fundSync(rpc, { account: sponsor.address, timeout: 30000 })
  const balance = (owner: `0x${string}`) => rpc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
  assert.ok(await balance(wallet.addresses.evm as `0x${string}`) > 1000n)
  let requests = 0, paid = 0
  const methods = new Map(scenarios.map(({ name, sponsored }) => [name, Mppx.create({ secretKey: 'disposable-tempo-testnet-fixture-secret-32-plus', methods: [tempo.charge({ chainId: 42431, supportedModes: push ? ['push'] : ['pull'], currency: token, decimals: 6, recipient: seller.address, feeToken: '0x20c0000000000000000000000000000000000000', ...(sponsored ? { feePayer: sponsor } : {}), getClient: () => rpc })] })]))
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests++
    if (push) { assert.equal(request.method, 'POST'); assert.deepEqual(await request.clone().json(), { query: 'push-fixture' }) }
    const name = new URL(request.url).pathname.slice(1)
    const scenario = scenarios.find(scenario => scenario.name === name)!
    const method = methods.get(name)!
    const result = await method.charge({ amount: '0.001', splits: [{ recipient: affiliate.address, amount: '0.0001', memo: `0x${'ab'.repeat(32)}` }, { recipient: affiliate.address, amount: '0.00015' }], expires: new Date(Date.now() + 300_000).toISOString() })(request)
    if (result.status === 402) return result.challenge
    paid++
    return result.withReceipt(Response.json({ result: scenario.httpFailure ? 'fixture upstream failure after payment' : 'tempo-testnet-split-result' }, { status: scenario.httpFailure ? 503 : 200 }))
  } })
  const origin = `http://127.0.0.1:${server.port}`
  for (const { name, sponsored, httpFailure } of scenarios) {
    phase = name
    const before = await Promise.all([balance(seller.address), balance(affiliate.address)])
    const args = ['packages/cli/src/index.ts', 'fetch', `${origin}/${name}`, ...(push ? ['--method', 'POST', '--header', 'Content-Type: application/json', '--data', '{"query":"push-fixture"}'] : []), '--local', '--wallet', wallet.id, '--chain', 'tempo-testnet', '--asset', 'alphaUSD', '--fee-asset', 'alphaUSD', '--max-amount-atomic', '1000', '--max-fee-atomic', sponsored ? '0' : '10000000000000000', '--key', `split-${name}`, '--yes', '--json']
    const run = async () => {
      const child = Bun.spawn([process.execPath, ...args], { cwd: resolve(import.meta.dir, '..'), env: { ...process.env, HOME: home, TEMPO_TESTNET_RPC_URL: rpcUrl, AGENTIS_PAID_FETCH_LOCAL_ORIGINS: origin }, stdout: 'pipe', stderr: 'pipe' })
      const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      if (code !== 0) throw Error(`CLI preparation failed: ${(error || output).replace(/0x[0-9a-f]{120,}/gi, '[hex omitted]').slice(0, 300)}`)
      return JSON.parse(output)
    }
    const result = await run()
    assert.equal(result.status, 'confirmed', 'Inspect saved proof before any retry; this script never resends')
    assert.equal(result.httpResponse?.status, httpFailure ? 503 : 200)
    assert.equal(result.mppMode, push ? 'push' : 'pull')
    assert.deepEqual(result.transfers.map((transfer: { amountAtomic: string }) => transfer.amountAtomic), ['750', '100', '150'])
    assert.equal(await balance(seller.address) - before[0]!, 750n)
    assert.equal(await balance(affiliate.address) - before[1]!, 250n)
    if (sponsored) assert.equal(result.feeAtomic, '0')
    const previousRequests = requests
    const repeated = await run()
    assert.equal(repeated.transactionHash, result.transactionHash)
    assert.equal(requests, previousRequests)
    console.log({ mode: result.mppMode, sponsored, status: result.status, transactionHash: result.transactionHash, feeAtomic: result.feeAtomic, splitAmounts: ['750', '100', '150'], httpStatus: result.httpResponse.status, sameKeyNoResend: true })
  }
  console.log({ home, paid, scope: 'public Tempo testnet, faucet-funded disposable wallet; no real Privy/mainnet spending' })
} catch (error) {
  console.log({ phase, home, error: error instanceof Error ? error.message.replace(/0x[0-9a-f]{120,}/gi, '[hex omitted]').slice(0, 400) : 'Test failed' })
  process.exitCode = 1
} finally { await server?.stop(true); console.error = errorLog }
