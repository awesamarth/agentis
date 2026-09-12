import { z } from 'zod'

// JSON amounts never pass through Number. Limits are atomic units of the wallet's
// configured asset, including the maximum network fee for native transfers.
export const atomic = z.string().regex(/^(0|[1-9]\d{0,77})$/)
export const positiveAtomic = atomic.refine(value => BigInt(value) > 0n, 'Must be positive')
export const chainId = z.string().regex(/^(eip155:[1-9]\d*|solana:[A-Za-z0-9]+)$/)
export const fetchRequest = z.object({
  walletId: z.string().uuid(), url: z.url().max(4096), maxAmountAtomic: positiveAtomic,
  maxFeeAtomic: positiveAtomic.optional(),
  reason: z.string().trim().max(500).default(''),
}).strict()
export type FetchRequest = z.input<typeof fetchRequest>
export const x402Payment = z.object({
  url: z.url().max(4096), maxAmountAtomic: positiveAtomic,
  requirements: z.object({
    scheme: z.literal('exact'), network: z.enum(['eip155:84532', 'eip155:5042002', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1']), asset: z.string(), amount: positiveAtomic,
    payTo: z.string(), maxTimeoutSeconds: z.number().int().min(15).max(120),
    extra: z.union([
      z.object({ name: z.literal('USDC'), version: z.literal('2') }).strict(),
      z.object({ feePayer: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/), memo: z.string().max(256).optional() }).strict(),
    ]),
  }).strict(),
}).strict()
export type PaidHttpResponse = { status: number; headers: Record<string, string>; bodyBase64: string }
export const operationInput = z.object({
  walletId: z.string().uuid(),
  action: z.enum(['transfer', 'paid_fetch']),
  payment: x402Payment.optional(),
  mpp: z.object({ url: z.url().max(4096), challenge: z.string().max(16384), maxAmountAtomic: positiveAtomic, expiresAt: z.iso.datetime() }).strict().optional(),
  chainId,
  asset: z.union([z.literal('native'), z.string().regex(/^(erc20:0x[0-9a-fA-F]{40}|spl:[1-9A-HJ-NP-Za-km-z]{32,44})$/)]),
  to: z.string().min(1).max(128),
  amountAtomic: positiveAtomic,
  maxFeeAtomic: atomic,
  reason: z.string().trim().max(500).default(''),
}).strict().refine(input => input.action === 'paid_fetch' ? (!!input.payment && !input.mpp && input.maxFeeAtomic === '0') || (!!input.mpp && !input.payment && BigInt(input.maxFeeAtomic) > 0n) : !input.payment && !input.mpp && BigInt(input.maxFeeAtomic) > 0n, 'Invalid payment action or fee cap')
export type OperationInput = z.input<typeof operationInput>

export const walletPolicy = z.object({
  mode: z.enum(['ask', 'automatic', 'paused']),
  budgetMode: z.enum(['atomic', 'usd']).optional(),
  maxPerOperationAtomic: atomic,
  maxDailyAtomic: atomic,
  maxLifetimeAtomic: atomic,
  allowedRecipients: z.array(z.string().min(1).max(128)).max(100),

  tokenLimits: z.record(z.string().regex(/^(erc20:0x[0-9a-fA-F]{40}|spl:[1-9A-HJ-NP-Za-km-z]{32,44})$/), z.object({ perOperation: atomic, daily: atomic, lifetime: atomic }).strict()).optional(),
}).strict()
export type WalletPolicy = z.infer<typeof walletPolicy>

export const usdLimits = z.object({
  perTransaction: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/).nullable(),
  hourly: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/).nullable(),
  daily: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/).nullable(),
  total: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/).nullable(),
}).strict()
export type UsdLimits = z.infer<typeof usdLimits>
export const pluginIds = z.array(z.enum(['uniswap'])).max(1)
export type PluginId = z.infer<typeof pluginIds>[number]
export const agentSettings = z.object({
  plugins: pluginIds.optional(),
  name: z.string().trim().min(1).max(80),
  limits: usdLimits,
  mode: z.enum(['ask', 'automatic', 'paused']),
  allowedRecipients: walletPolicy.shape.allowedRecipients,
}).strict()

export const grantInput = z.object({
  walletId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  chainIds: z.array(z.string().min(1).max(128)).min(1).max(32).refine(values => new Set(values).size === values.length, 'Duplicate networks').optional(),
  agentName: z.string().trim().min(1).max(80),
  expiresAt: z.iso.datetime().nullable().optional(),
}).strict().refine(input => Number(!!input.walletId) + Number(!!input.agentId) === 1, 'Choose either an agent or a wallet scope').refine(input => !input.chainIds || !!input.agentId, 'Network restrictions require an agent scope')
export type GrantInput = z.infer<typeof grantInput>
export const approvalInput = z.object({ operationHash: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().min(40).max(512).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional() }).strict()
export type AuthorizationRequest = { version: 1; method: 'POST'; url: string; headers: { 'privy-app-id': string; 'privy-idempotency-key': string; 'privy-request-expiry': string }; body: Record<string, unknown> }
export const operationStatuses = ['pending_approval', 'queued', 'submitting', 'submitted', 'unknown', 'confirmed', 'failed', 'denied', 'expired', 'rejected'] as const
export type OperationStatus = typeof operationStatuses[number]
export type UsdQuote = { assetPrice: string; feePrice: string; assetDecimals: number; feeDecimals: number; expiresAt: number }
export type Operation = OperationInput & {
  httpResponse?: PaidHttpResponse | null
  usdReservedMicros?: string | null
  usdSettledMicros?: string | null
  id: string
  status: OperationStatus
  operationHash: string
  policyVersion: number
  createdAt: string
  expiresAt: string
  approvalUrl: string | null
  transactionHash: string | null
  error: string | null
  receipt: { transactionHash: string; chainId: string; blockNumber: string; feeAtomic: string; success: boolean; feePayment?: { asset: string; amountAtomic: string; decimals: number } } | null
}
export const terminalStatuses = new Set<OperationStatus>(['confirmed', 'failed', 'denied', 'expired', 'rejected'])
