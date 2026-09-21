// Dedicated local Postgres, isolated schema, fake signer/chain. No Privy calls or real money.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, and } from 'drizzle-orm'
import { parseUnits, decodeFunctionData, parseAbi, erc20Abi } from 'viem'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createAgentisMcpServer } from '../packages/mcp/src/server'
import { supportedNetworks } from '../apps/backend/src/modules/networks'
import { AgentisClient } from '../packages/sdk/src/client'
import { createApp } from '../apps/backend/src/app'
import { OperationService, hash } from '../apps/backend/src/operations'
import * as tables from '../apps/backend/src/db/schema'
import { uniswap, uniswapCall } from '../apps/backend/src/plugins/uniswap/swap'
import type { Executor } from '../apps/backend/src/providers/types'
import type { OperationInput } from '@agentis-hq/core/operations'
const url = process.env.DATABASE_URL!, location = new URL(url)
assert(['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '55432')
const admin = postgres(url, { max: 1 }), name = `uniswap_check_${randomBytes(6).toString('hex')}`
await admin.unsafe(`CREATE SCHEMA ${name}`)
for (const table of ['agents', 'wallets', 'grants', 'operations', 'onboarding', 'uniswap_plans', 'uniswap_schedules', 'uniswap_setup_requests', 'uniswap_targets']) await admin.unsafe(`CREATE TABLE ${name}.${table} (LIKE public.${table} INCLUDING ALL)`)
const sql = postgres(url, { max: 8, connection: { search_path: name } }), db = drizzle(sql, { schema: tables })
const owner = 'fixture-owner', agentId = crypto.randomUUID(), walletId = crypto.randomUUID(), otherAgent = crypto.randomUUID(), address = '0x0000000000000000000000000000000000000011'
const signed = new Map<string, OperationInput>()
let signingCalls = 0, allowance = 0n, balance = 500000n
let app: ReturnType<typeof createApp>
const http = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  if (new URL(request.url).pathname === '/rpc') {
    const body = await request.json() as { id: number; method: string; params?: { data?: string }[] }
    const value = body.method === 'eth_chainId' ? '0x14a34' : body.method === 'eth_getBalance' ? '0xde0b6b3a7640000' : '0x' + (body.params?.[0]?.data?.startsWith('0xdd62ed3e') ? allowance : balance).toString(16).padStart(64, '0')
    return Response.json({ jsonrpc: '2.0', id: body.id, result: value })
  }
  if (new URL(request.url).pathname === '/paid') return new Response('', { status: 402, headers: { 'payment-required': Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: `${base}/paid`, description: 'Fixture', mimeType: 'application/json' }, accepts: [{ scheme: 'exact', network: uniswap.chainId, asset: uniswap.USDC, amount: '1000000', payTo: '0x0000000000000000000000000000000000000022', maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' } }] })).toString('base64') } })
  return app.fetch(request)
} })
const base = `http://127.0.0.1:${http.port}`
const prior = { rpc: process.env.BASE_SEPOLIA_RPC_URL, issuer: process.env.AGENTIS_PUBLIC_API_URL, local: process.env.AGENTIS_PAID_FETCH_LOCAL_ORIGINS }
process.env.BASE_SEPOLIA_RPC_URL = `${base}/rpc`; process.env.AGENTIS_PUBLIC_API_URL = base; process.env.AGENTIS_PAID_FETCH_LOCAL_ORIGINS = base
const executor: Executor = {
  id: 'privy', validate(wallet, input) { if (input.swap) uniswapCall(input, wallet.address) },
  async prepare(_wallet, input, _auth, context) { signingCalls++; const id = `0x${hash(context!.id)}`; signed.set(id, input); return { transactionHash: id, signedTransaction: 'fixture-not-real-signed-bytes' } },
  async broadcast() {},
  async receipt(id) {
    const input = signed.get(id!)!
    if (input.action === 'uniswap_approval') allowance = BigInt(input.amountAtomic)
    const actual = input.swap?.exactOutput ? BigInt(input.amountAtomic) * 10000n / 10050n : BigInt(input.amountAtomic)
    if (input.action === 'uniswap_swap' && input.swap?.tokenOut === 'USDC') balance += BigInt(input.swap.minimumOutputAtomic)
    if (input.action === 'paid_fetch') balance -= BigInt(input.amountAtomic)
    return { transactionHash: id!, chainId: uniswap.chainId, blockNumber: '1', feeAtomic: '1000', success: true, ...(input.action === 'uniswap_swap' ? { swap: { inputAtomic: actual.toString(), outputAtomic: input.swap!.minimumOutputAtomic, tokenOut: input.swap!.tokenOut } } : {}) }
  },
}
const service = new OperationService(db, executor, {}, 'http://localhost:3000', async input => ({ assetPrice: (input.asset === 'native' ? 2000n * 10n ** 18n : 10n ** 18n).toString(), feePrice: (2000n * 10n ** 18n).toString(), assetDecimals: input.asset === 'native' ? 18 : 6, feeDecimals: 18, expiresAt: Date.now() + 60000 }))
service.uniswap.quoteSource = async request => {
  const exactOutput = request.type === 'EXACT_OUTPUT', amount = parseUnits(request.amount, (exactOutput ? request.tokenOut : request.tokenIn) === 'ETH' ? 18 : 6)
  const input = exactOutput ? (request.tokenIn === 'ETH' ? amount * 10n ** 12n / 2000n : amount * 2000n / 10n ** 12n) : amount
  const output = exactOutput ? amount : request.tokenOut === 'USDC' ? amount * 2000n / 10n ** 12n : amount * 10n ** 12n / 2000n
  return { protocol: 'Uniswap V3', chainId: uniswap.chainId, router: uniswap.router, pool: '0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0', fee: 500, tokenIn: request.tokenIn, tokenOut: request.tokenOut, inputAtomic: input.toString(), outputAtomic: output.toString(), maximumInputAtomic: (exactOutput ? input * 10050n / 10000n : input).toString(), minimumOutputAtomic: output.toString(), maxFeeAtomic: parseUnits(request.maxFee, 18).toString(), expiresAt: new Date(Date.now() + 600000).toISOString() }
}
app = createApp(service, { authenticate: async token => { if (token !== 'fixture-owner') throw Error('Denied'); return owner } }, ['http://localhost:3000'])
const api = new AgentisClient({ baseUrl: base, token: 'fixture-owner' })
const principal = { kind: 'owner' as const, ownerId: owner }
const limits = { perTransaction: '10000000', hourly: '100000000', daily: '100000000', total: '100000000' }
const policy = { mode: 'ask' as const, budgetMode: 'usd' as const, maxPerOperationAtomic: '0', maxDailyAtomic: '0', maxLifetimeAtomic: '0', allowedRecipients: [] }
const input = { walletId, tokenIn: 'ETH' as const, tokenOut: 'USDC' as const, amount: '0.001' }
try {
  await db.insert(tables.agents).values([{ id: agentId, ownerId: owner, name: 'Fixture', limits, mode: 'ask', allowedRecipients: [], networks: ['base'], defaultNetwork: 'base' }, { id: otherAgent, ownerId: 'other', name: 'Other', limits, mode: 'ask', allowedRecipients: [], networks: ['base'], defaultNetwork: 'base' }])
  await db.insert(tables.wallets).values({ id: walletId, ownerId: owner, agentId, provider: 'privy', providerWalletId: 'not-a-privy-wallet', address, chainId: uniswap.chainId, serverAuthorized: true, policy })
  await assert.rejects(api.uniswap.quote(input), /Enable Uniswap/)
  await api.agents.setPlugins(agentId, ['uniswap'])
  const key = await api.grants.create({ agentId, agentName: 'Fixture executor' }), agent = new AgentisClient({ baseUrl: base, token: key.token })
  await assert.rejects(agent.uniswap.dca.create({ id: crypto.randomUUID(), request: input, intervalMinutes: 5, confirm: true }), /owner confirmation/)
  const mcpServer = createAgentisMcpServer({ delegations: [{ agentId, name: 'Fixture', plugins: ['uniswap'], client: agent }], networks: supportedNetworks })
  const mcp = new Client({ name: 'uniswap-fixture', version: '1' }), [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await mcpServer.connect(serverTransport); await mcp.connect(clientTransport)
  try {
    assert.equal((await mcp.listTools()).tools.length, 18)
    assert(!(await mcp.callTool({ name: 'agentis_swap_quote', arguments: input })).isError)
    assert((await mcp.callTool({ name: 'agentis_swap_quote', arguments: { ...input, walletId: crypto.randomUUID() } })).isError)
  } finally { await mcp.close(); await mcpServer.close() }
  await agent.uniswap.saveTarget(walletId, 35)
  assert.equal((await agent.uniswap.target(walletId)).ethPercent, 35)
  const [a, b] = await Promise.all([agent.uniswap.swap(input, { idempotencyKey: 'same' }), agent.uniswap.swap(input, { idempotencyKey: 'same' })])
  assert.equal(a.id, b.id); assert.equal(a.operations.length, 1); assert.equal(a.operations[0]!.status, 'pending_approval'); assert(a.approvalUrl)
  await assert.rejects(agent.uniswap.swap({ ...input, amount: '0.002' }, { idempotencyKey: 'same' }), /different swap terms/)
  const rawSwap = (await db.select().from(tables.operations).where(eq(tables.operations.id, a.operations[0]!.id)))[0]!.input
  await assert.rejects(api.operations.create(rawSwap, { idempotencyKey: 'raw' }))
  const call = uniswapCall(a.operations[0]!, address)
  const decoded = decodeFunctionData({ abi: parseAbi(['function multicall(uint256 deadline,bytes[] data) payable returns (bytes[])']), data: call.data })
  assert.equal(call.to, uniswap.router); assert.equal(call.value, parseUnits('0.001', 18)); assert.equal(decoded.args[1].length, 2)
  assert.throws(() => uniswapCall({ ...a.operations[0]!, to: '0x0000000000000000000000000000000000000099' }, address))
  await api.operations.approve(a.operations[0]!.id, a.operations[0]!.operationHash)
  await api.agents.setPlugins(agentId, [])
  await service.tick(); assert.equal(signingCalls, 0); assert.equal((await api.operations.get(a.operations[0]!.id)).status, 'denied')
  await api.agents.setPlugins(agentId, ['uniswap'])
  const setup = await agent.uniswap.dca.requestSetup({ action: 'create', input: { request: input, intervalMinutes: 5, confirm: true } })
  await assert.rejects(agent.uniswap.dca.completeSetup(setup.id, true), /Owner confirmation/)
  await api.uniswap.dca.completeSetup(setup.id, true)
  await assert.rejects(api.uniswap.dca.completeSetup(setup.id, true), /already completed/)
  const schedule = (await api.uniswap.dca.list(walletId))[0]!
  await assert.rejects(agent.uniswap.dca.requestSetup({ action: 'create', scheduleId: schedule.id, input: { request: input, intervalMinutes: 5, confirm: true } }), /cannot reference/)
  await assert.rejects(agent.uniswap.dca.requestSetup({ action: 'active', scheduleId: schedule.id, input: { request: input, intervalMinutes: 5, confirm: true } }), /stored schedule settings/)
  const direct = { id: crypto.randomUUID(), request: input, intervalMinutes: 5, confirm: true as const }
  const [first, retry] = await Promise.all([api.uniswap.dca.create(direct), api.uniswap.dca.create(direct)])
  assert.equal(first.id, retry.id)
  await assert.rejects(api.uniswap.dca.create({ ...direct, intervalMinutes: 10 }), /different settings/)
  await api.uniswap.dca.status(first.id, 'cancelled')
  await db.update(tables.uniswapSchedules).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(tables.uniswapSchedules.id, schedule.id))
  await Promise.all([service.uniswap.tick(), service.uniswap.tick()])
  assert.equal((await db.select().from(tables.uniswapPlans).where(eq(tables.uniswapPlans.scheduleId, schedule.id))).length, 1, 'One plan per occurrence under concurrent workers')
  await api.uniswap.dca.status(schedule.id, 'paused')
  const scheduled = (await db.select().from(tables.uniswapPlans).where(eq(tables.uniswapPlans.scheduleId, schedule.id)))[0]!
  const scheduledOp = (await api.uniswap.get(scheduled.id)).operations[0]!
  await assert.rejects(api.operations.approve(scheduledOp.id, scheduledOp.operationHash), /pending approval|Policy changed/)
  const stale = await agent.uniswap.dca.requestSetup({ action: 'active', scheduleId: schedule.id })
  await api.uniswap.dca.status(schedule.id, 'cancelled')
  await assert.rejects(api.uniswap.dca.completeSetup(stale.id, true), /Schedule changed/)
  // Automatic pipeline: real database reservations, fake signing, actual-input settlement.
  await db.update(tables.agents).set({ mode: 'automatic' }).where(eq(tables.agents.id, agentId))
  await db.update(tables.wallets).set({ policy: { ...policy, mode: 'automatic' } }).where(eq(tables.wallets.id, walletId))
  const funded = await agent.uniswap.fetch({ walletId, url: `${base}/paid`, maxAmountAtomic: '1000000' }, { idempotencyKey: 'fund-once' })
  assert.equal(funded.funding!.request.amount, '0.5', 'Fund only the missing 0.5 USDC, not the full dollar')
  assert.equal(funded.funding!.request.type, 'EXACT_OUTPUT')
  for (let i = 0; i < 8; i++) await service.tick()
  const completed = await api.uniswap.get(funded.funding!.id)
  assert.equal(completed.status, 'complete'); assert.equal(completed.operations.filter(op => op.action === 'paid_fetch').length, 1)
  const beforeRetry = signingCalls
  assert.equal((await agent.uniswap.fetch({ walletId, url: `${base}/paid`, maxAmountAtomic: '1000000' }, { idempotencyKey: 'fund-once' })).funding!.id, completed.id)
  assert.equal(signingCalls, beforeRetry)
  const swap = completed.operations.find(op => op.action === 'uniswap_swap')!
  assert(BigInt(swap.receipt!.swap!.inputAtomic) < BigInt(swap.amountAtomic))
  assert(BigInt(swap.usdSettledMicros!) < BigInt(swap.usdReservedMicros!))
  assert.equal(swap.usdSettledMicros, '500001')
  balance = 100000n
  const sell = await agent.uniswap.swap({ walletId, tokenIn: 'USDC', tokenOut: 'ETH', amount: '0.01' }, { idempotencyKey: 'token-swap' })
  assert.equal(sell.operations[0]!.action, 'uniswap_approval')
  const approval = decodeFunctionData({ abi: erc20Abi, data: uniswapCall(sell.operations[0]!, address).data })
  assert.equal(approval.functionName, 'approve'); assert.equal(approval.args![1], 10000n)
  for (let i = 0; i < 7; i++) await service.tick()
  const sold = await api.uniswap.get(sell.id)
  assert.equal(sold.status, 'complete'); assert.equal(sold.operations.length, 2)
  assert.equal(sold.operations[0]!.usdSettledMicros, '1', 'Allowance charges fees only, not its token amount')
  await db.update(tables.agents).set({ limits: { ...limits, perTransaction: '0' } }).where(eq(tables.agents.id, agentId))
  const denied = await agent.uniswap.swap(input, { idempotencyKey: 'budget-zero' }); assert.equal(denied.operations[0]!.status, 'denied')
  console.log('Uniswap passed: plugin/grant isolation, bounded calldata, single-use owner schedule consent, pause/revision checks, concurrent DCA idempotency, exact shortfall funding, allowance→swap→payment sequencing, actual-input USD settlement and zero-cap denial. Fake signer only; no real money.')
} finally {
  http.stop(true); process.env.BASE_SEPOLIA_RPC_URL = prior.rpc; process.env.AGENTIS_PUBLIC_API_URL = prior.issuer; process.env.AGENTIS_PAID_FETCH_LOCAL_ORIGINS = prior.local
  await sql.end(); await admin.unsafe(`DROP SCHEMA ${name} CASCADE`); await admin.end()
}
