import { Hono } from 'hono'
import { privy } from '../lib/privy'
import { getAgentByApiKey, updateAgent, recordTransaction } from '../lib/db'
import {
  Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL
} from '@solana/web3.js'

const DEVNET_RPC = 'https://api.devnet.solana.com'
const DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'

type Agent = Awaited<ReturnType<typeof getAgentByApiKey>>

const sdk = new Hono<{ Variables: { agent: NonNullable<Agent> } }>()

// Middleware: API key auth
sdk.use('*', async (c, next) => {
  const apiKey = c.req.header('x-api-key')
  if (!apiKey?.startsWith('agt_live_')) {
    return c.json({ error: 'Missing or invalid API key' }, 401)
  }
  const agent = await getAgentByApiKey(apiKey)
  if (!agent) return c.json({ error: 'Invalid API key' }, 401)
  c.set('agent', agent)
  await next()
})

// GET /sdk/agent — get agent info + policy
sdk.get('/agent', async (c) => {
  const agent = c.get('agent')
  return c.json({
    id: agent.id,
    name: agent.name,
    walletAddress: agent.walletAddress,
    policy: agent.policy ?? {
      hourlyLimit: null,
      dailyLimit: null,
      monthlyLimit: null,
      maxBudget: null,
      maxPerTx: null,
      allowedDomains: [],
      killSwitch: false,
    },
    transactions: agent.transactions ?? [],
  })
})

// PATCH /sdk/agent/policy — update policy via API key
sdk.patch('/agent/policy', async (c) => {
  const agent = c.get('agent')
  const patch = await c.req.json()

  // Only allow policy fields
  const allowedFields = ['hourlyLimit', 'dailyLimit', 'monthlyLimit', 'maxBudget', 'maxPerTx', 'allowedDomains', 'killSwitch']
  const safePolicy: any = { ...(agent.policy ?? {}) }
  for (const key of allowedFields) {
    if (patch[key] !== undefined) safePolicy[key] = patch[key]
  }

  const updated = await updateAgent(agent.id, { policy: safePolicy })
  return c.json(updated.policy)
})

// POST /sdk/agent/sign — sign a message with agent's Privy wallet (for MPP)
sdk.post('/agent/sign', async (c) => {
  const agent = c.get('agent')
  const { message } = await c.req.json()

  if (!Array.isArray(message)) {
    return c.json({ error: 'message must be a byte array' }, 400)
  }

  try {
    const msgBytes = Buffer.from(message as number[])
    const result = await privy.walletApi.solana.signMessage({
      walletId: agent.walletId,
      message: msgBytes.toString('base64'),
    })
    return c.json({ signature: Array.from(Buffer.from(result.signature as unknown as string, 'base64')) })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Sign failed' }, 500)
  }
})

// POST /sdk/agent/sign-payment — build + sign x402 payment transaction
sdk.post('/agent/sign-payment', async (c) => {
  const agent = c.get('agent')
  const { requirements } = await c.req.json()

  if (!requirements?.payTo || !requirements?.maxAmountRequired) {
    return c.json({ error: 'Invalid payment requirements' }, 400)
  }

  try {
    const connection = new Connection(DEVNET_RPC, 'confirmed')
    const fromPubkey = new PublicKey(agent.walletAddress)
    const toPubkey = new PublicKey(requirements.payTo)
    const lamports = parseInt(requirements.maxAmountRequired, 10)

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')

    const tx = new Transaction()
    tx.recentBlockhash = blockhash
    tx.lastValidBlockHeight = lastValidBlockHeight
    tx.feePayer = fromPubkey
    tx.add(SystemProgram.transfer({ fromPubkey, toPubkey, lamports }))

    const result = await (privy.walletApi.solana as any).signTransaction({
      walletId: agent.walletId,
      transaction: tx,
      caip2: DEVNET_CAIP2,
    })

    // Return base64 signed tx as x402 payment header value
    const serialized = (result.signedTransaction as Transaction).serialize()
    const payment = Buffer.from(serialized).toString('base64')

    return c.json({ payment, lamports, payTo: requirements.payTo })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Sign payment failed' }, 500)
  }
})

// POST /sdk/agent/record-spend — called by SDK after facilitator confirms payment
sdk.post('/agent/record-spend', async (c) => {
  const agent = c.get('agent')
  const { txHash, lamports, payTo } = await c.req.json()

  if (!txHash || !lamports || !payTo) {
    return c.json({ error: 'txHash, lamports, and payTo are required' }, 400)
  }

  await recordTransaction(agent.id, {
    txHash,
    amount: lamports / 1e9,
    recipient: payTo,
    timestamp: new Date().toISOString(),
  })

  return c.json({ ok: true })
})

export default sdk
