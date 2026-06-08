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
import {
  createCheckAndRecordSpendInstruction,
  createUpdatePolicyInstruction,
  confirmTransactionOrThrow,
  formatSolanaTransactionError,
  preparePrivyTransaction,
} from '../lib/onchain-policy'
import {
  atomicToUi as jupiterAtomicToUi,
  cancelRecurringOrder,
  createRecurringOrder,
  enforceJupiterPolicy,
  executeSwap,
  getJupiterPortfolio,
  getRecurringOrders,
  getSwapQuote,
  resolveJupiterToken,
  searchJupiterTokens,
  uiAmountToAtomic as jupiterUiAmountToAtomic,
  validateTradeTokens,
} from '../lib/jupiter'

const DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const BODYLESS_METHODS = new Set(['GET', 'HEAD'])

// @privy-io/node client for x402 signing
const privyNode = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
})

type Agent = Awaited<ReturnType<typeof getAgentByApiKey>>

const sdk = new Hono<{ Variables: { agent: NonNullable<Agent> } }>()

function paidFetchInit(input: {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  bodyBase64?: string
}): RequestInit {
  const method = (input.method ?? 'GET').toUpperCase()
  const headers = new Headers(input.headers ?? {})
  headers.delete('host')
  headers.delete('content-length')

  let body: BodyInit | undefined
  if (!BODYLESS_METHODS.has(method)) {
    if (typeof input.bodyBase64 === 'string') {
      body = Buffer.from(input.bodyBase64, 'base64')
    } else if (typeof input.body === 'string') {
      body = input.body
    } else if (input.body !== undefined) {
      body = JSON.stringify(input.body)
    }
  }

  return { method, headers, ...(body !== undefined ? { body } : {}) }
}

async function serializePaidResponse(response: Response) {
  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: bytes.toString('utf8'),
    bodyBase64: bytes.toString('base64'),
  }
}

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
    privacyEnabled: agent.privacyEnabled ?? false,
    umbraStatus: agent.umbraStatus ?? (agent.privacyEnabled ? 'pending' : 'disabled'),
    umbraRegisteredAt: agent.umbraRegisteredAt,
    policyMode: agent.policyMode ?? 'backend',
    onchainPolicy: agent.onchainPolicy,
    policy: agent.policy ?? {
      hourlyLimit: null,
      dailyLimit: null,
      monthlyLimit: null,
      maxBudget: null,
      maxPerTx: null,
      allowedDomains: [],
      allowedMints: [],
      maxSlippageBps: null,
      maxDailySwapVolume: null,
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
  const allowedFields = [
    'hourlyLimit', 'dailyLimit', 'monthlyLimit', 'maxBudget', 'maxPerTx',
    'allowedDomains', 'allowedMints', 'maxSlippageBps', 'maxDailySwapVolume', 'killSwitch',
  ]
  const safePolicy: any = { ...(agent.policy ?? {}) }
  for (const key of allowedFields) {
    if (patch[key] !== undefined) safePolicy[key] = patch[key]
  }

  const updatePatch: any = { policy: safePolicy }
  if (agent.policyMode === 'onchain' && agent.onchainPolicy?.initialized) {
    try {
      const { Connection, Transaction } = await import('@solana/web3.js')
      const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
      const tx = await preparePrivyTransaction(
        connection,
        agent.walletAddress,
        new Transaction().add(createUpdatePolicyInstruction(agent, safePolicy)),
      )
      const result = await privy.walletApi.solana.signAndSendTransaction({
        walletId: agent.walletId,
        transaction: tx,
        caip2: DEVNET_CAIP2,
      })
      await confirmTransactionOrThrow(connection, result.hash, tx)
      updatePatch.onchainPolicy = {
        ...agent.onchainPolicy,
        lastPolicySignature: result.hash,
      }
    } catch (err) {
      return c.json({ error: formatSolanaTransactionError(err) }, 500)
    }
  }

  const updated = await updateAgent(agent.id, updatePatch)
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
  const { url, method, headers, body, bodyBase64, amount, mint } = await c.req.json()

  if (!url) {
    return c.json({ error: 'url is required' }, 400)
  }

  try {
    const x402client = createX402Client(privyNode, {
      walletId: agent.walletId,
      address: agent.walletAddress,
    })

    const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, x402client)

    const response = await fetchWithPayment(url, paidFetchInit({
      method,
      headers,
      body,
      bodyBase64,
    }))

    // Record transaction if payment succeeded
    if (response.ok && amount) {
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

    return c.json(await serializePaidResponse(response))
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Fetch failed' }, 500)
  }
})

// POST /sdk/agent/fetch-paid-mpp — proxy a request through @solana/mpp client with Privy wallet
// Uses mppx.fetch() which handles the full 402 → sign → credential → retry flow.
sdk.post('/agent/fetch-paid-mpp', async (c) => {
  const agent = c.get('agent')
  const { url, method, headers: reqHeaders, body, bodyBase64, amount, mint } = await c.req.json()

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

    const response = await mppx.fetch(url, paidFetchInit({
      method,
      headers: reqHeaders,
      body,
      bodyBase64,
    }))

    if (response.status === 402) {
      console.error('[fetch-paid-mpp] Server still returned 402')
    }

    // Record transaction if payment succeeded
    if (response.ok && amount) {
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

    return c.json(await serializePaidResponse(response))
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

  const amountUsdEstimate = mint ? amountSol * await getTokenPriceUsd(mint) : await solToUsd(amountSol)

  if (agent.policyMode === 'onchain') {
    if (!agent.onchainPolicy?.initialized) {
      return c.json({ error: 'On-chain policy is not initialized. Fund the agent wallet, then initialize policy.' }, 403)
    }
  } else {
    // Policy: kill switch
    if (agent.policy?.killSwitch) {
      return c.json({ error: 'Kill switch is active — agent payments disabled' }, 403)
    }

    // Policy: maxPerTx (in USD)
    if (agent.policy?.maxPerTx !== null && agent.policy?.maxPerTx !== undefined && amountUsdEstimate > agent.policy.maxPerTx) {
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
    if (agent.policyMode === 'onchain') {
      tx.add(createCheckAndRecordSpendInstruction(agent, amountUsdEstimate))
    }
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
    await confirmTransactionOrThrow(connection, result.hash, tx)

    await recordTransaction(agent.id, {
      txHash: result.hash,
      amount: amountSol,
      amountUsd: amountUsdEstimate,
      recipient: to,
      timestamp: new Date().toISOString(),
    })

    return c.json({ signature: result.hash })
  } catch (err) {
    return c.json({ error: formatSolanaTransactionError(err) }, 500)
  }
})

async function prepareSdkJupiterTrade(agent: any, body: any, action: 'swap' | 'recurring') {
  const [inputToken, outputToken] = await Promise.all([
    resolveJupiterToken(String(body.input ?? body.inputMint ?? '')),
    resolveJupiterToken(String(body.output ?? body.outputMint ?? '')),
  ])
  validateTradeTokens(inputToken, outputToken)
  const amountAtomic = jupiterUiAmountToAtomic(body.amount, inputToken.decimals)
  const amountUi = Number(jupiterAtomicToUi(amountAtomic, inputToken.decimals))
  const requestedSlippage = body.slippageBps === undefined ? undefined : Number(body.slippageBps)
  if (requestedSlippage !== undefined && (!Number.isInteger(requestedSlippage) || requestedSlippage < 1 || requestedSlippage > 10_000)) {
    throw new Error('slippageBps must be an integer from 1 to 10000')
  }
  const slippageBps = requestedSlippage
  const { amountUsd } = await enforceJupiterPolicy({
    agent, inputToken, outputToken, inputAmountUi: amountUi, slippageBps, action,
  })
  return { inputToken, outputToken, amountAtomic, amountUi, amountUsd, slippageBps }
}

sdk.get('/agent/jupiter/tokens', async (c) => {
  try {
    return c.json({ tokens: await searchJupiterTokens(c.req.query('query') ?? '') })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Token search failed' }, 400)
  }
})

sdk.post('/agent/jupiter/swap/quote', async (c) => {
  try {
    const trade = await prepareSdkJupiterTrade(c.get('agent'), await c.req.json(), 'swap')
    return c.json({ ...trade, quote: await getSwapQuote(trade) })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Swap quote failed' }, 400)
  }
})

sdk.post('/agent/jupiter/swap', async (c) => {
  const agent = c.get('agent')
  try {
    const trade = await prepareSdkJupiterTrade(agent, await c.req.json(), 'swap')
    const executed = await executeSwap(privyNode, agent, trade)
    await recordTransaction(agent.id, {
      txHash: executed.result.signature,
      amount: trade.amountUi,
      amountUsd: trade.amountUsd,
      recipient: `jupiter-swap:${trade.inputToken.id}:${trade.outputToken.id}`,
      timestamp: new Date().toISOString(),
    })
    return c.json({ ...trade, ...executed })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Swap failed' }, 400)
  }
})

sdk.get('/agent/jupiter/portfolio', async (c) => {
  const agent = c.get('agent')
  try {
    return c.json({
      network: 'mainnet',
      walletAddress: agent.walletAddress,
      portfolio: await getJupiterPortfolio(agent.walletAddress, c.req.query('platforms')),
    })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Portfolio failed' }, 500)
  }
})

sdk.get('/agent/jupiter/recurring', async (c) => {
  const agent = c.get('agent')
  const status = c.req.query('status') === 'history' ? 'history' : 'active'
  try {
    return c.json({
      network: 'mainnet',
      walletAddress: agent.walletAddress,
      status,
      orders: await getRecurringOrders(agent.walletAddress, {
        status,
        page: Number(c.req.query('page') ?? 1),
      }),
    })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Recurring orders failed' }, 500)
  }
})

sdk.post('/agent/jupiter/recurring', async (c) => {
  const agent = c.get('agent')
  try {
    const body = await c.req.json()
    const trade = await prepareSdkJupiterTrade(agent, body, 'recurring')
    const numberOfOrders = Number(body.numberOfOrders)
    const intervalSeconds = Number(body.intervalSeconds)
    if (!Number.isInteger(numberOfOrders) || numberOfOrders < 2) throw new Error('numberOfOrders must be at least 2')
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60) throw new Error('intervalSeconds must be at least 60')
    if (trade.amountUsd < 100) throw new Error('Jupiter recurring orders require at least $100 total value')
    if (trade.amountUsd / numberOfOrders < 50) throw new Error('Each Jupiter recurring cycle must be worth at least $50')
    const created = await createRecurringOrder(privyNode, agent, {
      ...trade,
      numberOfOrders,
      intervalSeconds,
      minPrice: body.minPrice === undefined ? null : Number(body.minPrice),
      maxPrice: body.maxPrice === undefined ? null : Number(body.maxPrice),
      startAt: body.startAt === undefined ? null : Number(body.startAt),
    })
    await recordTransaction(agent.id, {
      txHash: created.result.signature,
      amount: trade.amountUi,
      amountUsd: trade.amountUsd,
      recipient: `jupiter-recurring:${trade.inputToken.id}:${trade.outputToken.id}`,
      timestamp: new Date().toISOString(),
    })
    return c.json({ ...trade, ...created })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Recurring order failed' }, 400)
  }
})

sdk.post('/agent/jupiter/recurring/:order/cancel', async (c) => {
  try {
    return c.json(await cancelRecurringOrder(privyNode, c.get('agent'), c.req.param('order')))
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Recurring cancellation failed' }, 400)
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
