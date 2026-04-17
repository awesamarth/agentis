import { Hono } from 'hono'
import { privy } from '../lib/privy'
import { createAgent, getAgentsByUser, getAgentById, updateAgent } from '../lib/db'
import { randomBytes } from 'crypto'
import {
  PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL
} from '@solana/web3.js'

const DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'

const agents = new Hono<{ Variables: { userId: string } }>()

// Middleware: verify Privy token and attach userId
agents.use('*', async (c, next) => {
  const authHeader = c.req.header('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = authHeader.slice(7)
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

  let toPubkey: PublicKey
  try {
    toPubkey = new PublicKey(to)
  } catch {
    return c.json({ error: 'Invalid recipient address' }, 400)
  }

  // Build transfer transaction — no blockhash, Privy fills it
  const fromPubkey = new PublicKey(agent.walletAddress)
  const tx = new Transaction()
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
    return c.json({ signature: result.hash })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Transaction failed' }, 500)
  }
})

export default agents
