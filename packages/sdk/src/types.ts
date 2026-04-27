// Re-export from core for SDK consumers
export type { Policy, AgentInfo, TxRecord, SpendRecord } from '@agentis/core'
export { AgentisError, KillSwitchError, PolicyError, InsufficientFundsError, PaymentError } from '@agentis/core'

// SDK-specific types
export type AgentisConfig = {
  apiKey: string
  baseUrl?: string
  autoEarn?: boolean
  onPayment?: (details: PaymentDetails) => void
  simulate?: boolean
}

export type PaymentDetails = {
  url: string
  amount: string
  currency: string
  recipient: string
  txHash?: string
  protocol: 'mpp' | 'x402'
}

export type UmbraAmountOptions = {
  mint?: string
  amount?: string | number | bigint
}

export type UmbraRegisterOptions = {
  confidential?: boolean
  anonymous?: boolean
}

export type UmbraCreateUtxoOptions = UmbraAmountOptions & {
  to?: string
}

export type UmbraResponse = Record<string, unknown>

export type MPPChallenge = {
  amount: string
  currency: string
  recipient: string
  sessionId?: string
  nonce?: string
  expiresAt?: string
}

// v1 format (body JSON)
export type X402PaymentRequirements = {
  scheme: string
  network: string
  maxAmountRequired?: string  // v1
  amount?: string             // v2
  resource?: string
  description?: string
  mimeType?: string
  payTo?: string              // v1
  maxTimeoutSeconds: number
  asset: string
  extra?: { feePayer?: string } // v2
}

export type X402Response = {
  x402Version: number
  accepts: X402PaymentRequirements[]
  error?: string
  resource?: { url: string; description?: string; mimeType?: string }
}
