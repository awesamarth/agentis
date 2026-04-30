import { Hono } from 'hono'
import { privy } from '../lib/privy'
import { PrivyClient as NodePrivyClient } from '@privy-io/node'
import { createAgent, getAgentsByUser, getAgentById, updateAgent, updateAgentApiKey, recordTransaction, getAccountByKey } from '../lib/db'
import { randomBytes } from 'crypto'
import {
  Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL
} from '@solana/web3.js'
import { solToUsd } from '../lib/price'
import { registerPrivyWalletWithUmbra } from '../lib/umbra-registration'
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

async function fetchJupiterEarnPositions(user: string) {
  const headers: Record<string, string> = {}
  if (process.env.JUPITER_API_KEY) headers['x-api-key'] = process.env.JUPITER_API_KEY

  const url = new URL(`${JUPITER_LEND_API}/earn/positions`)
  url.searchParams.set('users', user)

  const res = await fetch(url, { headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.message ?? data.error ?? `Jupiter Earn positions failed (${res.status})`)
  }
  return data
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
  const connection = new Connection(MAINNET_RPC, 'confirmed')

  try {
    const encoded = await buildJupiterEarnTransaction({
      asset,
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

    await recordTransaction(agent.id, {
      txHash: result.hash,
      amount: amountUi,
      amountUsd: amountUi,
      recipient: `jupiter-earn:${asset}`,
      timestamp: new Date().toISOString(),
    })

    return c.json({
      signature: result.hash,
      network: 'mainnet',
      asset,
      amount: amountUi,
      amountAtomic,
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
