// Opt-in controlled MAINNET seller for manual hosted Privy E2E checks.
// Run from apps/backend: bun ../../testing/hosted-mpp-seller.ts --serve-mainnet
// This serves challenges/verifies payments; it never creates/approves an Agentis
// operation or signs for the payer. Receiver keys stay in ignored local state.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPublicClient, http } from 'viem'
import { tempo as tempoMainnet } from 'viem/chains'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Keypair } from '@solana/web3.js'
import { Mppx, tempo } from 'mppx/server'
import { Mppx as SolanaMppx, solana } from '@solana/mpp/server'
import { Receipt } from 'mppx'
import { networkByKey, tempoTokens } from '@agentis-hq/core/networks'
import { safeErrorDetails } from '../apps/backend/src/modules/error-diagnostics'

if (!process.argv.includes('--serve-mainnet')) throw Error('Explicit --serve-mainnet opt-in required')
const directory = resolve(import.meta.dir, '../.agentis-local')
mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700)
const file = resolve(directory, 'mpp-seller.json')
if (!existsSync(file)) writeFileSync(file, JSON.stringify({ secret: crypto.randomUUID() + crypto.randomUUID(), evm: [generatePrivateKey(), generatePrivateKey()], solana: [await Keypair.generate(), await Keypair.generate()].map(key => Buffer.from(key.secretKey).toString('base64')) }), { mode: 0o600, flag: 'wx' })
chmodSync(file, 0o600)
const state = JSON.parse(readFileSync(file, 'utf8')) as { secret: string; evm: `0x${string}`[]; solana: string[] }
const evm = state.evm.map(key => privateKeyToAccount(key).address)
const solanaKeys = await Promise.all(state.solana.map(key => Keypair.fromSecretKey(Buffer.from(key, 'base64'))))
const svm = solanaKeys.map(key => key.publicKey.toBase58())
const tempoNetwork = networkByKey('tempo')!, solanaNetwork = networkByKey('solana')!
const rpc = createPublicClient({ chain: tempoMainnet, transport: http(process.env[tempoNetwork.rpcEnv] ?? tempoNetwork.rpcUrl, { timeout: 15000, retryCount: 0 }) })
if (await rpc.getChainId() !== 4217) throw Error('Seller RPC must be Tempo mainnet')
const tempoMethods = new Map(['pull', 'push'].map(mode => [mode, Mppx.create({ secretKey: state.secret, methods: [tempo.charge({ chainId: 4217, currency: tempoTokens.usdcMainnet, decimals: 6, recipient: evm[0]!, supportedModes: [mode as 'pull' | 'push'], getClient: () => rpc })] })]))
tempoMethods.set('sponsored', Mppx.create({ secretKey: state.secret, methods: [tempo.charge({ chainId: 4217, currency: tempoTokens.usdcMainnet, decimals: 6, recipient: evm[0]!, supportedModes: ['pull'], feeToken: tempoTokens.usdcMainnet, feePayer: privateKeyToAccount(state.evm[0]!), getClient: () => rpc })] }))
const solanaMethods = new Map([
  { path: '/solana-usdc-split', asset: 'USDC', sponsored: false, amount: '1000' },
  { path: '/solana-sol', asset: 'SOL', sponsored: false, amount: '1000000' },
  { path: '/solana-usdc-sponsored-split', asset: 'USDC', sponsored: true, amount: '1000' },
  { path: '/solana-sol-sponsored', asset: 'SOL', sponsored: true, amount: '1000000' },
].map(({ path, asset, sponsored, amount }) => [path, { amount, method: SolanaMppx.create({ secretKey: state.secret, methods: [solana.charge({ network: 'mainnet-beta', rpcUrl: process.env[solanaNetwork.rpcEnv] ?? solanaNetwork.rpcUrl, recipient: svm[0]!, currency: asset === 'SOL' ? 'sol' : solanaNetwork.assets.find(asset => asset.symbol === 'USDC')!.id.slice(4), ...(asset === 'USDC' ? { decimals: 6, splits: [{ recipient: svm[1]!, amount: '100', memo: 'hosted-privy-e2e' }, { recipient: svm[1]!, amount: '150' }] } : {}), ...(sponsored ? { signer: solanaKeys[0]! } : {}) })] }) }]))
const counts: Record<string, { requests: number; paid: number; hashes: string[] }> = {}
// SDK errors can include signed credentials/RPC URLs. Never dump those objects.
console.error = (...values: unknown[]) => console.log(JSON.stringify({ event: 'seller-sdk-error', causes: safeErrorDetails(values.find(value => value instanceof Error)) }))
Bun.serve({ hostname: '127.0.0.1', port: 19042, async fetch(request) {
  const route = new URL(request.url).pathname
  if (route === '/health' && request.method === 'GET') return Response.json({ scope: 'mainnet seller fixture; payer must use real hosted Privy', recipients: { tempo: evm, solana: svm }, counts })
  const svmMethod = solanaMethods.get(route)
  if (!svmMethod && !['/tempo-pull', '/tempo-push', '/tempo-sponsored'].includes(route)) return new Response('Not found', { status: 404 })
  const count = counts[route] ??= { requests: 0, paid: 0, hashes: [] }
  count.requests++
  if (request.method !== 'POST' || await request.clone().text() !== '{"purpose":"agentis-hosted-privy-e2e"}') return new Response('Expected exact fixture POST body', { status: 400 })
  try {
    const expires = new Date(Date.now() + 540_000).toISOString()
    const result = svmMethod
      ? await svmMethod.method.charge({ amount: svmMethod.amount, expires })(request)
      : await tempoMethods.get(route.slice('/tempo-'.length))!.charge({ amount: '0.001', expires, splits: [{ recipient: evm[1]!, amount: '0.0001', memo: `0x${'ab'.repeat(32)}` }, { recipient: evm[1]!, amount: '0.00015' }] })(request)
    if (result.status === 402) return result.challenge
    const response = result.withReceipt(Response.json({ result: 'hosted-privy-mainnet-e2e', route, bodyPreserved: true }))
    const receipt = response.headers.get('payment-receipt')
    if (receipt) count.hashes.push(Receipt.deserialize(receipt).reference)
    count.paid++
    console.log(JSON.stringify({ event: 'paid', route, hash: count.hashes.at(-1) }))
    return response
  } catch (error) {
    console.log(JSON.stringify({ event: 'seller-error', route, errorType: error instanceof Error ? error.name : 'Unknown' }))
    return new Response('Seller verification failed; inspect chain evidence before retrying', { status: 500 })
  }
} })
console.log(JSON.stringify({ origin: 'http://127.0.0.1:19042', scope: 'real mainnet settlement; no Agentis payer key or approval authority in this process' }))
