// Payment discovery fixtures only; these types do not authorize payment execution.
export type X402PaymentRequirements = {
  scheme: string
  network: string
  maxAmountRequired?: string
  amount?: string
  resource?: string
  description?: string
  mimeType?: string
  payTo?: string
  maxTimeoutSeconds: number
  asset: string
  extra?: { feePayer?: string }
}
export type X402Response = {
  x402Version: number
  accepts: X402PaymentRequirements[]
  error?: string
  resource?: { url: string; description?: string; mimeType?: string }
}
