import type {
  X402Response,
  X402PaymentRequirements,
} from './types'
import { Challenge } from 'mppx'

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
    const request = parseMPPRequest(wwwAuth)
    if (!request) return null
    const { amount, currency, recipient } = request
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
      if (body.x402Version === 2 && body.accepts?.length > 0) {
        const solanaReq = supportedSolanaRequirement(body.accepts)
        if (!solanaReq) return null
        return { protocol: 'x402', requirements: solanaReq, x402Version: body.x402Version }
      }
    } catch {
      // not valid x402 v2
    }
  }

  // Try x402 v1 — body JSON
  try {
    const body: X402Response = await response.clone().json()
    if (body.x402Version === 1 && body.accepts?.length > 0) {
      const solanaReq = supportedSolanaRequirement(body.accepts)
      if (!solanaReq) return null
      return { protocol: 'x402', requirements: solanaReq, x402Version: body.x402Version }
    }
  } catch {
    // not x402
  }

  return null
}

function supportedSolanaRequirement(
  requirements: X402PaymentRequirements[]
): X402PaymentRequirements | undefined {
  return requirements.find(
    requirement => requirement.network === SOLANA_DEVNET || requirement.network === SOLANA_MAINNET
  )
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
function parseMPPRequest(
  wwwAuth: string
): { amount: number; currency: string; recipient: string } | null {
  try {
    const challenge = Challenge.deserialize(wwwAuth)
    if (challenge.method !== 'solana' || challenge.intent !== 'charge') return null
    if (challenge.expires && Date.parse(challenge.expires) <= Date.now()) return null

    const req = challenge.request as {
      amount?: string
      currency?: string
      recipient?: string
      methodDetails?: { decimals?: number }
    }
    // amount is in atomic units (e.g. 1000 = $0.001 USDC with 6 decimals)
    const decimals = req.methodDetails?.decimals ?? 6
    const atomicAmount = Number(req.amount)
    if (!Number.isSafeInteger(atomicAmount) || atomicAmount <= 0) return null
    if (!req.currency || !req.recipient) return null

    return {
      amount: atomicAmount / (10 ** decimals),
      currency: req.currency,
      recipient: req.recipient,
    }
  } catch {
    return null
  }
}

// Parse amount from MPP challenge — kept for backwards compat
export function parseAmount(amountStr: string, currency: string): number {
  const num = parseFloat(amountStr.replace(/[^0-9.]/g, ''))
  return isNaN(num) ? 0 : num
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
