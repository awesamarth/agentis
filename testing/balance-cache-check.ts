// Offline regression check: every Portfolio/RPC request is intercepted.
import assert from 'node:assert/strict'
import { encodeAbiParameters } from 'viem'
import { agentBalance, agentBalances } from '../apps/backend/src/modules/balances'
import { DISPLAY_CACHE_MS } from '../apps/backend/src/modules/display-prices'
import type { WalletRow } from '../apps/backend/src/db/schema'

const originalFetch = globalThis.fetch
const originalNow = Date.now
const originalEnv = { ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY, BASE_RPC_URL: process.env.BASE_RPC_URL }
process.env.ALCHEMY_API_KEY = 'offline-fixture'
process.env.BASE_RPC_URL = 'https://base-rpc.invalid'
let now = originalNow()
Date.now = () => now
let portfolioCalls = 0, rpcCalls = 0
let mode: 'portfolio' | 'rpc' | 'unavailable' = 'portfolio'
let signalStarted!: () => void, releasePortfolio!: () => void
const started = new Promise<void>(resolve => { signalStarted = resolve })
const released = new Promise<void>(resolve => { releasePortfolio = resolve })
const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const wallet = (suffix: string): WalletRow => ({ id: `fixture-${suffix}`, enabled: true, chainId: 'eip155:8453', address: `0x${suffix.padStart(40, '0')}` }) as WalletRow
const a = wallet('1'), b = wallet('2')

globalThis.fetch = (async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.hostname === 'api.g.alchemy.com') {
    portfolioCalls++
    if (mode !== 'portfolio') return new Response('Fixture unavailable', { status: 503 })
    if (portfolioCalls === 1) { signalStarted(); await released }
    const body = await request.json() as { addresses: { address: string; networks: string[] }[] }
    assert(body.addresses.length <= 3)
    return Response.json({ data: { tokens: body.addresses.flatMap(({ address, networks }) => networks.flatMap(network => [
      { address, network, tokenAddress: null, tokenBalance: '0' },
      { address, network, tokenAddress: usdc, tokenBalance: '1000000' },
    ])) } })
  }
  if (url.hostname === 'base-rpc.invalid') {
    rpcCalls++
    const rpc = await request.json() as { id: number; method: string }
    assert.equal(rpc.method, 'eth_call', 'Display must not sign or submit')
    if (mode === 'unavailable') return Response.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'Offline fixture rejects this read' } })
    const zero = encodeAbiParameters([{ type: 'uint256' }], [0n])
    const result = encodeAbiParameters([{ type: 'tuple[]', components: [{ name: 'success', type: 'bool' }, { name: 'returnData', type: 'bytes' }] }], [[{ success: true, returnData: zero }, { success: true, returnData: zero }]])
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result })
  }
  throw Error('Unexpected network request in offline balance check')
}) as typeof fetch

try {
  const ownerRequest = agentBalances([{ id: 'a', wallets: [a] }, { id: 'b', wallets: [b] }])
  await started
  const singleRequest = agentBalance([a])
  const overlappingRequest = agentBalances([{ id: 'different-scope-name', wallets: [a] }])
  releasePortfolio()
  const [owner, single, overlapping] = await Promise.all([ownerRequest, singleRequest, overlappingRequest])
  assert.equal(portfolioCalls, 1, 'Overlapping scopes must share in-flight Portfolio work')
  assert.equal(rpcCalls, 0)
  assert.deepEqual(single, owner.a)
  assert.deepEqual(overlapping['different-scope-name'], owner.a)
  assert.equal(owner.a!.usdMicros, '1000000')
  assert.equal(owner.a!.complete, true)
  await agentBalance([a])
  assert.equal(portfolioCalls, 1, 'Completed results must stay cached')

  const hidden = await agentBalance([{ ...a, enabled: false }])
  assert.deepEqual(hidden!.networks, [])
  assert.equal(portfolioCalls, 1, 'Disabled selections must not read or reuse a visible balance')

  now += DISPLAY_CACHE_MS + 1
  await agentBalance([a])
  assert.equal(portfolioCalls, 2, 'Expired results must refresh')

  mode = 'rpc'
  const zeroBalance = await agentBalance([wallet('3')])
  assert.equal(rpcCalls, 1, 'Native and token reads must share one multicall promise')
  assert.equal(zeroBalance!.usdMicros, '0')
  assert.equal(zeroBalance!.complete, true)

  mode = 'unavailable'
  const missing = await agentBalance([wallet('4')])
  assert.equal(missing!.usdMicros, null, 'Unavailable reads must not turn into zero balances')
  assert.equal(missing!.complete, false)
  assert(missing!.networks[0]!.tokens.every(token => token.amountAtomic === null))

  mode = 'rpc'
  now += DISPLAY_CACHE_MS + 1
  const recovered = await agentBalance([wallet('4')])
  assert.equal(recovered!.complete, true, 'Failed reads must remain retryable after cache expiry')
  console.log('Balance cache checks passed: overlapping scopes, Portfolio batching, TTL, disabled wallets, single multicall, missing values and recovery. No external requests.')
} finally {
  releasePortfolio()
  globalThis.fetch = originalFetch
  Date.now = originalNow
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
