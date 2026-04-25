import { Hono } from 'hono'
import { privy } from '../lib/privy'
import { getAgentByApiKey, updateAgent, recordTransaction } from '../lib/db'
import { PrivyClient } from '@privy-io/node'
import { createX402Client } from '@privy-io/node/x402'
import { wrapFetchWithPayment } from '@x402/fetch'
import { Mppx, solana as solanaClient } from '@solana/mpp/client'
import { createSolanaKitSigner } from '@privy-io/node/solana-kit'
import { address as toAddress } from '@solana/kit'
import { solToUsd, getTokenPriceUsd } from '../lib/price'

const DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'

// @privy-io/node client for x402 signing
const privyNode = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
})

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

// POST /sdk/agent/fetch-paid — proxy a request through Privy x402 wallet
// The SDK sends the URL here, backend does the paid fetch and returns the response
sdk.post('/agent/fetch-paid', async (c) => {
  const agent = c.get('agent')
  const { url, method, headers, body, amount, mint } = await c.req.json()

  if (!url) {
    return c.json({ error: 'url is required' }, 400)
  }

  try {
    const x402client = createX402Client(privyNode, {
      walletId: agent.walletId,
      address: agent.walletAddress,
    })

    const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, x402client)

    const response = await fetchWithPayment(url, {
      method: method ?? 'GET',
      headers: headers ?? {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    const responseBody = await response.text()

    // Record transaction if payment succeeded
    if (response.status === 200 && amount) {
      const paymentResponse = response.headers.get('payment-response')
      const txHash = paymentResponse ? (() => { try { return JSON.parse(atob(paymentResponse)).transaction ?? 'x402-unknown' } catch { return 'x402-unknown' } })() : 'x402-unknown'
      const amountNum = Number(amount)
      const amountUsd = mint ? amountNum * await getTokenPriceUsd(mint) : await solToUsd(amountNum)
      await recordTransaction(agent.id, {
        txHash,
        amount: amountNum,
        amountUsd,
        recipient: url,
        timestamp: new Date().toISOString(),
      }).catch(() => {}) // don't fail the response if recording fails
    }

    return c.json({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
    })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Fetch failed' }, 500)
  }
})

// POST /sdk/agent/fetch-paid-mpp — proxy a request through @solana/mpp client with Privy wallet
// Uses mppx.fetch() which handles the full 402 → sign → credential → retry flow.
sdk.post('/agent/fetch-paid-mpp', async (c) => {
  const agent = c.get('agent')
  const { url, method, headers: reqHeaders, amount, mint } = await c.req.json()

  if (!url) {
    return c.json({ error: 'url is required' }, 400)
  }

  try {
    const signer = createSolanaKitSigner(privyNode, {
      walletId: agent.walletId,
      address: toAddress(agent.walletAddress),
      caip2: DEVNET_CAIP2,
    })

    const mppx = Mppx.create({
      polyfill: false,
      methods: [
        solanaClient.charge({
          broadcast: true,
          signer,
          rpcUrl: 'https://api.devnet.solana.com',
        }),
      ],
    })

    const response = await mppx.fetch(url, {
      method: method ?? 'GET',
      headers: reqHeaders ?? {},
    })

    const responseBody = await response.text()
    if (response.status === 402) {
      console.error('[fetch-paid-mpp] Server still returned 402:', responseBody.slice(0, 500))
    }

    // Record transaction if payment succeeded
    if (response.status === 200 && amount) {
      const receipt = response.headers.get('payment-receipt')
      const txHash = receipt ? (() => { try { return JSON.parse(atob(receipt)).reference ?? 'mpp-unknown' } catch { return 'mpp-unknown' } })() : 'mpp-unknown'
      const amountNum = Number(amount)
      const amountUsd = mint ? amountNum * await getTokenPriceUsd(mint) : await solToUsd(amountNum)
      await recordTransaction(agent.id, {
        txHash,
        amount: amountNum,
        amountUsd,
        recipient: url,
        timestamp: new Date().toISOString(),
      }).catch(() => {})
    }

    return c.json({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
    })
  } catch (err: any) {
    console.error('[fetch-paid-mpp] Error:', err)
    return c.json({ error: err?.message ?? 'MPP payment failed' }, 500)
  }
})

// POST /sdk/agent/send — direct SOL or SPL token transfer from agent wallet
sdk.post('/agent/send', async (c) => {
  const agent = c.get('agent')
  const { to, amountSol, mint } = await c.req.json()

  if (!to || !amountSol || amountSol <= 0) {
    return c.json({ error: 'to and amountSol are required' }, 400)
  }

  // Policy: kill switch
  if (agent.policy?.killSwitch) {
    return c.json({ error: 'Kill switch is active — agent payments disabled' }, 403)
  }

  // Policy: maxPerTx (in USD)
  if (agent.policy?.maxPerTx !== null && agent.policy?.maxPerTx !== undefined) {
    const amountUsdEstimate = mint ? amountSol * await getTokenPriceUsd(mint) : await solToUsd(amountSol)
    if (amountUsdEstimate > agent.policy.maxPerTx) {
      return c.json({ error: `Exceeds max per transaction limit ($${agent.policy.maxPerTx})` }, 403)
    }
  }

  try {
    const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = await import('@solana/web3.js')

    const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
    const fromPubkey = new PublicKey(agent.walletAddress)
    const toPubkey = new PublicKey(to)
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')

    const tx = new Transaction()
    tx.recentBlockhash = blockhash
    tx.lastValidBlockHeight = lastValidBlockHeight
    tx.feePayer = fromPubkey
    tx.add(SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    }))

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
    return c.json({ error: err?.message ?? 'Send failed' }, 500)
  }
})

// POST /sdk/agent/record-spend — called by SDK after facilitator confirms payment
sdk.post('/agent/record-spend', async (c) => {
  const agent = c.get('agent')
  const { txHash, amount, payTo, mint } = await c.req.json()

  if (!txHash || !amount || !payTo) {
    return c.json({ error: 'txHash, amount, and payTo are required' }, 400)
  }

  const amountSol = Number(amount)
  const amountUsd = mint
    ? amountSol * await getTokenPriceUsd(mint)
    : await solToUsd(amountSol)

  await recordTransaction(agent.id, {
    txHash,
    amount: amountSol,
    amountUsd,
    recipient: payTo,
    timestamp: new Date().toISOString(),
  })

  return c.json({ ok: true, amountUsd })
})

export default sdk
