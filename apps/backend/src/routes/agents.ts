import { Hono } from 'hono'
import { privy } from '../lib/privy'
import { PrivyClient as NodePrivyClient } from '@privy-io/node'
import { createAgent, getAgentsByUser, getAgentById, updateAgent, updateAgentApiKey, recordTransaction, getAccountByKey, getAgentApiKeySecret } from '../lib/db'
import { randomBytes } from 'crypto'
import {
  Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL
} from '@solana/web3.js'
import { solToUsd } from '../lib/price'
import { registerPrivyWalletWithUmbra } from '../lib/umbra-registration'
import umbra from './umbra'
import sdk from './sdk'
import {
  createCheckAndRecordSpendInstruction,
  confirmTransactionOrThrow,
  createInitializePolicyInstruction,
  createUpdatePolicyInstruction,
  deriveOnchainPolicy,
  formatSolanaTransactionError,
  preparePrivyTransaction,
  readOnchainPolicy,
} from '../lib/onchain-policy'

const DEVNET_RPC = 'https://api.devnet.solana.com'
const DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const MAINNET_RPC = process.env.MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
const MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const JUPITER_LEND_API = 'https://api.jup.ag/lend/v1'
const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const MAINNET_RPC_TIMEOUT_MS = 7000
const JUPITER_API_TIMEOUT_MS = 8000
const privyNode = new NodePrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
})

const agents = new Hono<{ Variables: { userId: string } }>()

function getFlaggedTokenAmountUi(amount: unknown): number | null {
  const value = typeof amount === 'string' ? Number(amount) : Number(amount)
  return Number.isFinite(value) && value > 0 ? value : null
}

function uiAmountToAtomic(amount: unknown, decimals = 6): string | null {
  const raw = String(amount ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) return null

  const [whole = '', fraction = ''] = raw.split('.')
  if (fraction.length > decimals) return null

  const paddedFraction = fraction.padEnd(decimals, '0')
  const atomic = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFraction || '0')
  return atomic > 0n ? atomic.toString() : null
}

function atomicToUiString(amount: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals)
  const whole = amount / base
  const fraction = amount % base
  if (fraction === 0n) return whole.toString()
  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

function readSplTokenAmountFromBase64(data: string): bigint {
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length < 72) return 0n
  return bytes.readBigUInt64LE(64)
}

function getAssociatedTokenAddress(owner: string, mint: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
  return ata.toBase58()
}

async function getMainnetUsdcBalancesAtomic(walletAddresses: string[]): Promise<Map<string, bigint>> {
  const balances = new Map<string, bigint>()
  const entries = walletAddresses.map(wallet => ({
    wallet,
    ata: getAssociatedTokenAddress(wallet, USDC_MAINNET_MINT),
  }))

  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), MAINNET_RPC_TIMEOUT_MS)
    const res = await fetch(MAINNET_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getMultipleAccounts',
        params: [
          chunk.map(entry => entry.ata),
          { encoding: 'base64', commitment: 'confirmed' },
        ],
      }),
    }).finally(() => clearTimeout(timeout))
    const data = await res.json() as {
      error?: { message?: string }
      result?: { value?: ({ data: [string, string] } | null)[] }
    }
    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? `Mainnet RPC failed (${res.status})`)
    }

    for (let j = 0; j < chunk.length; j++) {
      const account = data.result?.value?.[j]
      balances.set(chunk[j]!.wallet, account ? readSplTokenAmountFromBase64(account.data[0]) : 0n)
    }
  }

  return balances
}

async function buildJupiterEarnTransaction(input: {
  asset: string
  signer: string
  amountAtomic: string
}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (process.env.JUPITER_API_KEY) headers['x-api-key'] = process.env.JUPITER_API_KEY

  const res = await fetch(`${JUPITER_LEND_API}/earn/deposit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      asset: input.asset,
      signer: input.signer,
      amount: input.amountAtomic,
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.transaction) {
    throw new Error(data.message ?? data.error ?? `Jupiter Earn deposit build failed (${res.status})`)
  }
  return String(data.transaction)
}

async function buildJupiterEarnWithdrawTransaction(input: {
  asset: string
  signer: string
  amountAtomic: string
}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (process.env.JUPITER_API_KEY) headers['x-api-key'] = process.env.JUPITER_API_KEY

  const res = await fetch(`${JUPITER_LEND_API}/earn/withdraw`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      asset: input.asset,
      signer: input.signer,
      amount: input.amountAtomic,
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.transaction) {
    throw new Error(data.message ?? data.error ?? `Jupiter Earn withdraw build failed (${res.status})`)
  }
  return String(data.transaction)
}

async function buildJupiterEarnRedeemTransaction(input: {
  asset: string
  signer: string
  shares: string
}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (process.env.JUPITER_API_KEY) headers['x-api-key'] = process.env.JUPITER_API_KEY

  const res = await fetch(`${JUPITER_LEND_API}/earn/redeem`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      asset: input.asset,
      signer: input.signer,
      shares: input.shares,
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.transaction) {
    throw new Error(data.message ?? data.error ?? `Jupiter Earn redeem build failed (${res.status})`)
  }
  return String(data.transaction)
}

async function fetchJupiterEarnPositions(user: string) {
  const headers: Record<string, string> = {}
  if (process.env.JUPITER_API_KEY) headers['x-api-key'] = process.env.JUPITER_API_KEY

  const url = new URL(`${JUPITER_LEND_API}/earn/positions`)
  url.searchParams.set('users', user)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), JUPITER_API_TIMEOUT_MS)
  const res = await fetch(url, { headers, signal: controller.signal }).finally(() => clearTimeout(timeout))
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.message ?? data.error ?? `Jupiter Earn positions failed (${res.status})`)
  }
  return data
}

function getEarnPositionUnderlyingAtomic(position: any): bigint {
  try {
    return BigInt(position?.underlyingAssets ?? 0)
  } catch {
    return 0n
  }
}

function getEarnPositionSharesAtomic(position: any): bigint {
  try {
    return BigInt(position?.shares ?? 0)
  } catch {
    return 0n
  }
}

function summarizeEarnPositions(positions: any[]) {
  const visible = positions.filter(position =>
    getEarnPositionUnderlyingAtomic(position) > 0n || getEarnPositionSharesAtomic(position) > 0n
  )
  const totalUnderlyingAtomic = visible.reduce(
    (sum, position) => sum + getEarnPositionUnderlyingAtomic(position),
    0n,
  )
  return {
    positions,
    visiblePositions: visible,
    totalUnderlyingAtomic,
    totalUnderlyingUi: atomicToUiString(totalUnderlyingAtomic, 6),
  }
}

async function getAgentUsdcEarnPosition(agent: any) {
  const positions = await fetchJupiterEarnPositions(agent.walletAddress)
  const list = Array.isArray(positions) ? positions : []
  return list.find((position: any) => position?.token?.assetAddress === USDC_MAINNET_MINT) ?? null
}

async function depositAgentUsdcIntoEarn(agent: any, amountUi: number | string) {
  const amountAtomic = uiAmountToAtomic(amountUi, 6)
  if (!amountAtomic) {
    throw new Error('amount must fit USDC decimals')
  }

  const connection = new Connection(MAINNET_RPC, 'confirmed')
  const encoded = await buildJupiterEarnTransaction({
    asset: USDC_MAINNET_MINT,
    signer: agent.walletAddress,
    amountAtomic,
  })

  const tx = await preparePrivyTransaction(
    connection,
    agent.walletAddress,
    Transaction.from(Buffer.from(encoded, 'base64')),
  )
  const result = await privy.walletApi.solana.signAndSendTransaction({
    walletId: agent.walletId,
    transaction: tx,
    caip2: MAINNET_CAIP2,
  })
  await confirmTransactionOrThrow(connection, result.hash, tx)

  const amountNumber = Number(amountUi)
  await recordTransaction(agent.id, {
    txHash: result.hash,
    amount: amountNumber,
    amountUsd: amountNumber,
    recipient: `jupiter-earn:${USDC_MAINNET_MINT}`,
    timestamp: new Date().toISOString(),
  })

  return {
    signature: result.hash,
    network: 'mainnet',
    asset: USDC_MAINNET_MINT,
    amount: amountNumber,
    amountAtomic,
  }
}

async function withdrawAgentUsdcFromEarn(agent: any, amountUi?: number | string) {
  const amountAtomic = amountUi === undefined ? null : uiAmountToAtomic(amountUi, 6)
  if (amountUi !== undefined && !amountAtomic) {
    throw new Error('amount must fit USDC decimals')
  }

  const position = await getAgentUsdcEarnPosition(agent)
  const shares = getEarnPositionSharesAtomic(position)
  const underlying = getEarnPositionUnderlyingAtomic(position)
  if (shares <= 0n || underlying <= 0n) {
    throw new Error('No USDC Jupiter Earn position found for this agent')
  }

  const connection = new Connection(MAINNET_RPC, 'confirmed')
  const encoded = amountAtomic
    ? await buildJupiterEarnWithdrawTransaction({
      asset: USDC_MAINNET_MINT,
      signer: agent.walletAddress,
      amountAtomic,
    })
    : await buildJupiterEarnRedeemTransaction({
      asset: USDC_MAINNET_MINT,
      signer: agent.walletAddress,
      shares: shares.toString(),
    })

  const tx = await preparePrivyTransaction(
    connection,
    agent.walletAddress,
    Transaction.from(Buffer.from(encoded, 'base64')),
  )
  const result = await privy.walletApi.solana.signAndSendTransaction({
    walletId: agent.walletId,
    transaction: tx,
    caip2: MAINNET_CAIP2,
  })
  await confirmTransactionOrThrow(connection, result.hash, tx)

  const amountNumber = Number(amountAtomic ? amountUi : atomicToUiString(underlying, 6))
  await recordTransaction(agent.id, {
    txHash: result.hash,
    amount: amountNumber,
    amountUsd: amountNumber,
    recipient: `${amountAtomic ? 'jupiter-earn-withdraw' : 'jupiter-earn-redeem'}:${USDC_MAINNET_MINT}`,
    timestamp: new Date().toISOString(),
  })

  return {
    signature: result.hash,
    network: 'mainnet',
    asset: USDC_MAINNET_MINT,
    mode: amountAtomic ? 'withdraw' : 'redeem',
    amount: amountNumber,
    amountAtomic: amountAtomic ?? underlying.toString(),
    shares: amountAtomic ? undefined : shares.toString(),
  }
}

// Middleware: verify Privy JWT or account key (agt_user_xxx)
agents.use('*', async (c, next) => {
  const authHeader = c.req.header('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = authHeader.slice(7)

  if (token.startsWith('agt_user_')) {
    const acc = await getAccountByKey(token)
    if (!acc) return c.json({ error: 'Invalid account key' }, 401)
    c.set('userId', acc.userId)
    await next()
    return
  }

  try {
    const { userId } = await privy.verifyAuthToken(token)
    c.set('userId', userId)
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
})

// GET /agents — list agents for current user
agents.get('/', async (c) => {
  const userId = c.get('userId')
  const userAgents = await getAgentsByUser(userId)
  return c.json(userAgents)
})

// POST /agents — create a new agent
agents.post('/', async (c) => {
  const userId = c.get('userId')
  const { name, privacyEnabled, policyMode } = await c.req.json()

  if (!name?.trim()) {
    return c.json({ error: 'Agent name is required' }, 400)
  }

  // Create Privy server wallet for this agent
  const wallet = await privy.walletApi.createWallet({ chainType: 'solana' })

  // Generate API key
  const apiKey = 'agt_live_' + randomBytes(24).toString('hex')

  const walletAddress = wallet.address
  const useOnchainPolicy = policyMode === 'onchain'

  const agent = await createAgent({
    id: crypto.randomUUID(),
    name: name.trim(),
    userId,
    walletId: wallet.id,
    walletAddress,
    apiKey,
    createdAt: new Date().toISOString(),
    policyMode: useOnchainPolicy ? 'onchain' : 'backend',
    onchainPolicy: useOnchainPolicy ? deriveOnchainPolicy(walletAddress) : undefined,
    privacyEnabled: Boolean(privacyEnabled),
    umbraStatus: privacyEnabled ? 'pending' : 'disabled',
  })

  return c.json(agent, 201)
})

// GET /agents/earn/sweep — plan sweeping all hosted agents' mainnet USDC into Jupiter Earn
agents.get('/earn/sweep', async (c) => {
  const userId = c.get('userId')
  const userAgents = await getAgentsByUser(userId)

  try {
    const balances = await getMainnetUsdcBalancesAtomic(userAgents.map(agent => agent.walletAddress))
    const agents = userAgents.map(agent => {
      const usdcAtomic = balances.get(agent.walletAddress) ?? 0n
      return {
        agent: {
          id: agent.id,
          name: agent.name,
          walletAddress: agent.walletAddress,
          policyMode: agent.policyMode,
          privacyEnabled: agent.privacyEnabled,
        },
        usdcAtomic: usdcAtomic.toString(),
        amountUi: atomicToUiString(usdcAtomic, 6),
        action: usdcAtomic > 0n ? 'sweep' : 'skip',
      }
    })
    const totalAtomic = agents.reduce((sum, item) => sum + BigInt(item.usdcAtomic), 0n)

    return c.json({
      network: 'mainnet',
      asset: 'USDC',
      totalAtomic: totalAtomic.toString(),
      totalUi: atomicToUiString(totalAtomic, 6),
      agents,
    })
  } catch (err) {
    return c.json({ error: formatSolanaTransactionError(err) }, 500)
  }
})

// POST /agents/earn/sweep — execute sweeping all hosted agents' mainnet USDC into Jupiter Earn
agents.post('/earn/sweep', async (c) => {
  const userId = c.get('userId')
  const userAgents = await getAgentsByUser(userId)

  try {
    const balances = await getMainnetUsdcBalancesAtomic(userAgents.map(agent => agent.walletAddress))
    const deposits = []

    for (const agent of userAgents) {
      const usdcAtomic = balances.get(agent.walletAddress) ?? 0n
      if (usdcAtomic <= 0n) {
        deposits.push({
          agent: { id: agent.id, name: agent.name, walletAddress: agent.walletAddress },
          amount: '0',
          ok: true,
          skipped: true,
        })
        continue
      }

      const amountUi = atomicToUiString(usdcAtomic, 6)
      try {
        const result = await depositAgentUsdcIntoEarn(agent, amountUi)
        deposits.push({
          agent: { id: agent.id, name: agent.name, walletAddress: agent.walletAddress },
          amount: amountUi,
          ok: true,
          result,
        })
      } catch (err) {
        deposits.push({
          agent: { id: agent.id, name: agent.name, walletAddress: agent.walletAddress },
          amount: amountUi,
          ok: false,
          error: formatSolanaTransactionError(err),
        })
      }
    }

    const totalAtomic = deposits.reduce((sum, item) => sum + (item.skipped ? 0n : BigInt(uiAmountToAtomic(item.amount, 6) ?? '0')), 0n)
    return c.json({
      network: 'mainnet',
      asset: 'USDC',
      totalUi: atomicToUiString(totalAtomic, 6),
      deposits,
    })
  } catch (err) {
    return c.json({ error: formatSolanaTransactionError(err) }, 500)
  }
})

// GET /agents/earn/positions — summarize Jupiter Earn positions across all hosted agents
agents.get('/earn/positions', async (c) => {
  const userId = c.get('userId')
  const userAgents = await getAgentsByUser(userId)

  const results = await Promise.all(
    userAgents.map(async (agent) => {
      try {
        const positionsData = await fetchJupiterEarnPositions(agent.walletAddress)
        const positions = Array.isArray(positionsData) ? positionsData : []
        const summary = summarizeEarnPositions(positions)
        return {
          agent: {
            id: agent.id,
            name: agent.name,
            walletAddress: agent.walletAddress,
            policyMode: agent.policyMode,
            privacyEnabled: agent.privacyEnabled,
          },
          ok: true,
          totalUnderlyingAtomic: summary.totalUnderlyingAtomic.toString(),
          totalUnderlyingUi: summary.totalUnderlyingUi,
          positions: summary.visiblePositions,
        }
      } catch (err) {
        return {
          agent: {
            id: agent.id,
            name: agent.name,
            walletAddress: agent.walletAddress,
            policyMode: agent.policyMode,
            privacyEnabled: agent.privacyEnabled,
          },
          ok: false,
          totalUnderlyingAtomic: '0',
          totalUnderlyingUi: '0',
          positions: [],
          error: formatSolanaTransactionError(err),
        }
      }
    }),
  )

  const totalUnderlyingAtomic = results.reduce(
    (sum, item) => sum + BigInt(item.totalUnderlyingAtomic),
    0n,
  )

  return c.json({
    network: 'mainnet',
    asset: 'USDC',
    totalUnderlyingAtomic: totalUnderlyingAtomic.toString(),
    totalUnderlyingUi: atomicToUiString(totalUnderlyingAtomic, 6),
    agents: results,
  })
})

// POST /agents/:id/privacy/register — register a funded agent wallet with Umbra
agents.post('/:id/privacy/register', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  try {
    await updateAgent(agent.id, {
      privacyEnabled: true,
      umbraStatus: 'pending',
    })

    const result = await registerPrivyWalletWithUmbra(privyNode, agent.walletId, agent.walletAddress, {
      confidential: true,
      anonymous: true,
    })

    const updated = await updateAgent(agent.id, {
      privacyEnabled: true,
      umbraStatus: 'registered',
      umbraRegisteredAt: new Date().toISOString(),
      umbraRegistrationSignatures: result.signatures,
    })

    return c.json(updated)
  } catch (err: any) {
    console.error('[agents/privacy/register]', err)
    const updated = await updateAgent(agent.id, {
      privacyEnabled: true,
      umbraStatus: 'failed',
      umbraError: err?.message ?? 'Umbra registration failed',
    })
    return c.json(updated, 500)
  }
})

async function proxyUmbraForAgent(c: any, id: string, path: string, method: 'GET' | 'POST') {
  console.log('[agents/umbra/proxy]', { id, path, method })

  const userId = c.get('userId')
  const agent = await getAgentById(id)
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const apiKey = await getAgentApiKeySecret(agent.id)
  if (!apiKey) return c.json({ error: 'Agent API key secret is missing. Regenerate the agent key.' }, 409)

  const sourceUrl = new URL(c.req.url)
  const body = method === 'GET' ? undefined : await c.req.text()
  const internalUrl = new URL(`${path}${sourceUrl.search}`, 'http://agentis.internal')

  const res = await umbra.fetch(new Request(internalUrl, {
    method,
    headers: {
      'content-type': c.req.header('content-type') ?? 'application/json',
      'x-api-key': apiKey,
    },
    body,
  }))
  const text = await res.text()
  return new Response(text, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  })
}

agents.get('/:id/umbra/status', async (c) => proxyUmbraForAgent(c, c.req.param('id'), '/status', 'GET'))
agents.post('/:id/umbra/register', async (c) => proxyUmbraForAgent(c, c.req.param('id'), '/register', 'POST'))
agents.get('/:id/umbra/balance', async (c) => proxyUmbraForAgent(c, c.req.param('id'), '/balance', 'GET'))
agents.post('/:id/umbra/deposit', async (c) => proxyUmbraForAgent(c, c.req.param('id'), '/deposit', 'POST'))
agents.post('/:id/umbra/withdraw', async (c) => proxyUmbraForAgent(c, c.req.param('id'), '/withdraw', 'POST'))
agents.post('/:id/umbra/create-utxo', async (c) => proxyUmbraForAgent(c, c.req.param('id'), '/create-utxo', 'POST'))
agents.get('/:id/umbra/scan', async (c) => proxyUmbraForAgent(c, c.req.param('id'), '/scan', 'GET'))
agents.post('/:id/umbra/claim-latest', async (c) => proxyUmbraForAgent(c, c.req.param('id'), '/claim-latest', 'POST'))

// GET /agents/:id — get single agent (owner only)
agents.get('/:id', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }
  return c.json(agent)
})

// PATCH /agents/:id — update agent config (owner only)
agents.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }
  const body = await c.req.json()
  if (body.policy && agent.policyMode === 'onchain' && agent.onchainPolicy?.initialized) {
    try {
      const connection = new Connection(DEVNET_RPC, 'confirmed')
      const tx = await preparePrivyTransaction(
        connection,
        agent.walletAddress,
        new Transaction().add(createUpdatePolicyInstruction(agent, body.policy)),
      )
      const result = await privy.walletApi.solana.signAndSendTransaction({
        walletId: agent.walletId,
        transaction: tx,
        caip2: DEVNET_CAIP2,
      })
      await confirmTransactionOrThrow(connection, result.hash, tx)
      body.onchainPolicy = {
        ...agent.onchainPolicy,
        lastPolicySignature: result.hash,
      }
    } catch (err) {
      return c.json({ error: formatSolanaTransactionError(err) }, 500)
    }
  }
  if (body.policyMode === 'onchain' && agent.policyMode !== 'onchain') {
    body.onchainPolicy = deriveOnchainPolicy(agent.walletAddress)
  }
  const updated = await updateAgent(c.req.param('id'), body)
  return c.json(updated)
})

// POST /agents/:id/policy/onchain/initialize — create on-chain policy PDAs after funding
agents.post('/:id/policy/onchain/initialize', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const onchainPolicy = agent.onchainPolicy ?? deriveOnchainPolicy(agent.walletAddress)
  const policy = agent.policy ?? {
    hourlyLimit: null,
    dailyLimit: null,
    monthlyLimit: null,
    maxBudget: null,
    maxPerTx: null,
    allowedDomains: [],
    killSwitch: false,
  }

  try {
    const connection = new Connection(DEVNET_RPC, 'confirmed')
    const tx = await preparePrivyTransaction(
      connection,
      agent.walletAddress,
      new Transaction()
        .add(createInitializePolicyInstruction({ ...agent, onchainPolicy }))
        .add(createUpdatePolicyInstruction({ ...agent, onchainPolicy }, policy)),
    )

    const result = await privy.walletApi.solana.signAndSendTransaction({
      walletId: agent.walletId,
      transaction: tx,
      caip2: DEVNET_CAIP2,
    })
    await confirmTransactionOrThrow(connection, result.hash, tx)

    const updated = await updateAgent(agent.id, {
      policyMode: 'onchain',
      onchainPolicy: {
        ...onchainPolicy,
        initialized: true,
        initializedAt: new Date().toISOString(),
        initializedSignature: result.hash,
        lastPolicySignature: result.hash,
      },
    })

    return c.json(updated)
  } catch (err) {
    return c.json({ error: formatSolanaTransactionError(err) }, 500)
  }
})

// GET /agents/:id/policy/onchain — read on-chain policy/counter account state
agents.get('/:id/policy/onchain', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }
  const connection = new Connection(DEVNET_RPC, 'confirmed')
  return c.json(await readOnchainPolicy(connection, agent))
})

// GET /agents/:id/transactions — get transaction history (owner only)
agents.get('/:id/transactions', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }
  return c.json(agent.transactions ?? [])
})

// POST /agents/:id/fetch — account/JWT-auth paid fetch without exposing the agent API key
agents.post('/:id/fetch', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const apiKey = await getAgentApiKeySecret(agent.id)
  if (!apiKey) return c.json({ error: 'Agent API key secret is missing. Regenerate the agent key.' }, 409)

  const { url, method, headers, body } = await c.req.json()
  if (!url) return c.json({ error: 'url is required' }, 400)

  try {
    const initialResponse = await fetch(url, {
      method: method ?? 'GET',
      headers: headers ?? {},
      ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    })

    if (initialResponse.status !== 402) {
      const responseBody = await initialResponse.text()
      return c.json({
        status: initialResponse.status,
        headers: Object.fromEntries(initialResponse.headers.entries()),
        body: responseBody,
      })
    }

    const paymentHeader = initialResponse.headers.get('payment-required')
    const isX402 = Boolean(paymentHeader)
    const internalPath = isX402 ? '/agent/fetch-paid' : '/agent/fetch-paid-mpp'

    const res = await sdk.fetch(new Request(`http://agentis.internal${internalPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        url,
        method: method ?? 'GET',
        headers: headers ?? {},
        body,
      }),
    }))

    const text = await res.text()
    return new Response(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Fetch failed' }, 500)
  }
})

// POST /agents/:id/earn/deposit — mainnet Jupiter Earn deposit
agents.post('/:id/earn/deposit', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const body = await c.req.json()
  const network = body.network ?? 'mainnet'
  if (network !== 'mainnet') {
    return c.json({ error: 'Jupiter Earn is mainnet-only for now' }, 400)
  }

  const assetInput = String(body.asset ?? 'USDC')
  const asset = assetInput.toUpperCase() === 'USDC' ? USDC_MAINNET_MINT : assetInput
  const amountUi = getFlaggedTokenAmountUi(body.amount)
  if (!amountUi) {
    return c.json({ error: 'amount must be a positive UI amount' }, 400)
  }

  // Keep this route narrow until we add token metadata/decimals discovery.
  if (asset !== USDC_MAINNET_MINT) {
    return c.json({ error: 'Only mainnet USDC Earn deposits are supported right now' }, 400)
  }

  const amountAtomic = uiAmountToAtomic(body.amount, 6)
  if (!amountAtomic) {
    return c.json({ error: 'amount must fit USDC decimals' }, 400)
  }

  try {
    return c.json(await depositAgentUsdcIntoEarn(agent, body.amount))
  } catch (err) {
    return c.json({ error: formatSolanaTransactionError(err) }, 500)
  }
})

// POST /agents/:id/earn/withdraw — mainnet Jupiter Earn withdraw/redeem
agents.post('/:id/earn/withdraw', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const body = await c.req.json()
  const network = body.network ?? 'mainnet'
  if (network !== 'mainnet') {
    return c.json({ error: 'Jupiter Earn is mainnet-only for now' }, 400)
  }

  const assetInput = String(body.asset ?? 'USDC')
  const asset = assetInput.toUpperCase() === 'USDC' ? USDC_MAINNET_MINT : assetInput
  if (asset !== USDC_MAINNET_MINT) {
    return c.json({ error: 'Only mainnet USDC Earn withdrawals are supported right now' }, 400)
  }

  const amount = body.amount === undefined || body.amount === null || body.amount === ''
    ? undefined
    : body.amount
  if (amount !== undefined && !getFlaggedTokenAmountUi(amount)) {
    return c.json({ error: 'amount must be a positive UI amount' }, 400)
  }

  try {
    return c.json(await withdrawAgentUsdcFromEarn(agent, amount))
  } catch (err) {
    return c.json({ error: formatSolanaTransactionError(err) }, 500)
  }
})

// GET /agents/:id/earn/balance — mainnet USDC available for Jupiter Earn
agents.get('/:id/earn/balance', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const network = c.req.query('network') ?? 'mainnet'
  if (network !== 'mainnet') {
    return c.json({ error: 'Jupiter Earn is mainnet-only for now' }, 400)
  }

  try {
    const balances = await getMainnetUsdcBalancesAtomic([agent.walletAddress])
    const amountAtomic = balances.get(agent.walletAddress) ?? 0n
    return c.json({
      network: 'mainnet',
      asset: 'USDC',
      walletAddress: agent.walletAddress,
      amountAtomic: amountAtomic.toString(),
      amountUi: atomicToUiString(amountAtomic, 6),
    })
  } catch (err) {
    return c.json({ error: formatSolanaTransactionError(err) }, 500)
  }
})

// GET /agents/:id/earn/positions — mainnet Jupiter Earn positions
agents.get('/:id/earn/positions', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const network = c.req.query('network') ?? 'mainnet'
  if (network !== 'mainnet') {
    return c.json({ error: 'Jupiter Earn is mainnet-only for now' }, 400)
  }

  try {
    const positions = await fetchJupiterEarnPositions(agent.walletAddress)
    return c.json({
      network: 'mainnet',
      walletAddress: agent.walletAddress,
      positions,
    })
  } catch (err) {
    return c.json({ error: formatSolanaTransactionError(err) }, 500)
  }
})

// POST /agents/:id/regen-key — regenerate API key (owner only)
agents.post('/:id/regen-key', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }
  const newKey = 'agt_live_' + randomBytes(24).toString('hex')
  const updated = await updateAgentApiKey(c.req.param('id'), newKey)
  return c.json({ apiKey: updated.apiKey })
})

// POST /agents/:id/send — send SOL from agent wallet (owner only)
agents.post('/:id/send', async (c) => {
  const userId = c.get('userId')
  const agent = await getAgentById(c.req.param('id'))
  if (!agent || agent.userId !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const { to, amountSol } = await c.req.json()

  if (!to || !amountSol || amountSol <= 0) {
    return c.json({ error: 'to and amountSol are required' }, 400)
  }

  const amountUsd = await solToUsd(amountSol)

  // Backend policy checks are used for backend-mode agents. On-chain agents enforce
  // core spend limits in the transaction via Quasar once initialized.
  const policy = agent.policy
  if (agent.policyMode === 'onchain') {
    if (!agent.onchainPolicy?.initialized) {
      return c.json({ error: 'On-chain policy is not initialized. Fund the agent wallet, then initialize policy.' }, 403)
    }
  } else if (policy) {
    if (policy.killSwitch) {
      return c.json({ error: 'Kill switch is active — agent payments disabled' }, 403)
    }
    if (policy.maxPerTx !== null && amountSol > policy.maxPerTx) {
      return c.json({ error: `Exceeds max per transaction limit (${policy.maxPerTx} SOL)` }, 403)
    }

    const now = Date.now()
    const txns = agent.transactions ?? []

    if (policy.hourlyLimit !== null) {
      const hourSpend = txns
        .filter(t => now - new Date(t.timestamp).getTime() < 60 * 60 * 1000)
        .reduce((sum, t) => sum + t.amount, 0)
      if (hourSpend + amountSol > policy.hourlyLimit) {
        return c.json({ error: `Hourly spend limit exceeded (${policy.hourlyLimit} SOL)` }, 403)
      }
    }

    if (policy.dailyLimit !== null) {
      const daySpend = txns
        .filter(t => now - new Date(t.timestamp).getTime() < 24 * 60 * 60 * 1000)
        .reduce((sum, t) => sum + t.amount, 0)
      if (daySpend + amountSol > policy.dailyLimit) {
        return c.json({ error: `Daily spend limit exceeded (${policy.dailyLimit} SOL)` }, 403)
      }
    }

    if (policy.monthlyLimit !== null) {
      const currentMonth = new Date().toISOString().slice(0, 7)
      const monthSpend = agent.monthSpend?.month === currentMonth ? agent.monthSpend.spend : 0
      if (monthSpend + amountSol > policy.monthlyLimit) {
        return c.json({ error: `Monthly spend limit exceeded (${policy.monthlyLimit} SOL)` }, 403)
      }
    }

    if (policy.maxBudget !== null) {
      const totalSpend = txns.reduce((sum, t) => sum + t.amount, 0)
      if (totalSpend + amountSol > policy.maxBudget) {
        return c.json({ error: `Total budget cap exceeded (${policy.maxBudget} SOL)` }, 403)
      }
    }
  }

  let toPubkey: PublicKey
  try {
    toPubkey = new PublicKey(to)
  } catch {
    return c.json({ error: 'Invalid recipient address' }, 400)
  }

  // Build transfer transaction
  const connection = new Connection(DEVNET_RPC, 'confirmed')
  const fromPubkey = new PublicKey(agent.walletAddress)
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')

  const tx = new Transaction()
  tx.recentBlockhash = blockhash
  tx.lastValidBlockHeight = lastValidBlockHeight
  tx.feePayer = fromPubkey
  tx.add(
    ...(agent.policyMode === 'onchain'
      ? [createCheckAndRecordSpendInstruction(agent, amountUsd)]
      : []),
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    })
  )

  // Sign and send via Privy
  try {
    const result = await privy.walletApi.solana.signAndSendTransaction({
      walletId: agent.walletId,
      transaction: tx,
      caip2: DEVNET_CAIP2,
    })
    await confirmTransactionOrThrow(connection, result.hash, tx)

    await recordTransaction(agent.id, {
      txHash: result.hash,
      amount: amountSol,
      amountUsd,
      recipient: to,
      timestamp: new Date().toISOString(),
    })

    return c.json({ signature: result.hash })
  } catch (err) {
    return c.json({ error: formatSolanaTransactionError(err) }, 500)
  }
})

export default agents
