import type {
  MPPChallenge,
  X402Response,
  X402PaymentRequirements,
  PaymentDetails,
} from './types'
import { PaymentError } from './types'

const SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'

// Parse a 402 response — returns protocol type + payment info
export type ParsedPayment =
  | { protocol: 'mpp'; wwwAuthenticate: string; amount: number; currency: string; recipient: string }
  | { protocol: 'x402'; requirements: X402PaymentRequirements; x402Version: number }

/**
 * Detect MPP vs x402 from a 402 response.
 *
 * MPP: WWW-Authenticate: Payment id="...", realm="...", method="solana", intent="charge", request="<base64url>"
 * x402 v2: PAYMENT-REQUIRED header (base64 JSON)
 * x402 v1: body JSON with x402Version
 */
export function parse402(response: Response): ParsedPayment | null {
  const wwwAuth = response.headers.get('www-authenticate')
  if (wwwAuth && isMPPChallenge(wwwAuth)) {
    // Real MPP — extract amount from the request field for policy checks
    const { amount, currency, recipient } = parseMPPRequest(wwwAuth)
    return { protocol: 'mpp', wwwAuthenticate: wwwAuth, amount, currency, recipient }
  }

  return null
}

export async function parse402WithBody(response: Response): Promise<ParsedPayment | null> {
  // Try MPP header first
  const mpp = parse402(response)
  if (mpp) return mpp

  // Try x402 v2 — PAYMENT-REQUIRED header (base64 encoded JSON)
  const paymentRequired = response.headers.get('payment-required')
  if (paymentRequired) {
    try {
      const decoded = atob(paymentRequired)
      const body: X402Response = JSON.parse(decoded)
      if (body.x402Version !== undefined && body.accepts?.length > 0) {
        const solanaReq = body.accepts.find(
          a => a.network === SOLANA_DEVNET || a.network === SOLANA_MAINNET
        ) ?? body.accepts[0]!
        return { protocol: 'x402', requirements: solanaReq, x402Version: body.x402Version }
      }
    } catch {
      // not valid x402 v2
    }
  }

  // Try x402 v1 — body JSON
  try {
    const body: X402Response = await response.clone().json()
    if (body.x402Version !== undefined && body.accepts?.length > 0) {
      const solanaReq = body.accepts.find(
        a => a.network === SOLANA_DEVNET || a.network === SOLANA_MAINNET
      ) ?? body.accepts[0]!
      return { protocol: 'x402', requirements: solanaReq, x402Version: body.x402Version }
    }
  } catch {
    // not x402
  }

  return null
}

/**
 * Check if a WWW-Authenticate header is a real MPP challenge.
 * Real MPP format: Payment id="...", realm="...", method="...", intent="...", request="..."
 * (NOT a base64 blob — that was the old wrong format)
 */
function isMPPChallenge(wwwAuth: string): boolean {
  return /^Payment\s+id=/i.test(wwwAuth)
}

/**
 * Parse the request field from an MPP WWW-Authenticate header.
 * The request field is base64url-encoded JSON with amount, currency, recipient, etc.
 */
function parseMPPRequest(wwwAuth: string): { amount: number; currency: string; recipient: string } {
  // Extract the request="..." field
  const requestMatch = wwwAuth.match(/request="([^"]+)"/)
  if (!requestMatch?.[1]) {
    return { amount: 0, currency: 'unknown', recipient: '' }
  }

  try {
    const decoded = atob(requestMatch[1].replace(/-/g, '+').replace(/_/g, '/'))
    const req = JSON.parse(decoded)
    // amount is in atomic units (e.g. 1000 = $0.001 USDC with 6 decimals)
    const decimals = req.methodDetails?.decimals ?? 6
    const amount = parseInt(req.amount ?? '0', 10) / (10 ** decimals)
    return {
      amount,
      currency: req.currency ?? 'unknown',
      recipient: req.recipient ?? '',
    }
  } catch {
    return { amount: 0, currency: 'unknown', recipient: '' }
  }
}

// Parse amount from MPP challenge — kept for backwards compat
export function parseAmount(amountStr: string, currency: string): number {
  const num = parseFloat(amountStr.replace(/[^0-9.]/g, ''))
  return isNaN(num) ? 0 : num
}

// Build x402 X-PAYMENT header
// Calls backend sign endpoint — Privy wallet signs the payment transaction
export async function buildX402Payment(
  requirements: X402PaymentRequirements,
  x402Version: number,
  backendUrl: string,
  apiKey: string
): Promise<{ payment: string; amount: string; payTo: string }> {
  const res = await fetch(`${backendUrl}/sdk/agent/sign-payment`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ requirements, x402Version }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new PaymentError((err as any).error ?? 'Failed to sign payment')
  }
  const { payment, amount, payTo } = await res.json()
  return { payment, amount, payTo }
}

// Stablecoin mints — amount is already USD, no conversion needed
const STABLECOIN_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mainnet
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT mainnet
  '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH', // USDG mainnet
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC devnet (Circle faucet)
])

export const SOL_MINT = 'So11111111111111111111111111111111111111112'

export function isStablecoin(mint: string): boolean {
  return STABLECOIN_MINTS.has(mint)
}

export function tokenAmountFromRequirements(req: X402PaymentRequirements): number {
  // amount is in atomic token units (USDC = 6 decimals), v1 uses maxAmountRequired
  const units = parseInt(req.maxAmountRequired ?? req.amount ?? '0', 10)
  return units / 1e6
}
