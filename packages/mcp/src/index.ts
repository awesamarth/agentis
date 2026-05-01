#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AgentisClient } from '@agentis/sdk'
import { checkPolicy } from '@agentis/core'
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit'
import { z } from 'zod'

const DEFAULT_API_BASE = 'http://localhost:3001'
const DEFAULT_DEVNET_RPC = 'https://api.devnet.solana.com'
const DEFAULT_MAINNET_RPC = 'https://api.mainnet-beta.solana.com'
const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const addressEncoder = getAddressEncoder()
const DEFAULT_POLICY = {
  hourlyLimit: null,
  dailyLimit: null,
  monthlyLimit: null,
  maxBudget: null,
  maxPerTx: null,
  allowedDomains: [],
  killSwitch: false,
}

type Agent = {
  id: string
  name: string
  walletAddress: string
  apiKey: string
  policy?: any
  policyMode?: 'backend' | 'onchain'
  onchainPolicy?: any
  transactions?: any[]
  [key: string]: unknown
}

type SweepPlanItem = {
  agent: Agent
  usdcAtomic: bigint
  amountUi: string
}

const apiBase = (process.env.AGENTIS_API_URL ?? DEFAULT_API_BASE).replace(/\/$/, '')
const accountKey = process.env.AGENTIS_ACCOUNT_KEY

function requireAccountKey(): string {
  if (!accountKey?.startsWith('agt_user_')) {
    throw new Error('Set AGENTIS_ACCOUNT_KEY to an Agentis account key (agt_user_...)')
  }
  return accountKey
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]))
  }
  return value
}

function result(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(jsonSafe(value), null, 2),
      },
    ],
  }
}

function safeAgent(agent: Agent) {
  const { apiKey: _apiKey, walletId: _walletId, ...safe } = agent
  return safe
}

function spendHistory(agent: Agent) {
  return (agent.transactions ?? []).map((tx: any) => ({
    amount: tx.amountUsd ?? tx.amount ?? 0,
    timestamp: tx.timestamp,
    url: tx.recipient ?? agent.walletAddress,
  }))
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${requireAccountKey()}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body?.error ?? body?.message ?? `Agentis API failed (${res.status})`)
  }
  return body
}

async function runCli(args: string[], cwd = process.cwd()) {
  const child = Bun.spawn(['bun', 'packages/cli/src/index.ts', ...args], {
    cwd,
    env: {
      ...process.env,
      AGENTIS_ACCOUNT_KEY: requireAccountKey(),
      AGENTIS_API_URL: apiBase,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new Error((stderr || stdout || `agentis CLI failed with exit code ${exitCode}`).trim())
  }
  return { stdout, stderr }
}

async function fetchAgents(): Promise<Agent[]> {
  return apiFetch('/account/agents') as Promise<Agent[]>
}

async function resolveAgent(nameOrId: string): Promise<Agent> {
  const agents = await fetchAgents()
  const agent = agents.find(candidate => candidate.id === nameOrId || candidate.name === nameOrId)
  if (!agent) throw new Error(`Agent not found: ${nameOrId}`)
  return agent
}

async function agentClient(nameOrId: string): Promise<AgentisClient> {
  const agent = await resolveAgent(nameOrId)
  return AgentisClient.create({ apiKey: agent.apiKey, baseUrl: apiBase })
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const data = await res.json() as any
    if (!data.error) return data.result as T

    const message = data.error.message ?? `RPC ${method} failed`
    const isRateLimit = /too many requests|rate/i.test(message)
    if (!isRateLimit || attempt === 4) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
  }
  throw new Error(`RPC ${method} failed`)
}

async function getAssociatedTokenAddress(owner: string, mint: string): Promise<string> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [
      addressEncoder.encode(address(owner)),
      addressEncoder.encode(address(TOKEN_PROGRAM)),
      addressEncoder.encode(address(mint)),
    ],
  })
  return ata
}

function readSplTokenAmountFromBase64(data: string): bigint {
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length < 72) return 0n
  return bytes.readBigUInt64LE(64)
}

function atomicToUiString(amount: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals)
  const whole = amount / base
  const fraction = amount % base
  if (fraction === 0n) return whole.toString()
  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

async function getMainnetUsdcBalancesAtomic(walletAddresses: string[]): Promise<Map<string, bigint>> {
  const mainnetRpc = process.env.AGENTIS_MAINNET_RPC_URL ?? DEFAULT_MAINNET_RPC
  const entries = await Promise.all(
    walletAddresses.map(async wallet => ({
      wallet,
      ata: await getAssociatedTokenAddress(wallet, USDC_MAINNET_MINT),
    })),
  )
  const balances = new Map<string, bigint>()

  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    const accounts = await rpc<{ value: ({ data: [string, string] } | null)[] }>(mainnetRpc, 'getMultipleAccounts', [
      chunk.map(entry => entry.ata),
      { encoding: 'base64', commitment: 'confirmed' },
    ])

    for (let j = 0; j < chunk.length; j++) {
      const account = accounts.value?.[j]
      balances.set(chunk[j]!.wallet, account ? readSplTokenAmountFromBase64(account.data[0]) : 0n)
    }
  }

  return balances
}

async function buildSweepPlan(): Promise<SweepPlanItem[]> {
  const agents = await fetchAgents()
  const balances = await getMainnetUsdcBalancesAtomic(agents.map(agent => agent.walletAddress))
  return agents.map(agent => {
    const usdcAtomic = balances.get(agent.walletAddress) ?? 0n
    return { agent, usdcAtomic, amountUi: atomicToUiString(usdcAtomic) }
  })
}

async function executeSweep(plan: SweepPlanItem[]) {
  const sweepable = plan.filter(item => item.usdcAtomic > 0n)
  const deposits = []
  for (const item of sweepable) {
    try {
      const data = await apiFetch(`/agents/${item.agent.id}/earn/deposit`, {
        method: 'POST',
        body: JSON.stringify({
          network: 'mainnet',
          asset: 'USDC',
          amount: item.amountUi,
        }),
      })
      deposits.push({ agent: safeAgent(item.agent), amount: item.amountUi, ok: true, result: data })
    } catch (err: any) {
      deposits.push({ agent: safeAgent(item.agent), amount: item.amountUi, ok: false, error: err?.message ?? String(err) })
    }
  }
  return deposits
}

const nullableUsd = z.number().nonnegative().nullable().optional()
const agentRef = z.string().describe('Agent name or id')

const server = new McpServer(
  {
    name: 'agentis-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  },
)

server.registerResource(
  'agentis_agents',
  'agentis://agents',
  {
    title: 'Agentis Agents',
    description: 'Hosted agents owned by the configured Agentis account key',
    mimeType: 'application/json',
  },
  async () => {
    const agents = await fetchAgents()
    return {
      contents: [
        {
          uri: 'agentis://agents',
          mimeType: 'application/json',
          text: JSON.stringify(agents.map(safeAgent), null, 2),
        },
      ],
    }
  },
)

server.registerTool(
  'agentis_cli_help',
  {
    title: 'Agentis CLI help',
    description: 'Return the Agentis CLI help text for command discovery.',
  },
  async () => result(await runCli([])),
)

server.registerTool(
  'agentis_list_agents',
  {
    title: 'List Agentis agents',
    description: 'List hosted Agentis agents for the configured account key.',
  },
  async () => result((await fetchAgents()).map(safeAgent)),
)

server.registerTool(
  'agentis_create_agent',
  {
    title: 'Create Agentis agent',
    description: 'Create a hosted Agentis agent. Set policyMode to onchain for a pending Quasar policy setup.',
    inputSchema: {
      name: z.string().min(1),
      policyMode: z.enum(['backend', 'onchain']).optional().default('backend'),
      privacyEnabled: z.boolean().optional().default(false),
    },
  },
  async ({ name, policyMode, privacyEnabled }) => {
    const agent = await apiFetch('/agents', {
      method: 'POST',
      body: JSON.stringify({ name, policyMode, privacyEnabled }),
    })
    return result(safeAgent(agent))
  },
)

server.registerTool(
  'agentis_agent_balance',
  {
    title: 'Get agent balance',
    description: 'Read devnet SOL and SPL balances for a hosted Agentis agent. Pass mint to return one balance.',
    inputSchema: {
      agent: agentRef,
      mint: z.string().optional(),
    },
  },
  async ({ agent, mint }) => {
    const client = await agentClient(agent)
    return result(mint ? await client.balance(mint) : await client.balance())
  },
)

server.registerTool(
  'agentis_send_sol',
  {
    title: 'Send SOL',
    description: 'Send devnet SOL from a hosted Agentis agent. Uses backend or on-chain policy enforcement.',
    inputSchema: {
      agent: agentRef,
      to: z.string().min(32),
      amountSol: z.number().positive(),
    },
  },
  async ({ agent, to, amountSol }) => {
    const resolved = await resolveAgent(agent)
    const data = await apiFetch(`/agents/${resolved.id}/send`, {
      method: 'POST',
      body: JSON.stringify({ to, amountSol }),
    })
    return result({ agent: safeAgent(resolved), ...data })
  },
)

server.registerTool(
  'agentis_transactions',
  {
    title: 'List agent transactions',
    description: 'Return tracked transaction history for a hosted Agentis agent.',
    inputSchema: { agent: agentRef },
  },
  async ({ agent }) => {
    const resolved = await resolveAgent(agent)
    const transactions = await apiFetch(`/agents/${resolved.id}/transactions`)
    return result({ agent: safeAgent(resolved), transactions })
  },
)

server.registerTool(
  'agentis_fetch_paid_url',
  {
    title: 'Fetch paid URL',
    description: 'Fetch a URL with an Agentis agent and auto-pay recognized MPP/x402 402 responses.',
    inputSchema: {
      agent: agentRef,
      url: z.string().url(),
      method: z.string().optional().default('GET'),
      headers: z.record(z.string(), z.string()).optional(),
    },
  },
  async ({ agent, url, method, headers }) => {
    const client = await agentClient(agent)
    const response = await client.fetch(url, { method, headers })
    const body = await response.text()
    return result({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    })
  },
)

server.registerTool(
  'agentis_policy_get',
  {
    title: 'Get policy',
    description: 'Get backend policy plus on-chain policy metadata for an agent.',
    inputSchema: { agent: agentRef },
  },
  async ({ agent }) => {
    const resolved = await resolveAgent(agent)
    return result({
      agent: safeAgent(resolved),
      policy: resolved.policy,
      policyMode: resolved.policyMode ?? 'backend',
      onchainPolicy: resolved.onchainPolicy,
    })
  },
)

server.registerTool(
  'agentis_policy_check',
  {
    title: 'Check policy',
    description: 'Locally check whether a hypothetical spend is allowed by the agent policy.',
    inputSchema: {
      agent: agentRef,
      amountUsd: z.number().nonnegative(),
      url: z.string().optional(),
    },
  },
  async ({ agent, amountUsd, url }) => {
    const resolved = await resolveAgent(agent)
    try {
      checkPolicy({ ...DEFAULT_POLICY, ...(resolved.policy ?? {}) }, amountUsd, url ?? resolved.walletAddress, spendHistory(resolved))
      return result({ allowed: true })
    } catch (err: any) {
      return result({ allowed: false, reason: err?.message ?? String(err) })
    }
  },
)

server.registerTool(
  'agentis_policy_update',
  {
    title: 'Update policy',
    description: 'Update policy fields. For initialized on-chain agents this submits an on-chain policy update transaction.',
    inputSchema: {
      agent: agentRef,
      killSwitch: z.boolean().optional(),
      maxPerTx: nullableUsd,
      hourlyLimit: nullableUsd,
      dailyLimit: nullableUsd,
      monthlyLimit: nullableUsd,
      maxBudget: nullableUsd,
      allowedDomains: z.array(z.string()).optional(),
    },
  },
  async ({ agent, ...patch }) => {
    const resolved = await resolveAgent(agent)
    const current = resolved.policy ?? {}
    const policy = Object.fromEntries(
      Object.entries({ ...current, ...patch }).filter(([, value]) => value !== undefined),
    )
    const updated = await apiFetch(`/agents/${resolved.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ policy }),
    })
    return result(safeAgent(updated))
  },
)

server.registerTool(
  'agentis_policy_init_onchain',
  {
    title: 'Initialize on-chain policy',
    description: 'Initialize Quasar policy PDAs for an on-chain policy agent. Agent must have devnet SOL for fees/rent.',
    inputSchema: { agent: agentRef },
  },
  async ({ agent }) => {
    const resolved = await resolveAgent(agent)
    const updated = await apiFetch(`/agents/${resolved.id}/policy/onchain/initialize`, { method: 'POST' })
    return result(safeAgent(updated))
  },
)

server.registerTool(
  'agentis_policy_read_onchain',
  {
    title: 'Read on-chain policy',
    description: 'Read decoded on-chain policy/counter state from devnet.',
    inputSchema: { agent: agentRef },
  },
  async ({ agent }) => {
    const resolved = await resolveAgent(agent)
    const onchain = await apiFetch(`/agents/${resolved.id}/policy/onchain`)
    return result({ agent: safeAgent(resolved), onchain })
  },
)

server.registerTool(
  'agentis_earn_deposit',
  {
    title: 'Deposit into Jupiter Earn',
    description: 'Deposit mainnet USDC from an agent into Jupiter Earn.',
    inputSchema: {
      agent: agentRef,
      amount: z.number().positive(),
      asset: z.literal('USDC').optional().default('USDC'),
    },
  },
  async ({ agent, amount, asset }) => {
    const resolved = await resolveAgent(agent)
    const data = await apiFetch(`/agents/${resolved.id}/earn/deposit`, {
      method: 'POST',
      body: JSON.stringify({ network: 'mainnet', asset, amount }),
    })
    return result({ agent: safeAgent(resolved), ...data })
  },
)

server.registerTool(
  'agentis_earn_positions',
  {
    title: 'Get Jupiter Earn positions',
    description: 'Get mainnet Jupiter Earn positions for an agent.',
    inputSchema: {
      agent: agentRef,
      showAll: z.boolean().optional().default(false),
    },
  },
  async ({ agent, showAll }) => {
    const resolved = await resolveAgent(agent)
    const data = await apiFetch(`/agents/${resolved.id}/earn/positions?network=mainnet`)
    const positions = Array.isArray(data.positions) ? data.positions : []
    return result({
      ...data,
      positions: showAll
        ? positions
        : positions.filter((p: any) => Number(p.underlyingAssets ?? 0) > 0 || Number(p.shares ?? 0) > 0),
    })
  },
)

server.registerTool(
  'agentis_earn_sweep',
  {
    title: 'Sweep all USDC into Jupiter Earn',
    description: 'Plan or execute sweeping all hosted agents mainnet USDC balances into Jupiter Earn.',
    inputSchema: {
      mode: z.enum(['dry-run', 'execute']).default('dry-run'),
    },
  },
  async ({ mode }) => {
    const plan = await buildSweepPlan()
    const totalAtomic = plan.reduce((sum, item) => sum + item.usdcAtomic, 0n)
    const dryRun = {
      network: 'mainnet',
      asset: 'USDC',
      totalAtomic,
      totalUi: atomicToUiString(totalAtomic),
      agents: plan.map(item => ({
        agent: safeAgent(item.agent),
        usdcAtomic: item.usdcAtomic,
        amountUi: item.amountUi,
        action: item.usdcAtomic > 0n ? 'sweep' : 'skip',
      })),
    }
    if (mode === 'dry-run') return result(dryRun)
    return result({ dryRun, deposits: await executeSweep(plan) })
  },
)

server.registerTool(
  'agentis_privacy_status',
  {
    title: 'Umbra status',
    description: 'Get direct Umbra registration/status for an agent.',
    inputSchema: { agent: agentRef },
  },
  async ({ agent }) => result(await (await agentClient(agent)).privacy.status()),
)

server.registerTool(
  'agentis_privacy_register',
  {
    title: 'Register Umbra privacy',
    description: 'Register an agent wallet for Umbra confidential/anonymous usage.',
    inputSchema: {
      agent: agentRef,
      confidential: z.boolean().optional().default(true),
      anonymous: z.boolean().optional().default(true),
    },
  },
  async ({ agent, confidential, anonymous }) => {
    const client = await agentClient(agent)
    return result(await client.privacy.register({ confidential, anonymous }))
  },
)

server.registerTool(
  'agentis_privacy_balance',
  {
    title: 'Umbra encrypted balance',
    description: 'Get Umbra encrypted balance. Defaults to devnet wSOL/SOL mint.',
    inputSchema: { agent: agentRef, mint: z.string().optional() },
  },
  async ({ agent, mint }) => result(await (await agentClient(agent)).privacy.balance({ mint })),
)

server.registerTool(
  'agentis_privacy_deposit',
  {
    title: 'Umbra deposit',
    description: 'Deposit public token balance into Umbra encrypted balance. Amount is atomic units.',
    inputSchema: { agent: agentRef, amount: z.string(), mint: z.string().optional() },
  },
  async ({ agent, amount, mint }) => result(await (await agentClient(agent)).privacy.deposit({ amount, mint })),
)

server.registerTool(
  'agentis_privacy_withdraw',
  {
    title: 'Umbra withdraw',
    description: 'Withdraw from Umbra encrypted balance to public balance. Amount is atomic units.',
    inputSchema: { agent: agentRef, amount: z.string(), mint: z.string().optional() },
  },
  async ({ agent, amount, mint }) => result(await (await agentClient(agent)).privacy.withdraw({ amount, mint })),
)

server.registerTool(
  'agentis_privacy_create_utxo',
  {
    title: 'Create Umbra UTXO',
    description: 'Create a receiver-claimable Umbra UTXO from public balance. Amount is atomic units.',
    inputSchema: {
      agent: agentRef,
      amount: z.string().optional(),
      mint: z.string().optional(),
      to: z.string().optional(),
    },
  },
  async ({ agent, amount, mint, to }) => result(await (await agentClient(agent)).privacy.createUtxo({ amount, mint, to })),
)

server.registerTool(
  'agentis_privacy_scan',
  {
    title: 'Scan Umbra UTXOs',
    description: 'Scan claimable Umbra UTXOs for an agent.',
    inputSchema: { agent: agentRef },
  },
  async ({ agent }) => result(await (await agentClient(agent)).privacy.scan()),
)

server.registerTool(
  'agentis_privacy_claim_latest',
  {
    title: 'Claim latest Umbra UTXO',
    description: 'Claim newest available publicReceived Umbra UTXO into encrypted balance.',
    inputSchema: { agent: agentRef },
  },
  async ({ agent }) => result(await (await agentClient(agent)).privacy.claimLatest()),
)

server.registerTool(
  'agentis_scaffold_facilitator',
  {
    title: 'Scaffold x402 facilitator',
    description: 'Run the CLI scaffold flow for a Kora-backed x402 facilitator project.',
    inputSchema: {
      name: z.string().min(1),
      dir: z.string().optional(),
      feeBps: z.number().int().min(0).max(10_000).optional(),
      network: z.string().optional(),
      mint: z.string().optional(),
      listed: z.boolean().optional().default(false),
    },
  },
  async ({ name, dir, feeBps, network, mint, listed }) => {
    const args = ['facilitator', 'create', name]
    if (dir) args.push('--dir', dir)
    if (feeBps !== undefined) args.push('--fee-bps', String(feeBps))
    if (network) args.push('--network', network)
    if (mint) args.push('--mint', mint)
    if (listed) args.push('--listed')
    return result(await runCli(args))
  },
)

server.registerTool(
  'agentis_list_facilitators',
  {
    title: 'List facilitators',
    description: 'List x402 facilitator records owned by the account.',
  },
  async () => result(await apiFetch('/account/facilitators')),
)

server.registerTool(
  'agentis_register_facilitator',
  {
    title: 'Register facilitator',
    description: 'Register facilitator metadata with Agentis. This does not scaffold local Kora files; use CLI for scaffold generation.',
    inputSchema: {
      name: z.string().min(1),
      feeBps: z.number().int().min(0).max(10_000).optional().default(500),
      network: z.string().optional().default('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
      acceptedMint: z.string().optional().default('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
      publicUrl: z.string().url().optional(),
      listed: z.boolean().optional().default(false),
    },
  },
  async (input) => {
    const facilitator = await apiFetch('/account/facilitators', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return result(facilitator)
  },
)

server.registerTool(
  'agentis_publish_facilitator',
  {
    title: 'Publish facilitator',
    description: 'Update facilitator URL/listing metadata for discovery.',
    inputSchema: {
      facilitatorId: z.string().min(1),
      publicUrl: z.string().url(),
      listed: z.boolean().optional().default(true),
      name: z.string().optional(),
      feeBps: z.number().int().min(0).max(10_000).optional(),
    },
  },
  async ({ facilitatorId, ...patch }) => {
    const facilitator = await apiFetch(`/account/facilitators/${facilitatorId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    return result(facilitator)
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
