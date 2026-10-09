// Manual integration: run against a disposable Surfpool devnet fork, never a public RPC.
// surfpool start --network devnet --no-tui --no-studio --no-deploy --port 18899 --ws-port 18900
// bun testing/solana-mpp-local-check.ts [--splits]
// Real local SVM execution + official MPP server/client + isolated CLI wallet/policy.
import assert from 'node:assert/strict'
import { mkdtempSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Mppx, solana } from '@solana/mpp/server'
import { createKeyPairSignerFromBytes, generateKeyPairSigner, getBase64EncodedWireTransaction, getTransactionDecoder } from '@solana/kit'
import type { PrivyClient } from '@privy-io/node'
import type { WalletRow } from '../apps/backend/src/db/schema'
import { discoverSvm } from '../apps/backend/src/modules/x402-solana'
import { createPrivySolanaMpp } from '../apps/backend/src/modules/solana-mpp'
import { networkByKey } from '@agentis-hq/core/networks'
import { createLocalWallet, loadLocalWallet, deriveSolanaKey } from '../packages/cli/src/lib/local-wallet'

const rpcUrl = 'http://127.0.0.1:18899'
const splitMode = process.argv.includes('--splits')
const feeCap = splitMode ? '5000000' : '3000000'
async function rpc(method: string, params: unknown[]) {
  const result = await (await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) })).json() as { result?: any; error?: { message: string } }
  if (result.error) throw Error(`${method}: ${result.error.message}`)
  return result.result
}
const home = mkdtempSync(`${tmpdir()}/agentis-solana-mpp-check-`); chmodSync(home, 0o700)
const network = networkByKey('solana-devnet')!, mint = network.assets.find(asset => asset.symbol === 'USDC')!.id.slice(4)
assert.equal(await rpc('getGenesisHash', []), network.genesisHash, 'Use a devnet fork; production genesis validation is not bypassed')
const sponsor = await generateKeyPairSigner()
const directory = join(home, '.agentis', 'wallets-v2')
const created = await createLocalWallet('solana-mpp-local-check', directory, ['solana-devnet'])
const wallet = loadLocalWallet(created.id, directory)
await rpc('requestAirdrop', [wallet.addresses.solana, 1_000_000_000])
await rpc('requestAirdrop', [sponsor.address, 1_000_000_000])
await rpc('surfnet_setTokenAccount', [wallet.addresses.solana, mint, { amount: 1_000_000 }])
let requests = 0, paid = 0
const routes = new Map<string, ReturnType<typeof Mppx.create>>()
for (const sponsored of [true, false]) for (const token of ['SOL', 'USDC']) {
  const recipient = await generateKeyPairSigner()
  await rpc('requestAirdrop', [recipient.address, 1_000_000_000])
  const affiliate = await generateKeyPairSigner()
  await rpc('requestAirdrop', [affiliate.address, 1_000_000_000])
  // Repeated recipients are legal: two transfers, but only one additional ATA rent.
  const splits = splitMode ? [{ recipient: affiliate.address, amount: '100', memo: 'platform' }, { recipient: affiliate.address, amount: '150' }] : undefined
  const method = solana.charge({ splits, recipient: recipient.address, currency: token === 'SOL' ? 'sol' : mint, ...(token === 'USDC' ? { decimals: 6 } : {}), network: 'localnet', rpcUrl, ...(sponsored ? { signer: sponsor } : {}) })
  // Surfpool preserves devnet genesis/assets but marks its blockhashes localnet.
  // Only this disposable seller uses localnet verification; advertise the fork's
  // devnet identity to the unchanged production client/catalog/genesis guard.
  const forkMethod = { ...method, async request(args: Parameters<NonNullable<typeof method.request>>[0]) {
    const terms = await method.request!(args)
    return { ...terms, methodDetails: { ...terms.methodDetails, network: 'devnet' } }
  } }
  routes.set(`/${token}/${sponsored}`, Mppx.create({ secretKey: 'disposable-local-integration-secret', methods: [forkMethod] }))
}
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  requests++
  const route = routes.get(new URL(request.url).pathname)
  if (!route) return new Response('Not found', { status: 404 })
  assert.equal(request.method, 'POST')
  assert.equal(await request.clone().text(), 'exact provider input')
  const result = await route.charge({ amount: '1000', expires: new Date(Date.now() + 300_000).toISOString() })(request)
  if (result.status === 402) return result.challenge
  paid++
  return result.withReceipt(Response.json({ result: 'local-SVM-paid-result', paid }))
} })
const origin = `http://127.0.0.1:${server.port}`
try {
  for (const sponsored of [false, true]) for (const token of ['SOL', 'USDC']) {
    const args = ['packages/cli/src/index.ts', 'fetch', `${origin}/${token}/${sponsored}`, '--local', '--wallet', wallet.id, '--chain', 'solana-devnet', '--asset', token, '--max-amount-atomic', '1000', '--max-fee-atomic', sponsored ? '0' : feeCap, '--method', 'POST', '--data', 'exact provider input', '--key', `${token}-${sponsored}`, '--yes', '--json']
    const run = async () => {
      const child = Bun.spawn([process.execPath, ...args], { cwd: resolve(import.meta.dir, '..'), env: { ...process.env, HOME: home, SOLANA_DEVNET_RPC_URL: rpcUrl, AGENTIS_PAID_FETCH_LOCAL_ORIGINS: origin }, stdout: 'pipe', stderr: 'pipe' })
      const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      if (code !== 0) throw Error(`CLI failed: ${error || output}`)
      return JSON.parse(output)
    }
    const result = await run()
    assert.equal(result.status, 'confirmed')
    assert.equal(result.httpResponse.status, 200)
    assert.equal(JSON.parse(Buffer.from(result.httpResponse.bodyBase64, 'base64').toString()).result, 'local-SVM-paid-result')
    if (sponsored) assert.equal(result.feeAtomic, '0')
    else assert.ok(BigInt(result.feeAtomic) > 0n && BigInt(result.feeAtomic) <= BigInt(feeCap))
    if (splitMode) {
      assert.deepEqual(result.transfers.map((transfer: { amountAtomic: string }) => transfer.amountAtomic), ['750', '100', '150'])
      if (token === 'USDC' && !sponsored) assert.equal(result.feeAtomic, '4083561', 'Charge actual rent for two unique ATAs, not three transfers')
    }
    const before = requests, settled = paid
    const repeated = await run()
    assert.equal(repeated.transactionHash, result.transactionHash)
    assert.equal(requests, before, 'same-key retry must not even contact the seller')
    assert.equal(paid, settled)
    console.log({ token, sponsored, splitMode, status: result.status, feeAtomic: result.feeAtomic, resultDelivered: true, sameKeyNoResend: true })
  }
  // Exercise the hosted adapter/Privy SDK bridge too, with local custody standing
  // in for the remote Privy API. This is not a live Privy authorization test.
  process.env.SOLANA_DEVNET_RPC_URL = rpcUrl
  process.env.AGENTIS_PAID_FETCH_LOCAL_ORIGINS = origin
  const signer = await createKeyPairSignerFromBytes((await deriveSolanaKey(wallet.mnemonic)).secretKey)
  const fakePrivy = { wallets: () => ({ solana: () => ({ async signTransaction(_id: string, input: { transaction: string }) {
    const tx = getTransactionDecoder().decode(Buffer.from(input.transaction, 'base64'))
    const signatures = (await signer.signTransactions([tx as never]))[0]!
    return { signed_transaction: getBase64EncodedWireTransaction({ ...tx, signatures: { ...tx.signatures, ...signatures } } as never) }
  } }) }) } as unknown as PrivyClient
  const input = await discoverSvm({ walletId: wallet.id, url: `${origin}/SOL/true`, method: 'POST', body: 'exact provider input', asset: 'SOL', maxAmountAtomic: '1000', maxFeeAtomic: '0' }, network.chainId)
  const adapter = createPrivySolanaMpp(fakePrivy, 'fixture-only', async () => ({ address: signer.address, serverAuthorized: true }))
  const proof = await adapter.prepare({ chainId: network.chainId, address: signer.address, providerWalletId: 'fixture', ownerId: 'fixture' } as WalletRow, input, { id: crypto.randomUUID(), expiresAt: new Date(input.mpp!.expiresAt) })
  // Persist before the paid request, exactly as the operation worker does.
  await Bun.write(join(home, 'hosted-proof.json'), proof.signedTransaction, { mode: 0o600 })
  let hash: string | undefined
  const response = await adapter.broadcast(await Bun.file(join(home, 'hosted-proof.json')).text(), async value => { hash = value })
  assert.equal(response.status, 200)
  const receipt = await adapter.receipt(proof.signedTransaction, input, hash)
  assert.equal(receipt?.success, true)
  assert.equal(receipt?.feeAtomic, '0')
  assert.equal(receipt?.transactionHash, hash)
  console.log({ hostedAdapter: 'confirmed', custody: 'fake Privy API through installed Privy SDK', resultDelivered: true })
  console.log({ home, paid, scope: 'disposable local SVM fork only; no real Privy or live-network spending' })
} finally {
  await server.stop(true)
}
