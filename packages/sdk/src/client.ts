import type {
  AgentBalances,
  AgentTokenBalance,
  AgentisConfig,
  PaymentDetails,
  PolicyCheckInput,
  PolicyCheckResult,
  UmbraAmountOptions,
  UmbraCreateUtxoOptions,
  UmbraRegisterOptions,
  UmbraResponse,
} from './types'
import type { AgentInfo, Policy, SpendRecord } from '@agentis/core'
import { AgentisError, PaymentError } from '@agentis/core'
import { checkPolicy } from '@agentis/core'
import {
  parse402WithBody,
  tokenAmountFromRequirements,
  isStablecoin,
  SOL_MINT,
} from './payment'

const DEFAULT_BASE_URL = 'https://api.agentis.xyz'
const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com'
const UMBRA_SOL_MINT = SOL_MINT
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, jsonSafe(entryValue)])
    )
  }
  return value
}

export class AgentisClient {
  private config: Required<AgentisConfig>
  private agent!: AgentInfo
  private spendHistory: SpendRecord[] = []

  private constructor(config: AgentisConfig) {
    this.config = {
      baseUrl: DEFAULT_BASE_URL,
      autoEarn: false,
      simulate: false,
      onPayment: () => {},
      ...config,
    }
  }

  static async create(config: AgentisConfig): Promise<AgentisClient> {
    const client = new AgentisClient(config)
    await client._bootstrap()
    return client
  }

  private async _bootstrap(): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/sdk/agent`, {
      headers: { 'x-api-key': this.config.apiKey },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new AgentisError((err as any).error ?? 'Failed to initialize agent — check your API key')
    }
    this.agent = await res.json()
    // Seed spend history from DB transactions (amounts in USD)
    this.spendHistory = this.agent.transactions.map(tx => ({
      amount: tx.amountUsd ?? tx.amount, // amountUsd preferred, fallback to raw SOL for old records
      timestamp: tx.timestamp,
      url: tx.recipient,
    }))
  }

  // Drop-in fetch replacement
  async fetch(url: string, options?: RequestInit): Promise<Response> {
    // First attempt — no payment
    const response = await globalThis.fetch(url, options)

    if (response.status !== 402) return response

    // Parse payment requirements for policy check
    const parsed = await parse402WithBody(response)
    if (!parsed) return response // not a recognized payment format, return as-is

    // Determine amount in token units, then convert to USD for policy check
    let amountUsd = 0
    let tokenAmount = 0
    let asset = ''
    if (parsed.protocol === 'mpp') {
      amountUsd = parsed.amount
      tokenAmount = parsed.amount
      asset = parsed.currency
    } else {
      tokenAmount = tokenAmountFromRequirements(parsed.requirements)
      asset = parsed.requirements.asset
      if (isStablecoin(asset)) {
        amountUsd = tokenAmount
      } else if (asset === SOL_MINT) {
        try {
          const priceRes = await globalThis.fetch(`${this.config.baseUrl}/sol-price`)
          if (priceRes.ok) {
            const { usd } = await priceRes.json() as { usd: number }
            amountUsd = tokenAmount * usd
          } else {
            amountUsd = tokenAmount
          }
        } catch {
          amountUsd = tokenAmount
        }
      } else {
        amountUsd = tokenAmount
      }
    }

    // Policy check (all limits are in USD)
    checkPolicy(this.agent.policy, amountUsd, url, this.spendHistory)

    if (this.config.simulate) {
      console.log(`[agentis simulate] Would pay $${amountUsd.toFixed(4)} to access ${url}`)
      return response
    }

    if (parsed.protocol === 'mpp') {
      // MPP: proxy through backend which uses @solana/mpp client + Privy signer
      const proxyRes = await globalThis.fetch(`${this.config.baseUrl}/sdk/agent/fetch-paid-mpp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
        },
        body: JSON.stringify({
          url,
          method: options?.method ?? 'GET',
          headers: options?.headers ?? {},
          amount: tokenAmount,
          mint: asset,
        }),
      })

      if (!proxyRes.ok) {
        const err = await proxyRes.json().catch(() => ({}))
        throw new PaymentError((err as any).error ?? 'MPP payment failed')
      }

      const result = await proxyRes.json()
      if (result.status === 402) {
        throw new PaymentError('MPP payment was rejected by server')
      }

      this._recordSpend(amountUsd, url, parsed)

      return new Response(result.body, {
        status: result.status,
        headers: result.headers,
      })
    }

    // x402: proxy through backend which uses Privy x402 client to pay
    const proxyRes = await globalThis.fetch(`${this.config.baseUrl}/sdk/agent/fetch-paid`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
      },
      body: JSON.stringify({
        url,
        method: options?.method ?? 'GET',
        headers: options?.headers ?? {},
        amount: tokenAmount,
        mint: asset,
      }),
    })

    if (!proxyRes.ok) {
      const err = await proxyRes.json().catch(() => ({}))
      throw new PaymentError((err as any).error ?? 'Payment failed')
    }

    const result = await proxyRes.json()
    if (result.status === 402) {
      throw new PaymentError('Payment was rejected by server')
    }

    // Record spend
    this._recordSpend(amountUsd, url, parsed)

    // Return a synthetic Response from the proxied result
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }

  private _recordSpend(amountUsd: number, url: string, parsed: any): void {
    const record: SpendRecord = {
      amount: amountUsd,
      timestamp: new Date().toISOString(),
      url,
    }
    this.spendHistory.push(record)

    const details: PaymentDetails = {
      url,
      amount: amountUsd.toFixed(4),
      currency: 'USD',
      recipient: parsed.protocol === 'mpp' ? parsed.recipient : parsed.requirements.payTo,
      protocol: parsed.protocol,
    }
    this.config.onPayment(details)
  }

  private async _rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await globalThis.fetch(SOLANA_DEVNET_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    })

    if (!res.ok) {
      throw new AgentisError(`Solana RPC request failed: ${method}`)
    }

    const body = await res.json() as { result?: T, error?: { message?: string } }
    if (body.error) {
      throw new AgentisError(body.error.message ?? `Solana RPC error: ${method}`)
    }

    return body.result as T
  }

  async balance(): Promise<AgentBalances>
  async balance(mint: string): Promise<AgentTokenBalance>
  async balance(mint?: string): Promise<AgentBalances | AgentTokenBalance> {
    const native = await this._nativeBalance()
    if (mint === SOL_MINT) return native

    const tokens = await this._tokenBalances()
    if (mint) {
      return tokens.find(token => token.mint === mint) ?? {
        mint,
        rawAmount: '0',
        decimals: 0,
        amount: 0,
      }
    }

    return {
      walletAddress: this.agent.walletAddress,
      native,
      tokens,
      balances: [native, ...tokens],
    }
  }

  private async _nativeBalance(): Promise<AgentTokenBalance> {
    const body = await this._rpc<{ value?: number }>(
      'getBalance',
      [this.agent.walletAddress, { commitment: 'confirmed' }]
    )
    const lamports = body.value
    if (typeof lamports !== 'number') {
      throw new AgentisError('Invalid balance response from Solana RPC')
    }

    return {
      mint: SOL_MINT,
      rawAmount: String(lamports),
      decimals: 9,
      amount: lamports / 1e9,
      symbol: 'SOL',
    }
  }

  private async _tokenBalances(): Promise<AgentTokenBalance[]> {
    const body = await this._rpc<{
      value?: Array<{
        account?: {
          data?: {
            parsed?: {
              info?: {
                mint?: string
                tokenAmount?: {
                  amount?: string
                  decimals?: number
                  uiAmount?: number | null
                }
              }
            }
          }
        }
      }>
    }>(
      'getTokenAccountsByOwner',
      [
        this.agent.walletAddress,
        { programId: TOKEN_PROGRAM_ID },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ]
    )

    return (body.value ?? [])
      .map(({ account }) => {
        const info = account?.data?.parsed?.info
        const tokenAmount = info?.tokenAmount
        if (!info?.mint || !tokenAmount?.amount || tokenAmount.decimals === undefined) return null
        return {
          mint: info.mint,
          rawAmount: tokenAmount.amount,
          decimals: tokenAmount.decimals,
          amount: tokenAmount.uiAmount ?? Number(tokenAmount.amount) / 10 ** tokenAmount.decimals,
        } satisfies AgentTokenBalance
      })
      .filter((balance): balance is AgentTokenBalance => Boolean(balance && balance.rawAmount !== '0'))
  }

  private async _umbra<T extends UmbraResponse = UmbraResponse>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const res = await globalThis.fetch(`${this.config.baseUrl}/umbra${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        ...(init.headers as Record<string, string> ?? {}),
      },
    })
    const body = await res.json().catch(() => ({}))

    if (!res.ok) {
      throw new AgentisError((body as any).error ?? `Umbra request failed: ${path}`)
    }

    return body as T
  }

  private _umbraPost<T extends UmbraResponse = UmbraResponse>(
    path: string,
    body: Record<string, unknown> = {}
  ): Promise<T> {
    return this._umbra<T>(path, {
      method: 'POST',
      body: JSON.stringify(jsonSafe(body)),
    })
  }

  // Direct payment. Native SOL amount is in SOL, e.g. 0.001.
  async pay(to: string, amountSol: number, mint?: string): Promise<string> {
    // Policy check
    const amountUsd = amountSol // rough — backend does real check too
    checkPolicy(this.agent.policy, amountUsd, to, this.spendHistory)

    const res = await globalThis.fetch(`${this.config.baseUrl}/sdk/agent/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
      },
      body: JSON.stringify({ to, amountSol, mint }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new PaymentError((err as any).error ?? 'Send failed')
    }

    const { signature } = await res.json()
    this.spendHistory.push({ amount: amountUsd, timestamp: new Date().toISOString(), url: to })
    return signature
  }

  // Policy management
  readonly policy = {
    get: async (): Promise<Policy> => {
      const res = await fetch(`${this.config.baseUrl}/sdk/agent`, {
        headers: { 'x-api-key': this.config.apiKey },
      })
      if (!res.ok) throw new AgentisError('Failed to fetch policy')
      const agent: AgentInfo = await res.json()
      this.agent = agent
      return agent.policy
    },

    update: async (patch: Partial<Policy>): Promise<Policy> => {
      const res = await fetch(`${this.config.baseUrl}/sdk/agent/policy`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
        },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new AgentisError((err as any).error ?? 'Failed to update policy')
      }
      const updated: Policy = await res.json()
      this.agent.policy = updated
      return updated
    },

    check: async (input: PolicyCheckInput): Promise<PolicyCheckResult> => {
      try {
        checkPolicy(this.agent.policy, input.amountUsd, input.url ?? this.agent.walletAddress, this.spendHistory)
        return { allowed: true }
      } catch (err: any) {
        return { allowed: false, reason: err?.message ?? 'Policy check failed' }
      }
    },
  }

  readonly privacy = {
    status: async (): Promise<UmbraResponse> => {
      return this._umbra('/status')
    },

    register: async (options: UmbraRegisterOptions = {}): Promise<UmbraResponse> => {
      return this._umbraPost('/register', options)
    },

    balance: async (options: Pick<UmbraAmountOptions, 'mint'> = {}): Promise<UmbraResponse> => {
      const qs = options.mint ? `?mint=${encodeURIComponent(options.mint)}` : ''
      return this._umbra(`/balance${qs}`)
    },

    solBalance: async (): Promise<UmbraResponse> => {
      return this.privacy.balance({ mint: UMBRA_SOL_MINT })
    },

    deposit: async (options: UmbraAmountOptions = {}): Promise<UmbraResponse> => {
      return this._umbraPost('/deposit', options)
    },

    depositSol: async (amount: string | number | bigint): Promise<UmbraResponse> => {
      return this.privacy.deposit({ amount, mint: UMBRA_SOL_MINT })
    },

    withdraw: async (options: UmbraAmountOptions = {}): Promise<UmbraResponse> => {
      return this._umbraPost('/withdraw', options)
    },

    withdrawSol: async (amount: string | number | bigint): Promise<UmbraResponse> => {
      return this.privacy.withdraw({ amount, mint: UMBRA_SOL_MINT })
    },

    createUtxo: async (options: UmbraCreateUtxoOptions = {}): Promise<UmbraResponse> => {
      return this._umbraPost('/create-utxo', options)
    },

    scan: async (): Promise<UmbraResponse> => {
      return this._umbra('/scan')
    },

    claimLatest: async (): Promise<UmbraResponse> => {
      return this._umbraPost('/claim-latest')
    },
  }

  get walletAddress(): string {
    return this.agent.walletAddress
  }

  get agentId(): string {
    return this.agent.id
  }

  get agentName(): string {
    return this.agent.name
  }
}
