// Standalone isolated module mocks. Fake RPC + disposable signer; NEVER submits.
import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { encodeFunctionData, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempo } from 'viem/chains'
import { Abis } from 'viem/tempo'
import { Challenge, Credential } from 'mppx'
import type { PrivyClient } from '@privy-io/node'
import type { WalletRow } from '../apps/backend/src/db/schema'
import type { OperationInput } from '../packages/core/src/operations'

const shared = await import('@agentis-hq/core/tempo')
const { tempoTokens } = await import('@agentis-hq/core/networks')
const native = privateKeyToAccount(`0x${'11'.repeat(32)}`), recipient = '0x0000000000000000000000000000000000000022'
const clientModule = Bun.resolveSync('mppx/client', new URL('../apps/backend/src/modules/', import.meta.url).pathname)
const realCharge = (await import(clientModule)).tempo.charge
let useRealClient = false
let candidate: any, signatures = 0, fundsChecks = 0, changeSignature = false, requestedMethod = 'transaction'
mock.module('@agentis-hq/core/tempo', () => ({ ...shared, checkTempoFunds: async () => { fundsChecks++ } }))
const networks = await import('../apps/backend/src/modules/networks')
mock.module('../apps/backend/src/modules/networks', () => ({ ...networks, evmClient: () => ({ getChainId: async () => 4217, transport: { url: 'http://127.0.0.1:1' } }) }))
mock.module(clientModule, () => ({ tempo: { charge: (options: any) => {
  const { account, autoSwap, mode } = options
  assert.equal(autoSwap, false); assert.equal(mode, 'pull')
  if (useRealClient) return realCharge(options)
  return { createCredential: async ({ challenge }: any) => {
    if (requestedMethod === 'authorization') return account.signAuthorization({})
    const signed = await account.signTransaction(candidate)
    return Credential.serialize({ challenge, payload: { type: 'transaction', signature: signed } })
  } }
} } }))
const { createPrivyMpp } = await import('../apps/backend/src/modules/mpp')
const privy = { wallets: () => ({ ethereum: () => ({ signTransaction: async (_id: string, { params: { transaction: tx } }: any) => {
  signatures++
  const unsigned: any = { type: 'tempo', chainId: tx.chain_id, calls: tx.calls.map((call: any) => ({ to: call.to, data: call.data, value: BigInt(call.value ?? 0) })), feeToken: changeSignature ? tempoTokens.OUSD : tx.fee_token, nonceKey: BigInt(tx.nonce_key), nonce: Number(BigInt(tx.nonce)), validBefore: Number(BigInt(tx.valid_before)), validAfter: Number(BigInt(tx.valid_after ?? 0)), gas: BigInt(tx.gas_limit), maxFeePerGas: BigInt(tx.max_fee_per_gas), maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas) }
  return { signed_transaction: await native.signTransaction(unsigned, { serializer: tempo.serializers.transaction }) }
} }) }) } as unknown as PrivyClient
const engine = createPrivyMpp(privy, 'fixture-authorization-not-a-real-key', async () => ({ address: native.address, serverAuthorized: true }))
const wallet = { chainId: 'eip155:4217', address: native.address, providerWalletId: 'fixture', ownerId: 'fixture' } as WalletRow
const memo = `0x${'ab'.repeat(32)}` as Hex
const expiresAt = new Date(Date.now() + 120_000).toISOString()
const challenge = Challenge.serialize(Challenge.from({ id: 'fixture', realm: 'example.com', method: 'tempo', intent: 'charge', expires: expiresAt, request: { amount: '1000', currency: tempoTokens.OUSD, recipient, methodDetails: { chainId: 4217, memo } } }))
const input: OperationInput = { walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', chainId: wallet.chainId, action: 'paid_fetch', asset: `erc20:${tempoTokens.OUSD}`, feeAsset: `erc20:${tempoTokens.pathUSD}`, to: recipient, amountAtomic: '1000', maxFeeAtomic: '10000000000000000', mpp: { url: 'https://example.com/paid', challenge, expiresAt, maxAmountAtomic: '1000' } }
const valid = () => ({ type: 'tempo', chainId: 4217, calls: [{ to: tempoTokens.OUSD, value: 0n, data: encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [recipient, 1000n, memo] }) }], feeToken: tempoTokens.pathUSD, nonceKey: (1n << 256n) - 1n, nonce: 0, validBefore: Math.floor(Date.now() / 1000) + 25, validAfter: 0, gas: 100000n, maxFeePerGas: 600000000n, maxPriorityFeePerGas: 0n })
const prepare = () => engine.prepare(wallet, input, { id: 'fixture', expiresAt: new Date(expiresAt) })
// Any accidental transport call is a test failure; private endpoints cannot be contacted.
const originalFetch = globalThis.fetch
globalThis.fetch = (() => { throw Error('External HTTP forbidden in signing fixture') }) as typeof fetch
try {
  candidate = valid()
  const result = await prepare()
  assert.match(result.transactionHash, /^0x[0-9a-f]{64}$/)
  assert(result.signedTransaction.startsWith('mpp:'))
  assert.equal(signatures, 1); assert.equal(fundsChecks, 1)
  for (const patch of [
    { feeToken: tempoTokens.OUSD }, { chainId: 42431 }, { nonceKey: 0n },
    { gas: 1000000000n }, { validBefore: Math.floor(Date.now() / 1000) - 1 },
    { calls: [...valid().calls, ...valid().calls] },
    { calls: [{ ...valid().calls[0], to: tempoTokens.pathUSD }] },
    { calls: [{ ...valid().calls[0], data: encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [recipient, 1001n, memo] }) }] },
    { calls: [{ ...valid().calls[0], data: encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [recipient, 1000n, `0x${'cd'.repeat(32)}`] }) }] },
  ]) {
    candidate = { ...valid(), ...patch }
    await assert.rejects(prepare())
    assert.equal(signatures, 1, 'Out-of-approval request must never reach signer')
  }
  candidate = valid(); requestedMethod = 'authorization'
  await assert.rejects(prepare()); assert.equal(signatures, 1)
  requestedMethod = 'transaction'; changeSignature = true
  await assert.rejects(prepare(), /differs from approval/)
  assert.equal(signatures, 2)
  // Exercise the installed MPP client's actual preparation path, not only the guard.
  useRealClient = true; changeSignature = false
  const methods: string[] = []
  globalThis.fetch = (async (url: any, options: any) => {
    assert.equal(new URL(String(url)).origin, 'http://127.0.0.1:1')
    const request = JSON.parse(options.body); methods.push(request.method)
    let result: unknown
    switch (request.method) {
      case 'eth_chainId': result = '0x1079'; break
      case 'eth_getTransactionCount': result = '0x0'; break
      case 'eth_gasPrice': result = '0x23c34600'; break
      case 'eth_maxPriorityFeePerGas': result = '0x0'; break
      case 'eth_getBlockByNumber': result = { number: '0x1', timestamp: `0x${Math.floor(Date.now()/1000).toString(16)}`, baseFeePerGas: '0x23c34600', gasLimit: '0x1dcd6500', gasUsed: '0x0', transactions: [], hash: `0x${'11'.repeat(32)}`, parentHash: `0x${'22'.repeat(32)}` }; break
      case 'eth_estimateGas':
        assert.equal(request.params[0].feeToken.toLowerCase(), tempoTokens.pathUSD)
        result = '0x186a0'; break
      default: throw Error(`Unexpected fixture RPC method: ${request.method}`)
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result })
  }) as typeof fetch
  const actual = await prepare()
  assert.match(actual.transactionHash, /^0x[0-9a-f]{64}$/)
  assert.equal(signatures, 3)
  assert(methods.includes('eth_estimateGas'))
  console.log('Tempo signing checks passed (including installed MPP client preparation): exact independent payment/fee tokens, chain, amount, memo, expiry, nonce lane, gas, call count, delegation refusal and signed-envelope verification. Fake signer only; no network or funds.')
} finally { globalThis.fetch = originalFetch }
