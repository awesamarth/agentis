import { PrivyClient } from '@privy-io/node'
import { checkPolicy, type Policy, type SpendRecord } from '@agentis-hq/core'
import { getTokenPriceUsd } from './price'

export const SOL_MAINNET_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const USDT_MAINNET_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

const SWAP_API = 'https://api.jup.ag/swap/v2'
const TOKENS_API = 'https://api.jup.ag/tokens/v2'
const PORTFOLIO_API = 'https://api.jup.ag/portfolio/v1'
const RECURRING_API = 'https://api.jup.ag/recurring/v1'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const API_TIMEOUT_MS = 12_000

export type JupiterAgent = {
  id: string
  walletId: string
  walletAddress: string
  policy?: Policy
  transactions?: Array<{
    amount?: number
    amountUsd?: number
    recipient?: string
    timestamp: string
  }>
}

export type JupiterToken = {
  id: string
  name?: string
  symbol?: string
  icon?: string
  decimals: number
  tokenProgram?: string
  isVerified?: boolean | null
  organicScore?: number
  organicScoreLabel?: 'high' | 'medium' | 'low'
  liquidity?: number
  usdPrice?: number
  tags?: string[]
  audit?: {
    isSus?: boolean
    mintAuthorityDisabled?: boolean
    freezeAuthorityDisabled?: boolean
    topHoldersPercentage?: number
    devBalancePercentage?: number
  }
}

const KNOWN_TOKENS: Record<string, JupiterToken> = {
  SOL: { id: SOL_MAINNET_MINT, name: 'Wrapped SOL', symbol: 'SOL', decimals: 9, tokenProgram: TOKEN_PROGRAM, isVerified: true },
  USDC: { id: USDC_MAINNET_MINT, name: 'USD Coin', symbol: 'USDC', decimals: 6, tokenProgram: TOKEN_PROGRAM, isVerified: true },
  USDT: { id: USDT_MAINNET_MINT, name: 'Tether USD', symbol: 'USDT', decimals: 6, tokenProgram: TOKEN_PROGRAM, isVerified: true },
}

function headers(json = false): Record<string, string> {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    ...(process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {}),
  }
}

async function jupiterFetch(url: string | URL, init: RequestInit = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  const response = await fetch(url, {
    ...init,
    signal: controller.signal,
    headers: { ...headers(Boolean(init.body)), ...(init.headers as Record<string, string> | undefined) },
  }).finally(() => clearTimeout(timeout))
  const text = await response.text()
  const body = text ? (() => {
    try {
      return JSON.parse(text)
    } catch {
      return { message: text }
    }
  })() : {}
  if (!response.ok) {
    throw new Error(body?.error ?? body?.message ?? body?.status ?? `Jupiter request failed (${response.status})`)
  }
  return body
}

export function uiAmountToAtomic(amount: unknown, decimals: number): string {
  const raw = String(amount ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error('amount must be a positive decimal value')
  const [whole = '0', fraction = ''] = raw.split('.')
  if (fraction.length > decimals) throw new Error(`amount supports at most ${decimals} decimal places`)
  const atomic = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
  if (atomic <= 0n) throw new Error('amount must be greater than zero')
  return atomic.toString()
}

export function atomicToUi(amount: unknown, decimals: number): string {
  const atomic = BigInt(String(amount ?? '0'))
  const base = 10n ** BigInt(decimals)
  const whole = atomic / base
  const fraction = atomic % base
  return fraction === 0n
    ? whole.toString()
    : `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

export async function searchJupiterTokens(query: string): Promise<JupiterToken[]> {
  const normalized = query.trim()
  if (!normalized) throw new Error('token query is required')
  const known = KNOWN_TOKENS[normalized.toUpperCase()]
  if (known) return [known]
  const url = new URL(`${TOKENS_API}/search`)
  url.searchParams.set('query', normalized)
  const result = await jupiterFetch(url)
  return Array.isArray(result) ? result : []
}

export async function resolveJupiterToken(query: string): Promise<JupiterToken> {
  const normalized = query.trim()
  const known = KNOWN_TOKENS[normalized.toUpperCase()]
  if (known) return known
  const results = await searchJupiterTokens(normalized)
  const lower = normalized.toLowerCase()
  const token = results.find(item => item.id === normalized)
    ?? results.find(item => item.symbol?.toLowerCase() === lower && item.isVerified)
    ?? results.find(item => item.name?.toLowerCase() === lower && item.isVerified)
    ?? results[0]
  if (!token?.id || !Number.isInteger(token.decimals)) throw new Error(`Token not found: ${query}`)
  return token
}

function assertSafeToken(token: JupiterToken) {
  if (token.audit?.isSus) throw new Error(`${token.symbol ?? token.id} is flagged as suspicious by Jupiter`)
  if (token.tags?.includes('banned')) throw new Error(`${token.symbol ?? token.id} is banned by Jupiter`)
}

function assertRecurringToken(token: JupiterToken) {
  assertSafeToken(token)
  if (token.tokenProgram && token.tokenProgram !== TOKEN_PROGRAM) {
    throw new Error(`${token.symbol ?? token.id} uses Token-2022, which is not supported for Agentis recurring orders`)
  }
}

function spendHistory(agent: JupiterAgent): SpendRecord[] {
  return (agent.transactions ?? []).map(transaction => ({
    amount: transaction.amountUsd ?? transaction.amount ?? 0,
    timestamp: transaction.timestamp,
    url: transaction.recipient ?? 'jupiter',
  }))
}

export async function enforceJupiterPolicy(input: {
  agent: JupiterAgent
  inputToken: JupiterToken
  outputToken: JupiterToken
  inputAmountUi: number
  slippageBps?: number
  action: 'swap' | 'recurring'
}) {
  const policy = input.agent.policy
  if (!policy) return { amountUsd: 0 }
  const allowedMints = policy.allowedMints ?? []
  if (allowedMints.length > 0) {
    for (const token of [input.inputToken, input.outputToken]) {
      if (!allowedMints.includes(token.id)) {
        throw new Error(`Token is not allowed by policy: ${token.symbol ?? token.id}`)
      }
    }
  }
  if (
    input.slippageBps !== undefined &&
    policy.maxSlippageBps !== null &&
    policy.maxSlippageBps !== undefined &&
    input.slippageBps > policy.maxSlippageBps
  ) {
    throw new Error(`Exceeds max slippage policy (${policy.maxSlippageBps} bps)`)
  }

  const price = input.inputToken.usdPrice ?? await getTokenPriceUsd(input.inputToken.id)
  if (!Number.isFinite(price) || price <= 0) throw new Error(`No USD price available for ${input.inputToken.symbol ?? input.inputToken.id}`)
  const amountUsd = input.inputAmountUi * price
  checkPolicy(
    { ...policy, allowedDomains: [] },
    amountUsd,
    `https://jup.ag/${input.action}`,
    spendHistory(input.agent),
  )

  if (policy.maxDailySwapVolume !== null && policy.maxDailySwapVolume !== undefined) {
    const since = Date.now() - 24 * 60 * 60 * 1000
    const daily = (input.agent.transactions ?? [])
      .filter(transaction =>
        new Date(transaction.timestamp).getTime() >= since &&
        /^jupiter-(swap|recurring):/.test(transaction.recipient ?? '')
      )
      .reduce((sum, transaction) => sum + (transaction.amountUsd ?? 0), 0)
    if (daily + amountUsd > policy.maxDailySwapVolume) {
      throw new Error(`Exceeds daily swap volume policy ($${policy.maxDailySwapVolume})`)
    }
  }
  return { amountUsd }
}

async function signJupiterTransaction(privyNode: PrivyClient, agent: JupiterAgent, transaction: string) {
  const signed = await privyNode.wallets().solana().signTransaction(agent.walletId, { transaction })
  return signed.signed_transaction
}

export async function getSwapQuote(input: {
  inputToken: JupiterToken
  outputToken: JupiterToken
  amountAtomic: string
  taker?: string
  slippageBps?: number
}) {
  const url = new URL(`${SWAP_API}/order`)
  url.searchParams.set('inputMint', input.inputToken.id)
  url.searchParams.set('outputMint', input.outputToken.id)
  url.searchParams.set('amount', input.amountAtomic)
  if (input.taker) url.searchParams.set('taker', input.taker)
  if (input.slippageBps !== undefined) url.searchParams.set('slippageBps', String(input.slippageBps))
  return jupiterFetch(url)
}

export async function executeSwap(privyNode: PrivyClient, agent: JupiterAgent, input: {
  inputToken: JupiterToken
  outputToken: JupiterToken
  amountAtomic: string
  slippageBps?: number
}) {
  const order = await getSwapQuote({ ...input, taker: agent.walletAddress })
  if (!order.transaction || !order.requestId) throw new Error('Jupiter did not return an executable swap order')
  const signedTransaction = await signJupiterTransaction(privyNode, agent, String(order.transaction))
  const result = await jupiterFetch(`${SWAP_API}/execute`, {
    method: 'POST',
    body: JSON.stringify({ signedTransaction, requestId: order.requestId }),
  })
  if (result.status !== 'Success') throw new Error(result.error ?? `Jupiter swap failed (${result.code ?? 'unknown'})`)
  return { order, result }
}

export async function getJupiterPortfolio(walletAddress: string, platforms?: string) {
  const url = new URL(`${PORTFOLIO_API}/positions/${walletAddress}`)
  if (platforms) url.searchParams.set('platforms', platforms)
  return jupiterFetch(url)
}

export async function getRecurringOrders(walletAddress: string, input: {
  status?: 'active' | 'history'
  page?: number
  inputMint?: string
  outputMint?: string
  includeFailedTx?: boolean
} = {}) {
  const url = new URL(`${RECURRING_API}/getRecurringOrders`)
  url.searchParams.set('user', walletAddress)
  url.searchParams.set('orderStatus', input.status ?? 'active')
  url.searchParams.set('recurringType', 'time')
  if (input.page) url.searchParams.set('page', String(input.page))
  if (input.inputMint) url.searchParams.set('inputMint', input.inputMint)
  if (input.outputMint) url.searchParams.set('outputMint', input.outputMint)
  url.searchParams.set('includeFailedTx', String(input.includeFailedTx ?? false))
  const result = await jupiterFetch(url)
  return {
    ...result,
    orders: Array.isArray(result?.orders)
      ? result.orders
      : Array.isArray(result?.time)
        ? result.time
        : [],
  }
}

async function executeRecurringTransaction(privyNode: PrivyClient, agent: JupiterAgent, built: any) {
  if (!built.transaction || !built.requestId) throw new Error('Jupiter did not return an executable recurring transaction')
  const signedTransaction = await signJupiterTransaction(privyNode, agent, String(built.transaction))
  const result = await jupiterFetch(`${RECURRING_API}/execute`, {
    method: 'POST',
    body: JSON.stringify({ signedTransaction, requestId: built.requestId }),
  })
  if (result.status !== 'Success') throw new Error(result.error ?? 'Jupiter recurring execution failed')
  return result
}

export async function createRecurringOrder(privyNode: PrivyClient, agent: JupiterAgent, input: {
  inputToken: JupiterToken
  outputToken: JupiterToken
  amountAtomic: string
  numberOfOrders: number
  intervalSeconds: number
  minPrice?: number | null
  maxPrice?: number | null
  startAt?: number | null
}) {
  assertRecurringToken(input.inputToken)
  assertRecurringToken(input.outputToken)
  const inAmount = Number(input.amountAtomic)
  if (!Number.isSafeInteger(inAmount)) {
    throw new Error('Recurring order amount exceeds Jupiter numeric limits')
  }
  const built = await jupiterFetch(`${RECURRING_API}/createOrder`, {
    method: 'POST',
    body: JSON.stringify({
      user: agent.walletAddress,
      inputMint: input.inputToken.id,
      outputMint: input.outputToken.id,
      params: {
        time: {
          inAmount,
          numberOfOrders: input.numberOfOrders,
          interval: input.intervalSeconds,
          minPrice: input.minPrice ?? null,
          maxPrice: input.maxPrice ?? null,
          startAt: input.startAt ?? null,
        },
      },
    }),
  })
  const result = await executeRecurringTransaction(privyNode, agent, built)
  return { built, result }
}

export async function cancelRecurringOrder(privyNode: PrivyClient, agent: JupiterAgent, order: string) {
  const built = await jupiterFetch(`${RECURRING_API}/cancelOrder`, {
    method: 'POST',
    body: JSON.stringify({ order, user: agent.walletAddress, recurringType: 'time' }),
  })
  const result = await executeRecurringTransaction(privyNode, agent, built)
  return { built, result }
}

export function validateTradeTokens(inputToken: JupiterToken, outputToken: JupiterToken) {
  assertSafeToken(inputToken)
  assertSafeToken(outputToken)
  if (inputToken.id === outputToken.id) throw new Error('Input and output tokens must differ')
}
