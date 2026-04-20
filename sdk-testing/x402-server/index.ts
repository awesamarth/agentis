import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'

const app = new Hono()

const PORT = 4000

// Devnet CAIP2
const SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'

// Burn address — receives test payments
const PAY_TO = '5yDpyuSofQARocCtzkrHaEeRjSBTuYTPPna1aeZjqUB6'

// 0.001 SOL in lamports
const PRICE_LAMPORTS = 1_000_000

app.use('*', logger())
app.use('*', cors())

app.get('/', (c) => c.json({ status: 'ok', service: 'x402-test-server', port: PORT }))

// Free endpoint — sanity check
app.get('/free', (c) => c.json({ message: 'This endpoint is free. No payment needed.' }))

// Paid endpoint — requires x402 payment
app.get('/paid-data', async (c) => {
  const payment = c.req.header('x-payment')

  if (!payment) {
    // Return 402 with payment requirements
    return c.json(
      {
        x402Version: 1,
        accepts: [
          {
            scheme: 'exact',
            network: SOLANA_DEVNET,
            maxAmountRequired: String(PRICE_LAMPORTS),
            resource: `http://localhost:${PORT}/paid-data`,
            description: 'Access to secret alpha data',
            mimeType: 'application/json',
            payTo: PAY_TO,
            maxTimeoutSeconds: 60,
            asset: 'SOL',
          },
        ],
        error: 'Payment required',
      },
      402
    )
  }

  // Payment header present — verify it's a valid base64 signed tx
  // In production you'd submit this to chain and verify confirmation
  // For testing: we trust the SDK sent a real signed tx and return success
  let txHash = 'simulated-' + Math.random().toString(36).slice(2)

  try {
    // Try to decode — if it's not valid base64 reject it
    const decoded = Buffer.from(payment, 'base64')
    if (decoded.length < 64) throw new Error('Too short to be a real tx')
    // In a real facilitator: submit decoded tx to RPC, get real hash
    txHash = 'verified-' + decoded.slice(0, 4).toString('hex') + '...'
  } catch {
    return c.json({ error: 'Invalid payment header' }, 400)
  }

  // Return the paid response — include transaction field (SDK uses this to record spend)
  return c.json({
    transaction: txHash,
    payer: 'agent-wallet',
    data: {
      message: 'You unlocked secret alpha data!',
      solanaPrice: '$142.00',
      topDEX: 'Raydium',
      volume24h: '$1.2B',
      timestamp: new Date().toISOString(),
    },
  })
})

// Another paid endpoint at higher price
app.get('/premium-data', async (c) => {
  const payment = c.req.header('x-payment')

  if (!payment) {
    return c.json(
      {
        x402Version: 1,
        accepts: [
          {
            scheme: 'exact',
            network: SOLANA_DEVNET,
            maxAmountRequired: String(5_000_000), // 0.005 SOL
            resource: `http://localhost:${PORT}/premium-data`,
            description: 'Premium analytics data',
            mimeType: 'application/json',
            payTo: PAY_TO,
            maxTimeoutSeconds: 60,
            asset: 'SOL',
          },
        ],
        error: 'Payment required',
      },
      402
    )
  }

  try {
    const decoded = Buffer.from(payment, 'base64')
    if (decoded.length < 64) throw new Error('Too short')
  } catch {
    return c.json({ error: 'Invalid payment header' }, 400)
  }

  return c.json({
    transaction: 'premium-' + Math.random().toString(36).slice(2),
    payer: 'agent-wallet',
    data: {
      message: 'Premium data unlocked!',
      alphaCalls: ['Buy SOL', 'Ape into JUP', 'Stake with Jito'],
      confidence: '94%',
      timestamp: new Date().toISOString(),
    },
  })
})

export default {
  port: PORT,
  fetch: app.fetch,
}

console.log(`x402 test server running on http://localhost:${PORT}`)
console.log(`  GET /free        — no payment needed`)
console.log(`  GET /paid-data   — costs 0.001 SOL`)
console.log(`  GET /premium-data — costs 0.005 SOL`)
