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
  | { protocol: 'mpp'; challenge: MPPChallenge; raw: string }
  | { protocol: 'x402'; requirements: X402PaymentRequirements }

export function parse402(response: Response): ParsedPayment | null {
  // MPP: WWW-Authenticate: Payment <base64url>
  const wwwAuth = response.headers.get('www-authenticate')
  if (wwwAuth?.startsWith('Payment ')) {
    const encoded = wwwAuth.slice('Payment '.length).trim()
    try {
      const decoded = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
      const challenge: MPPChallenge = JSON.parse(decoded)
      return { protocol: 'mpp', challenge, raw: encoded }
    } catch {
      throw new PaymentError('Failed to parse MPP payment challenge')
    }
  }

  // x402: response body is JSON with x402Version
  // caller must pass pre-parsed body since Response body can only be read once
  return null
}

export async function parse402WithBody(response: Response): Promise<ParsedPayment | null> {
  // Try MPP header first
  const mpp = parse402(response)
  if (mpp) return mpp

  // Try x402 body
  try {
    const body: X402Response = await response.clone().json()
    if (body.x402Version !== undefined && body.accepts?.length > 0) {
      // Pick Solana network preference
      const solanaReq = body.accepts.find(
        a => a.network === SOLANA_DEVNET || a.network === SOLANA_MAINNET
      ) ?? body.accepts[0]!
      return { protocol: 'x402', requirements: solanaReq }
    }
  } catch {
    // not x402
  }

  return null
}

// Parse amount from MPP challenge — returns SOL amount
// MPP amount is typically in USD string like "$0.001" or raw token amount
export function parseAmount(amountStr: string, currency: string): number {
  // USD-denominated — approximate SOL conversion (SDK caller should handle)
  // For now return raw numeric value and let caller decide
  const num = parseFloat(amountStr.replace(/[^0-9.]/g, ''))
  return isNaN(num) ? 0 : num
}

// Build MPP Authorization header value
// For Solana: sign the challenge with wallet, return base64url encoded proof
export async function buildMPPPayment(
  challenge: MPPChallenge,
  rawChallenge: string,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  const encoder = new TextEncoder()
  const msgBytes = encoder.encode(`agentis-payment:${rawChallenge}`)
  const signature = await signMessage(msgBytes)
  const sigBase64 = btoa(String.fromCharCode(...signature))
  const proof = JSON.stringify({
    challenge: rawChallenge,
    signature: sigBase64,
    timestamp: new Date().toISOString(),
  })
  return btoa(proof)
}

// Build x402 X-PAYMENT header
// Calls backend sign endpoint — Privy wallet signs the payment transaction
export async function buildX402Payment(
  requirements: X402PaymentRequirements,
  backendUrl: string,
  apiKey: string
): Promise<{ payment: string; lamports: number; payTo: string }> {
  const res = await fetch(`${backendUrl}/sdk/agent/sign-payment`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ requirements }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new PaymentError((err as any).error ?? 'Failed to sign payment')
  }
  const { payment, lamports, payTo } = await res.json()
  return { payment, lamports, payTo }
}

export function solAmountFromRequirements(req: X402PaymentRequirements): number {
  // maxAmountRequired is in lamports (atomic units)
  const lamports = parseInt(req.maxAmountRequired, 10)
  return lamports / 1e9
}
