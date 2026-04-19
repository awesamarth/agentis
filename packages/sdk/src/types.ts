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

export type MPPChallenge = {
  amount: string
  currency: string
  recipient: string
  sessionId?: string
  nonce?: string
  expiresAt?: string
}

export type X402PaymentRequirements = {
  scheme: string
  network: string
  maxAmountRequired: string
  resource: string
  description?: string
  mimeType?: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
}

export type X402Response = {
  x402Version: number
  accepts: X402PaymentRequirements[]
  error?: string
}
