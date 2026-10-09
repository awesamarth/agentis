// Standalone isolated module mocks. Fake RPC + disposable signer; NEVER submits.
import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, encodeEventTopics, erc20Abi, encodeFunctionData, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempo } from 'viem/chains'
import { Abis } from 'viem/tempo'
import { TxEnvelopeTempo, Transaction as TempoTransaction } from 'ox/tempo'
import { Signature } from 'ox'
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
let settlementRpc: any
let deliverPayment: (...args: any[]) => Promise<any> = async () => { throw Error('Unexpected paid HTTP request') }
mock.module('../apps/backend/src/modules/payment-http', () => ({ paymentHttp: (...args: any[]) => deliverPayment(...args) }))
let candidate: any, signatures = 0, fundsChecks = 0, changeSignature = false, requestedMethod = 'transaction'
mock.module('@agentis-hq/core/tempo', () => ({ ...shared, checkTempoFunds: async () => { fundsChecks++ } }))
const networks = await import('../apps/backend/src/modules/networks')
mock.module('../apps/backend/src/modules/networks', () => ({ ...networks, evmClient: () => settlementRpc ?? ({ getChainId: async () => 4217, getBlockNumber: async () => 1n, transport: { url: 'http://127.0.0.1:1' } }) }))
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
const privy = { wallets: () => ({ ethereum: () => ({ signSecp256k1: async (_id: string, { params: { hash } }: any) => { signatures++; return { signature: await native.sign({ hash }) } }, signTransaction: async (_id: string, { params: { transaction: tx } }: any) => {
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
        assert.equal(request.params[0].feeToken.toLowerCase(), input.mpp?.sponsored ? tempoTokens.OUSD : tempoTokens.pathUSD)
        result = '0x186a0'; break
      default: throw Error(`Unexpected fixture RPC method: ${request.method}`)
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result })
  }) as typeof fetch
  const actual = await prepare()
  assert.match(actual.transactionHash, /^0x[0-9a-f]{64}$/)
  assert.equal(signatures, 3)
  assert(methods.includes('eth_estimateGas'))
  const selfPaidSigned = JSON.parse(actual.signedTransaction.slice(4)).signed
  const selfPaidTx = TxEnvelopeTempo.deserialize(selfPaidSigned)
  const selfPaidHash = TxEnvelopeTempo.hash(selfPaidTx as never)
  const selfPaidRpc = { ...TempoTransaction.toRpc(selfPaidTx as never), nonceKey: `0x${selfPaidTx.nonceKey!.toString(16)}`, feePayerSignature: null }
  assert.equal(shared.verifyTempoSettlementTransaction(selfPaidRpc, selfPaidSigned, selfPaidHash).sponsor, undefined, 'RPC null denotes no sponsor, not a request for sponsorship')
  // Installed SDK split construction: total is 1000, primary 750, secondary 250.
  const splitRecipient = '0x0000000000000000000000000000000000000033'
  input.mpp!.splits = [{ to: splitRecipient, amountAtomic: '250' }]
  input.mpp!.challenge = Challenge.serialize(Challenge.from({ id: 'split-fixture', realm: 'example.com', method: 'tempo', intent: 'charge', expires: expiresAt, request: { amount: '1000', currency: tempoTokens.OUSD, recipient, methodDetails: { chainId: 4217, memo, splits: [{ recipient: splitRecipient, amount: '250' }] } } }))
  const splitResult = await prepare()
  const splitTx = TxEnvelopeTempo.deserialize(JSON.parse(splitResult.signedTransaction.slice(4)).signed)
  assert.equal(splitTx.calls.length, 2)
  shared.assertTempoPaymentCalls(splitTx.calls, input, [memo, undefined])
  const signedCount = signatures
  useRealClient = false
  candidate = { ...valid(), calls: [...splitTx.calls.slice(0, 1), { ...splitTx.calls[1], data: encodeFunctionData({ abi: Abis.tip20, functionName: 'transfer', args: [recipient, 250n] }) }] }
  await assert.rejects(prepare(), /differs from approval/)
  assert.equal(signatures, signedCount, 'An altered split must never reach custody')
  useRealClient = true
  // Actual installed SDK sponsorship path. No sender gas balance is required.
  input.mpp!.sponsored = true
  input.mpp!.challenge = Challenge.serialize(Challenge.from({ id: 'sponsor-fixture', realm: 'example.com', method: 'tempo', intent: 'charge', expires: expiresAt, request: { amount: '1000', currency: tempoTokens.OUSD, recipient, methodDetails: { chainId: 4217, memo, feePayer: true, splits: [{ recipient: splitRecipient, amount: '250' }] } } }))
  input.maxFeeAtomic = '0'
  const sponsored = await prepare()
  assert.equal(sponsored.transactionHash, null, 'Sponsor has not supplied the final transaction hash yet')
  const saved = JSON.parse(sponsored.signedTransaction.slice(4))
  const partial = TxEnvelopeTempo.deserialize(saved.signed)
  assert.equal(partial.feePayerSignature, null)
  const sponsor = privateKeyToAccount(`0x${'22'.repeat(32)}`)
  const completed = { ...partial, feeToken: tempoTokens.OUSD }
  completed.feePayerSignature = Signature.fromHex(await sponsor.sign({ hash: TxEnvelopeTempo.getFeePayerSignPayload(completed, { sender: native.address }) }))
  const finalHash = TxEnvelopeTempo.hash(completed as any)
  const raw = TempoTransaction.toRpc({ ...completed, type: 'tempo', from: native.address, hash: finalHash, blockNumber: 1n, blockHash: `0x${'33'.repeat(32)}`, transactionIndex: 0 } as any)
  // ox.toRpc omits nonceKey; actual Tempo RPC responses include it.
  ;(raw as any).nonceKey = `0x${partial.nonceKey!.toString(16)}`
  const verified = shared.verifyTempoSettlementTransaction(raw as any, saved.signed, finalHash)
  assert.equal(verified.sender.toLowerCase(), native.address.toLowerCase())
  assert.equal(verified.sponsor!.toLowerCase(), sponsor.address.toLowerCase())
  assert.throws(() => shared.verifyTempoSettlementTransaction({ ...raw, nonce: '0x1' } as any, saved.signed, finalHash), /differs/)
  const logBase = { address: tempoTokens.OUSD, blockNumber: '0x1', blockHash: raw.blockHash, transactionHash: finalHash, transactionIndex: '0x0', logIndex: '0x0', removed: false }
  const memoLog = { ...logBase, topics: encodeEventTopics({ abi: Abis.tip20, eventName: 'TransferWithMemo', args: { from: native.address, to: recipient, memo } }), data: encodeAbiParameters([{ type: 'uint256' }], [750n]) }
  const transferLog = { ...logBase, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: native.address, to: recipient } }), data: memoLog.data }
  const splitLog = { ...logBase, logIndex: '0x1', topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: native.address, to: splitRecipient } }), data: encodeAbiParameters([{ type: 'uint256' }], [250n]) }
  const settlementClient = createPublicClient({ chain: tempo, transport: custom({ async request({ method }: any) {
    if (method === 'eth_chainId') return '0x1079'
    if (method === 'eth_getLogs') return [memoLog]
    if (method === 'eth_getTransactionByHash') return raw
    if (method === 'eth_getTransactionReceipt') return { ...logBase, from: native.address, to: tempoTokens.OUSD, status: '0x1', type: '0x76', gasUsed: '0x186a0', effectiveGasPrice: '0x23c34600', cumulativeGasUsed: '0x186a0', logs: [transferLog, splitLog], logsBloom: `0x${'00'.repeat(256)}`, contractAddress: null }
    throw Error('Unexpected RPC: ' + method)
  } }) })
  const recovered = await shared.reconcileTempoPayment(settlementClient, input, saved.signed, null, saved.fromBlock)
  assert.equal(recovered?.transactionHash, finalHash, 'Lost HTTP response recovers the sponsored final hash, without a resend')
  assert.equal(recovered?.feeAtomic, '0', 'Sponsor fees never debit the agent budget')
  // Push preparation must not broadcast; the shared helper submits only saved bytes.
  input.mpp!.mode = 'push'; input.mpp!.sponsored = false; input.maxFeeAtomic = '10000000000000000'
  input.mpp!.challenge = Challenge.serialize(Challenge.from({ id: 'push-fixture', realm: 'example.com', method: 'tempo', intent: 'charge', expires: expiresAt, request: { amount: '1000', currency: tempoTokens.OUSD, recipient, methodDetails: { chainId: 4217, supportedModes: ['push'], splits: [{ recipient: splitRecipient, amount: '250' }] } } }))
  const pushed = await prepare()
  assert(!methods.some(method => method.startsWith('eth_send')), 'Preparation must never submit')
  const pushSignatures = signatures
  input.maxFeeAtomic = '1'
  await assert.rejects(prepare(), /gas exceeds approval/)
  assert.equal(signatures, pushSignatures, 'Over-cap push must not reach custody')
  input.maxFeeAtomic = '10000000000000000'
  const pushProof = JSON.parse(pushed.signedTransaction.slice(4)), pushTx = TxEnvelopeTempo.deserialize(pushProof.signed)
  const hashCredential = Credential.deserialize<{ type: string; hash: string }>(pushProof.credential)
  assert.equal(hashCredential.payload.type, 'hash'); assert.equal(hashCredential.payload.hash, pushed.transactionHash)
  const pushRaw = { ...TempoTransaction.toRpc({ ...pushTx, from: native.address, hash: pushed.transactionHash } as any), nonceKey: `0x${pushTx.nonceKey!.toString(16)}`, feePayerSignature: null }
  let persisted = '', sends = 0, deliveries = 0, outcome = 'success', confirmed = false
  settlementRpc = createPublicClient({ chain: tempo, transport: custom({ async request({ method, params }: any) {
    if (method === 'eth_chainId') return '0x1079'
    if (method === 'eth_sendRawTransaction') {
      assert.equal(persisted, pushed.signedTransaction, 'Persist before broadcast')
      assert.equal(params[0], pushProof.signed); sends++
      if (outcome === 'lost-rpc') throw Error('RPC response lost after accepting transaction')
      return pushed.transactionHash
    }
    if (method === 'eth_getTransactionByHash') return pushRaw
    if (method === 'eth_getTransactionReceipt') {
      confirmed = outcome !== 'reverted'
      return { ...logBase, transactionHash: pushed.transactionHash, from: native.address, to: tempoTokens.OUSD, status: confirmed ? '0x1' : '0x0', type: '0x76', gasUsed: '0x186a0', effectiveGasPrice: '0x23c34600', cumulativeGasUsed: '0x186a0', logs: confirmed ? [transferLog, splitLog] : [], logsBloom: `0x${'00'.repeat(256)}`, contractAddress: null }
    }
    throw Error('Unexpected push RPC: ' + method)
  } }) })
  deliverPayment = async (_request, headers) => {
    assert(confirmed, 'Confirm before delivering hash'); deliveries++
    assert.equal(Credential.deserialize<{ type: string; hash: string }>(headers.Authorization).payload.hash, pushed.transactionHash)
    if (outcome === 'lost-http') throw Error('HTTP response lost')
    return { status: 200, headers: {}, bodyBase64: Buffer.from('paid result').toString('base64') }
  }
  persisted = pushed.signedTransaction
  assert.equal((await engine.broadcast(persisted)).status, 200)
  assert.equal(sends, 1); assert.equal(deliveries, 1)
  for (const failure of ['lost-rpc', 'reverted', 'lost-http']) {
    outcome = failure; sends = 0; deliveries = 0; confirmed = false
    await assert.rejects(engine.broadcast(persisted))
    assert.equal(sends, 1, 'No transport retry')
    assert.equal(deliveries, failure === 'lost-http' ? 1 : 0)
    const recoveredPush = await engine.receipt(persisted, input, pushed.transactionHash)
    assert.equal(recoveredPush?.success, failure !== 'reverted')
    assert.equal(recoveredPush?.feeAtomic, '60000000000000')
    assert.equal(sends, 1, 'Receipt recovery never rebroadcasts')
  }
  console.log('Tempo push checks passed: saved proof before RPC, confirmed hash before HTTP, lost RPC/body recovery, reverted payment withholding, no automatic resend. Fake custody/RPC only.')
  console.log('Tempo signing checks passed: installed MPP client, sponsored/unsponsored signing guards, exact split guards, verified final sponsor hash, lost-response recovery and zero agent gas accounting. Fake signer/RPC only; no funds.')
} finally { globalThis.fetch = originalFetch }
