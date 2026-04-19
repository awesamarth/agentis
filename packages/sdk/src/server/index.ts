/**
 * @agentis/sdk/server
 *
 * Server-side utilities — turn any endpoint into a paid endpoint.
 * Framework-agnostic core + Hono adapter (Next.js route handler compatible).
 */

export type PaywallConfig = {
  fee: number              // in SOL
  receiver: string         // Solana wallet address to receive payments
  network?: 'devnet' | 'mainnet'
  description?: string
}

export type PaywallHandler<Req = Request, Res = Response> = (req: Req) => Promise<Res> | Res

const NETWORKS = {
  devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
}

// Build MPP 402 challenge
function buildMPPChallenge(config: PaywallConfig): string {
  const challenge = {
    amount: String(config.fee),
    currency: 'SOL',
    recipient: config.receiver,
    nonce: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  }
  return btoa(JSON.stringify(challenge))
}

// Build x402 402 response body
function buildX402Body(config: PaywallConfig, resource: string) {
  const network = NETWORKS[config.network ?? 'devnet']
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network,
        maxAmountRequired: String(Math.round(config.fee * 1e9)), // lamports
        resource,
        description: config.description ?? 'Paid resource',
        mimeType: 'application/json',
        payTo: config.receiver,
        maxTimeoutSeconds: 300,
        asset: 'SOL',
      },
    ],
  }
}

// Verify MPP payment proof from Authorization header
// Returns true if valid (basic check — production should verify on-chain)
function verifyMPPPayment(authHeader: string): boolean {
  if (!authHeader.startsWith('Payment ')) return false
  try {
    const encoded = authHeader.slice('Payment '.length).trim()
    const decoded = atob(encoded)
    const proof = JSON.parse(decoded)
    // Basic structure check — challenge + signature present
    return !!(proof.challenge && proof.signature)
  } catch {
    return false
  }
}

// Verify x402 payment from X-PAYMENT header
// Delegates to facilitator (or basic check for now)
function verifyX402Payment(paymentHeader: string): boolean {
  // Basic presence check — full on-chain verification via facilitator in production
  return paymentHeader.length > 0
}

/**
 * Next.js / Web standard route handler wrapper.
 *
 * Usage:
 * ```ts
 * // app/api/data/route.ts
 * import { paywall } from '@agentis/sdk/server'
 *
 * export const GET = paywall({ fee: 0.001, receiver: 'YourWallet' }, async (req) => {
 *   return Response.json({ data: 'premium content' })
 * })
 * ```
 */
export function paywall(
  config: PaywallConfig,
  handler: (req: Request) => Promise<Response> | Response
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const authHeader = req.headers.get('authorization') ?? ''
    const x402Header = req.headers.get('x-payment') ?? ''

    const hasMPP = authHeader.startsWith('Payment ')
    const hasX402 = x402Header.length > 0

    // No payment — return 402
    if (!hasMPP && !hasX402) {
      const challenge = buildMPPChallenge(config)
      const x402Body = buildX402Body(config, req.url)

      return new Response(JSON.stringify(x402Body), {
        status: 402,
        headers: {
          'content-type': 'application/json',
          'www-authenticate': `Payment ${challenge}`,
          'access-control-expose-headers': 'www-authenticate',
        },
      })
    }

    // Verify payment
    if (hasMPP && !verifyMPPPayment(authHeader)) {
      return new Response(JSON.stringify({ error: 'Invalid payment proof' }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (hasX402 && !verifyX402Payment(x402Header)) {
      return new Response(JSON.stringify({ error: 'Invalid x402 payment' }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      })
    }

    // Payment valid — run handler
    const response = await handler(req)

    // Add payment receipt header
    const receipt = btoa(JSON.stringify({
      paid: config.fee,
      currency: 'SOL',
      receiver: config.receiver,
      timestamp: new Date().toISOString(),
    }))

    const headers = new Headers(response.headers)
    headers.set('payment-receipt', receipt)

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

/**
 * Next.js middleware-compatible paywall for protecting multiple routes.
 *
 * Usage in middleware.ts:
 * ```ts
 * import { paywallMiddleware } from '@agentis/sdk/server'
 * export default paywallMiddleware({
 *   fee: 0.001,
 *   receiver: 'YourWallet',
 *   matcher: ['/api/premium/:path*']
 * })
 * export const config = { matcher: ['/api/premium/:path*'] }
 * ```
 */
export function paywallMiddleware(config: PaywallConfig & { matcher?: string[] }) {
  return async (req: Request): Promise<Response | undefined> => {
    // If no matcher, protect everything
    // matcher is handled by Next.js config export — this just applies paywall logic
    const handler = paywall(config, async () => {
      // Passthrough — Next.js middleware calls NextResponse.next() instead
      return new Response(null, { status: 200 })
    })
    return handler(req)
  }
}

/**
 * Hono middleware adapter.
 *
 * Usage:
 * ```ts
 * import { honoPaywall } from '@agentis/sdk/server'
 * app.use('/api/data', honoPaywall({ fee: 0.001, receiver: 'YourWallet' }))
 * ```
 */
export function honoPaywall(config: PaywallConfig) {
  return async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header('authorization') ?? ''
    const x402Header = c.req.header('x-payment') ?? ''

    const hasMPP = authHeader.startsWith('Payment ')
    const hasX402 = x402Header.length > 0

    if (!hasMPP && !hasX402) {
      const challenge = buildMPPChallenge(config)
      const x402Body = buildX402Body(config, c.req.url)
      c.header('www-authenticate', `Payment ${challenge}`)
      c.header('access-control-expose-headers', 'www-authenticate')
      return c.json(x402Body, 402)
    }

    if (hasMPP && !verifyMPPPayment(authHeader)) {
      return c.json({ error: 'Invalid payment proof' }, 402)
    }

    await next()

    // Add receipt
    const receipt = btoa(JSON.stringify({
      paid: config.fee,
      currency: 'SOL',
      receiver: config.receiver,
      timestamp: new Date().toISOString(),
    }))
    c.header('payment-receipt', receipt)
  }
}
