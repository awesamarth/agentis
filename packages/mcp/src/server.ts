import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AgentisClient, AgentisApiError } from '@agentis-hq/sdk'
import { operationInput } from '@agentis-hq/core/operations'
import { z } from 'zod'
export { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
export type Delegation = { agentId: string; name: string; plugins?: string[]; client: AgentisClient }
export type Network = { chainId: string; name: string; decimals: number; currency: string; assets: readonly { id: string; symbol: string; decimals: number }[] }
const decimal = z.string().regex(/^\d+(\.\d+)?$/).max(80)
function atomic(value: string, decimals: number) {
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > decimals) throw Error('Too many decimal places')
  const amount = BigInt(whole! + fraction.padEnd(decimals, '0'))
  if (amount <= 0n) throw Error('Amount must be positive')
  return amount.toString()
}
export function createAgentisMcpServer(options: { delegations: Delegation[]; networks: readonly Network[] }) {
  const { delegations, networks } = options
  const server = new McpServer({ name: 'agentis', version: '0.3.0' })
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  async function run(fn: () => Promise<unknown>) {
    try { return result(await fn()) } catch (error) { return { ...result({ error: error instanceof AgentisApiError ? error.message : 'Request failed. Check the selected wallet, amounts and permissions. Keep the same payment key after uncertainty.' }), isError: true } }
  }
  function agent(id?: string) {
    const choices = id ? delegations.filter(item => item.agentId === id) : delegations
    if (choices.length !== 1) throw Error('Select an agent ID from agentis_list_wallets')
    return choices[0]!
  }
  async function forWallet(walletId: string) {
    for (const delegation of delegations) {
      const wallet = (await delegation.client.wallets.list()).find(wallet => wallet.id === walletId && wallet.enabled)
      if (wallet) return { ...delegation, wallet }
    }
    throw Error('Wallet outside delegated scope')
  }
  async function getOperation(id: string) {
    for (const delegation of delegations) {
      try { return await delegation.client.operations.get(id) } catch (error) { if (!(error instanceof AgentisApiError) || error.status !== 404) throw error }
    }
    throw Error('Operation outside delegated scope')
  }
  const read = { readOnlyHint: true, openWorldHint: true }
  const payment = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
  const agentId = z.string().uuid().optional()
  const key = z.string().min(1).max(128).describe('Stable unique key for this payment. Reuse unchanged after timeouts; never blindly use a new key.')
  server.registerTool('agentis_capabilities', { description: 'Inspect supported execution features and token metadata. Hosted/testnet only.', inputSchema: {}, annotations: read }, () => run(async () => ({ ...await delegations[0]!.client.capabilities(), networks })))
  server.registerTool('agentis_list_wallets', { description: 'List connected agents and their authorized enabled wallets. Use walletId for payments and agentId for balance/policy/history.', inputSchema: {}, annotations: read }, () => run(async () => Promise.all(delegations.map(async item => {
    const wallets = (await item.client.wallets.list()).filter(wallet => wallet.enabled)
    return { name: item.name, agentId: item.agentId, plugins: wallets[0]?.agentPlugins ?? [], wallets: wallets.map(wallet => ({ walletId: wallet.id, chainId: wallet.chainId, address: wallet.address, assets: networks.find(network => network.chainId === wallet.chainId)?.assets })) }
  }))))
  server.registerTool('agentis_balance', { description: 'Read balances for an agent’s authorized wallets/networks. Missing amounts/prices remain unavailable, not zero.', inputSchema: { agentId }, annotations: read }, ({ agentId }) => run(() => { const item = agent(agentId); return item.client.agents.balance(item.agentId) }))
  server.registerTool('agentis_policy', { description: 'Read shared agent USD limits, mode and total spent/reserved. Limits include fees and all agent networks/keys. Cannot edit rules.', inputSchema: { agentId }, annotations: read }, ({ agentId }) => run(async () => { const item = agent(agentId); const wallet = (await item.client.wallets.list()).find(wallet => wallet.enabled); if (!wallet) throw Error(); return item.client.wallets.policy(wallet.id) }))
  server.registerTool('agentis_history', { description: 'Read recent payments across issuing keys within authorized wallets/networks. Read-only; does not grant approval or replay permissions.', inputSchema: { agentId, limit: z.number().int().min(1).max(100).default(20) }, annotations: read }, ({ agentId, limit }) => run(async () => (await agent(agentId).client.history()).slice(0, limit)))
  server.registerTool('agentis_send', {
    description: 'Send to another wallet using hosted backend policies. Ask mode returns approvalUrl for the human; automatic mode queues execution. Check progress with agentis_get_operation. Never approve your own request.',
    inputSchema: { walletId: z.string().uuid(), to: z.string().min(1).max(128), amount: decimal.describe('Decimal token units, not atomic units'), asset: z.string().max(20).describe('Supported token symbol, e.g. ETH, USDC, SOL or alphaUSD'), maxFee: decimal.optional().describe('Decimal native/protocol fee units; defaults: Base 0.0001 ETH, Solana 0.005 SOL, Arc/Tempo 0.01 USD'), reason: z.string().max(500).optional(), idempotencyKey: key }, annotations: payment,
  }, ({ walletId, to, amount, asset, maxFee, reason, idempotencyKey }) => run(async () => {
    const item = await forWallet(walletId), network = networks.find(network => network.chainId === item.wallet.chainId)!
    const token = network.assets.find(token => token.symbol.toLowerCase() === asset.toLowerCase())
    if (!token) throw Error('Unsupported asset')
    const fee = maxFee ?? (network.chainId === 'eip155:84532' ? '0.0001' : network.chainId.startsWith('solana:') ? '0.005' : '0.01')
    return item.client.operations.create({ action: 'transfer', walletId, chainId: network.chainId, asset: token.id, amountAtomic: atomic(amount, token.decimals), maxFeeAtomic: atomic(fee, network.decimals), to, reason }, { idempotencyKey })
  }))
  server.registerTool('agentis_fetch', {
    description: 'Request a paid GET using x402 (Base/Arc/Solana USDC) or Tempo MPP alphaUSD. Same budgets/approval flow as sends. Pending approval returns a dashboard URL. Read the result with agentis_get_operation; do not blindly pay again after HTTP failure.',
    inputSchema: { walletId: z.string().uuid(), url: z.string().url().max(4096), swapFunding: z.boolean().default(false).describe('Base Sepolia only: use enabled Uniswap plugin to swap ETH for missing USDC before payment'), maxAmount: decimal.describe('Maximum price in decimal USDC/alphaUSD units'), maxFee: decimal.optional().describe('Tempo only: decimal protocol USD fee budget, defaults to 0.01'), idempotencyKey: key }, annotations: payment,
  }, ({ walletId, url, maxAmount, maxFee, idempotencyKey, swapFunding }) => run(async () => {
    const item = await forWallet(walletId)
    const fetch = swapFunding ? item.client.uniswap.fetch : item.client.fetch
    return fetch({ walletId, url, maxAmountAtomic: atomic(maxAmount, 6), ...(item.wallet.chainId === 'eip155:42431' ? { maxFeeAtomic: atomic(maxFee ?? '0.01', 18) } : {}) }, { idempotencyKey })
  }))
  server.registerTool('agentis_request_operation', { description: 'Advanced raw operation request. Uses the same backend policy and approval pipeline; never self-approve.', inputSchema: { operation: operationInput, idempotencyKey: key }, annotations: payment }, ({ operation, idempotencyKey }) => run(async () => (await forWallet(operation.walletId)).client.operations.create(operation, { idempotencyKey })))
  server.registerTool('agentis_get_operation', { description: 'Read status/receipt/paid response for an operation issued through this connection. Unknown means reconcile, not resend.', inputSchema: { id: z.string().uuid() }, annotations: read }, ({ id }) => run(() => getOperation(id)))
  server.registerTool('agentis_list_operations', { description: 'List operation records issued through this connection. Use agentis_history for older keys’ payments.', inputSchema: { agentId }, annotations: read }, ({ agentId }) => run(() => agent(agentId).client.operations.list()))
  if (delegations.some(item => item.plugins?.includes('uniswap'))) {
    const swap = { walletId: z.string().uuid(), tokenIn: z.enum(['ETH', 'USDC']), tokenOut: z.enum(['ETH', 'USDC']), amount: decimal, type: z.enum(['EXACT_INPUT', 'EXACT_OUTPUT']).default('EXACT_INPUT'), slippageBps: z.number().int().min(1).max(500).default(50), maxFee: decimal.default('0.0001') }
    server.registerTool('agentis_swap_quote', { description: 'Quote a same-chain Base Sepolia Uniswap V3 swap. Requires this agent’s Uniswap plugin. Decimal token amount; no funds move.', inputSchema: swap, annotations: read }, input => run(async () => (await forWallet(input.walletId)).client.uniswap.quote(input)))
    server.registerTool('agentis_swap', { description: 'Request a bounded Uniswap swap. Returns a persisted plan and any owner approval link; use agentis_swap_get for progress. ERC20 approval is a separate, bounded operation.', inputSchema: { ...swap, idempotencyKey: key, minimumOutputAtomic: z.string().optional(), maximumInputAtomic: z.string().optional() }, annotations: payment }, ({ idempotencyKey, ...input }) => run(async () => (await forWallet(input.walletId)).client.uniswap.swap(input, { idempotencyKey })))
    server.registerTool('agentis_swap_get', { description: 'Read swap/funding plan, underlying operations, receipts and any resulting paid response. Never blindly resend.', inputSchema: { agentId, id: z.string().uuid() }, annotations: read }, ({ agentId, id }) => run(() => agent(agentId).client.uniswap.get(id)))
    const allocation = { walletId: z.string().uuid(), ethPercent: z.number().int().min(0).max(100) }
    server.registerTool('agentis_rebalance_preview', { description: 'Preview a one-shot ETH/USDC allocation adjustment for this agent’s Base wallet. Retains gas; no funds move.', inputSchema: allocation, annotations: read }, ({ walletId, ethPercent }) => run(async () => (await forWallet(walletId)).client.uniswap.rebalance(walletId, ethPercent)))
    server.registerTool('agentis_rebalance', { description: 'Request a one-shot rebalance toward ETH percentage, remainder USDC. Uses existing budgets/approval; not a recurring mandate.', inputSchema: { ...allocation, idempotencyKey: key }, annotations: payment }, ({ walletId, ethPercent, idempotencyKey }) => run(async () => {
      const { client } = await forWallet(walletId)
      return await client.uniswap.executeRebalance(walletId, ethPercent, { idempotencyKey }) ?? { status: 'unchanged', message: 'No rebalance needed' }
    }))
    server.registerTool('agentis_dca_list', { description: 'List this wallet’s DCA/gas-refill schedules. Read-only.', inputSchema: { walletId: z.string().uuid() }, annotations: read }, ({ walletId }) => run(async () => (await forWallet(walletId)).client.uniswap.dca.list(walletId)))
    server.registerTool('agentis_dca_get', { description: 'Inspect one schedule, next run and last error.', inputSchema: { walletId: z.string().uuid(), id: z.string().uuid() }, annotations: read }, ({ walletId, id }) => run(async () => {
      const schedule = (await (await forWallet(walletId)).client.uniswap.dca.list(walletId)).find(item => item.id === id)
      if (!schedule) throw Error('Schedule not found'); return schedule
    }))
    server.registerTool('agentis_dca_request_setup', { description: 'Request owner-confirmed DCA creation/edit/pause/resume/cancel. Returns a dashboard confirmation URL; cannot enable recurring spending by itself.', inputSchema: { walletId: z.string().uuid(), action: z.enum(['create', 'edit', 'active', 'paused', 'cancelled']), scheduleId: z.string().uuid().optional(), input: z.object({ request: z.object(swap), intervalMinutes: z.number().int().min(5).max(525600), confirm: z.literal(true) }).optional() }, annotations: { ...payment, idempotentHint: false } }, ({ walletId, ...input }) => run(async () => (await forWallet(walletId)).client.uniswap.dca.requestSetup(input)))
  }
  return server
}
