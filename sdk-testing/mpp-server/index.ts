/**
 * MPP Test Server — Solana
 *
 * Uses @solana/mpp + mppx for proper MPP protocol:
 *   402 → WWW-Authenticate: Payment id="...", realm="...", method="solana", intent="charge", request="..."
 *   Client sends → Authorization: Payment <base64url credential>
 *   Server verifies on-chain → 200 + Payment-Receipt header
 *
 * Port: 4001
 */

import { Mppx, solana } from '@solana/mpp/server'
import crypto from 'crypto'

const PORT = 4001
const RECIPIENT = process.env.RECIPIENT_ADDRESS ?? '77rKFXbTbWQMXeQ97AYwThPcuh8sotTtz3jssRMRszGq'
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' // devnet USDC (Circle faucet)
const SECRET_KEY = process.env.MPP_SECRET_KEY ?? crypto.randomBytes(32).toString('base64')

const mppx = Mppx.create({
  secretKey: SECRET_KEY,
  realm: 'mpp-test-server',
  methods: [
    solana.charge({
      recipient: RECIPIENT,
      currency: USDC_DEVNET,
      decimals: 6,
      network: 'devnet',
    }),
  ],
})

// Minimal Hono-like server using Bun.serve directly
// mppx handlers work with standard Request/Response

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if (path === '/' || path === '') {
    return Response.json({ status: 'ok', service: 'mpp-test-server', port: PORT })
  }

  if (path === '/free') {
    return Response.json({ message: 'This endpoint is free. No payment needed.' })
  }

  if (path === '/mpp-data') {
    const result = await mppx.charge({
      amount: '1000', // 1000 atomic units = $0.001 USDC (6 decimals)
    })(request)

    if (result.status === 402) return result.challenge as Response

    return result.withReceipt(
      Response.json({
        data: {
          message: 'MPP payment verified! Alpha data unlocked.',
          solanaPrice: '$142.00',
          topDEX: 'Raydium',
          volume24h: '$1.2B',
          timestamp: new Date().toISOString(),
        },
      })
    )
  }

  if (path === '/mpp-premium') {
    const result = await mppx.charge({
      amount: '5000', // 5000 atomic units = $0.005 USDC
    })(request)

    if (result.status === 402) return result.challenge as Response

    return result.withReceipt(
      Response.json({
        data: {
          message: 'MPP premium data unlocked!',
          alphaCalls: ['Buy SOL', 'Ape into JUP', 'Stake with Jito'],
          confidence: '94%',
          timestamp: new Date().toISOString(),
        },
      })
    )
  }

  return Response.json({ error: 'Not found' }, { status: 404 })
}

export default {
  port: PORT,
  fetch: handler,
}

console.log(`MPP test server running on http://localhost:${PORT}`)
console.log(`  Recipient: ${RECIPIENT}`)
console.log(`  Currency:  ${USDC_DEVNET} (devnet USDC)`)
console.log(`  Network:   devnet`)
console.log(`  GET /free         — no payment`)
console.log(`  GET /mpp-data     — $0.001 USDC (MPP solana/charge)`)
console.log(`  GET /mpp-premium  — $0.005 USDC (MPP solana/charge)`)
