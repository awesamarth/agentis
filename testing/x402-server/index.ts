import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { paymentMiddleware, x402ResourceServer } from '@x402/hono'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactSvmScheme } from '@x402/svm/exact/server'
import { facilitator } from '@payai/facilitator'

const app = new Hono()
const PORT = 4000
const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const PAY_TO = process.env.RECIPIENT_ADDRESS ?? '77rKFXbTbWQMXeQ97AYwThPcuh8sotTtz3jssRMRszGq'

app.use('*', logger())

const facilitatorClient = new HTTPFacilitatorClient(facilitator)

app.use(
  paymentMiddleware(
    {
      'GET /paid-data': {
        accepts: [{
          scheme: 'exact',
          price: '$0.001',
          network: DEVNET_NETWORK,
          payTo: PAY_TO,
        }],
        description: 'Secret alpha data',
        mimeType: 'application/json',
      },
      'GET /premium-data': {
        accepts: [{
          scheme: 'exact',
          price: '$0.005',
          network: DEVNET_NETWORK,
          payTo: PAY_TO,
        }],
        description: 'Premium analytics data',
        mimeType: 'application/json',
      },
      'POST /echo': {
        accepts: [{
          scheme: 'exact',
          price: '$0.001',
          network: DEVNET_NETWORK,
          payTo: PAY_TO,
        }],
        description: 'Paid POST echo',
        mimeType: 'application/json',
      },
      'PATCH /echo': {
        accepts: [{
          scheme: 'exact',
          price: '$0.001',
          network: DEVNET_NETWORK,
          payTo: PAY_TO,
        }],
        description: 'Paid PATCH echo',
        mimeType: 'application/json',
      },
    },
    new x402ResourceServer(facilitatorClient)
      .register(DEVNET_NETWORK, new ExactSvmScheme()),
  )
)

app.get('/', (c) => c.json({ status: 'ok', service: 'x402-test-server', port: PORT }))
app.get('/free', (c) => c.json({ message: 'This endpoint is free. No payment needed.' }))

app.get('/paid-data', (c) => c.json({
  message: 'you found the hidden treasure',
}))

app.get('/premium-data', (c) => c.json({
  data: {
    message: 'Premium data unlocked!',
    alphaCalls: ['Buy SOL', 'Ape into JUP', 'Stake with Jito'],
    confidence: '94%',
    timestamp: new Date().toISOString(),
  },
}))
app.post('/echo', async (c) => c.json({
  method: c.req.method,
  contentType: c.req.header('content-type'),
  body: await c.req.text(),
}, 201))
app.patch('/echo', async (c) => c.json({
  method: c.req.method,
  contentType: c.req.header('content-type'),
  body: await c.req.text(),
}, 202))

export default {
  port: PORT,
  fetch: app.fetch,
}

console.log(`x402 test server running on http://localhost:${PORT}`)
console.log(`  Recipient: ${PAY_TO}`)
console.log(`  Network: ${DEVNET_NETWORK}`)
console.log(`  GET /free         — no payment`)
console.log(`  GET /paid-data    — $0.001 USDC`)
console.log(`  GET /premium-data — $0.005 USDC`)
console.log(`  POST /echo        — $0.001 USDC`)
console.log(`  PATCH /echo       — $0.001 USDC`)
