import type { AgentisConfig, PaymentDetails } from './types'
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

  // Direct SOL transfer (amount in SOL, e.g. 0.001)
  async send(to: string, amountSol: number, mint?: string): Promise<string> {
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
