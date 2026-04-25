import { Hono } from 'hono'
import { privy } from '../lib/privy'
import { createAgent, getAgentsByUser, getAgentById, updateAgent, updateAgentApiKey, recordTransaction, getAccountByKey } from '../lib/db'
import { randomBytes } from 'crypto'
import {
  Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL
} from '@solana/web3.js'
import { solToUsd } from '../lib/price'

const DEVNET_RPC = 'https://api.devnet.solana.com'
const DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'

const agents = new Hono<{ Variables: { userId: string } }>()

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
  const { name } = await c.req.json()

  if (!name?.trim()) {
    return c.json({ error: 'Agent name is required' }, 400)
  }

  // Create Privy server wallet for this agent
  const wallet = await privy.walletApi.createWallet({ chainType: 'solana' })

  // Generate API key
  const apiKey = 'agt_live_' + randomBytes(24).toString('hex')

  const agent = await createAgent({
    id: crypto.randomUUID(),
    name: name.trim(),
    userId,
    walletId: wallet.id,
    walletAddress: wallet.address,
    apiKey,
    createdAt: new Date().toISOString(),
  })

  return c.json(agent, 201)
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
  const updated = await updateAgent(c.req.param('id'), body)
  return c.json(updated)
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

  // Policy checks
  const policy = agent.policy
  if (policy) {
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

    const amountUsd = await solToUsd(amountSol)
    await recordTransaction(agent.id, {
      txHash: result.hash,
      amount: amountSol,
      amountUsd,
      recipient: to,
      timestamp: new Date().toISOString(),
    })

    return c.json({ signature: result.hash })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Transaction failed' }, 500)
  }
})

export default agents
