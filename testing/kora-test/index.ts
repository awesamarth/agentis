import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { paymentMiddleware, x402ResourceServer } from '@x402/hono'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactSvmScheme } from '@x402/svm/exact/server'

const app = new Hono()

const PORT = Number(process.env.PORT ?? 4002)
const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const PAY_TO = process.env.RECIPIENT_ADDRESS ?? '77rKFXbTbWQMXeQ97AYwThPcuh8sotTtz3jssRMRszGq'
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:3997'

app.use('*', logger())

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL })

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
        description: 'Kora-backed x402 test data',
        mimeType: 'application/json',
      },
      'GET /premium-data': {
        accepts: [{
          scheme: 'exact',
          price: '$0.005',
          network: DEVNET_NETWORK,
          payTo: PAY_TO,
        }],
        description: 'Kora-backed premium test data',
        mimeType: 'application/json',
      },
    },
    new x402ResourceServer(facilitatorClient)
      .register(DEVNET_NETWORK, new ExactSvmScheme()),
  )
)

app.get('/', (c) => c.json({
  status: 'ok',
  service: 'kora-x402-test-server',
  port: PORT,
  facilitator: FACILITATOR_URL,
  recipient: PAY_TO,
}))

app.get('/free', (c) => c.json({ message: 'This endpoint is free. No payment needed.' }))

app.get('/paid-data', (c) => c.json({
  data: {
    message: 'Kora-backed x402 payment succeeded.',
    price: '$0.001',
    timestamp: new Date().toISOString(),
  },
}))

app.get('/premium-data', (c) => c.json({
  data: {
    message: 'Kora-backed premium x402 payment succeeded.',
    price: '$0.005',
    timestamp: new Date().toISOString(),
  },
}))

export default {
  port: PORT,
  fetch: app.fetch,
}

console.log(`Kora x402 test server running on http://localhost:${PORT}`)
console.log(`  Recipient:   ${PAY_TO}`)
console.log(`  Facilitator: ${FACILITATOR_URL}`)
console.log(`  Network:     ${DEVNET_NETWORK}`)
console.log(`  GET /free         — no payment`)
console.log(`  GET /paid-data    — $0.001 USDC`)
console.log(`  GET /premium-data — $0.005 USDC`)
