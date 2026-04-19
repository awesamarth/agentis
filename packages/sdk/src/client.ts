import type { AgentisConfig, PaymentDetails } from './types'
import type { AgentInfo, Policy, SpendRecord } from '@agentis/core'
import { AgentisError, PaymentError } from '@agentis/core'
import { checkPolicy } from '@agentis/core'
import {
  parse402WithBody,
  buildMPPPayment,
  buildX402Payment,
  solAmountFromRequirements,
  parseAmount,
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
    // Seed spend history from DB transactions
    this.spendHistory = this.agent.transactions.map(tx => ({
      amount: tx.amount,
      timestamp: tx.timestamp,
      url: tx.recipient, // TxRecord doesn't have url — use recipient as proxy
    }))
  }

  // Drop-in fetch replacement
  async fetch(url: string, options?: RequestInit): Promise<Response> {
    // First attempt — no payment
    const response = await globalThis.fetch(url, options)

    if (response.status !== 402) return response

    // Parse payment requirements
    const parsed = await parse402WithBody(response)
    if (!parsed) return response // not a recognized payment format, return as-is

    // Determine amount in SOL for policy check
    let amountSol = 0
    if (parsed.protocol === 'mpp') {
      amountSol = parseAmount(parsed.challenge.amount, parsed.challenge.currency)
    } else {
      amountSol = solAmountFromRequirements(parsed.requirements)
    }

    // Policy check
    checkPolicy(this.agent.policy, amountSol, url, this.spendHistory)

    if (this.config.simulate) {
      console.log(`[agentis simulate] Would pay ${amountSol} SOL to access ${url}`)
      return response
    }

    // Build payment proof
    let paymentHeader: string
    let headerName: string
    let x402Meta: { lamports: number; payTo: string } | null = null

    if (parsed.protocol === 'mpp') {
      // MPP: sign challenge, add Authorization header
      const signFn = this._makeSignFn()
      paymentHeader = await buildMPPPayment(parsed.challenge, parsed.raw, signFn)
      headerName = 'authorization'
    } else {
      // x402: backend signs the Solana transaction
      const result = await buildX402Payment(
        parsed.requirements,
        this.config.baseUrl,
        this.config.apiKey
      )
      paymentHeader = result.payment
      x402Meta = { lamports: result.lamports, payTo: result.payTo }
      headerName = 'x-payment'
    }

    // Retry with payment
    const paidResponse = await globalThis.fetch(url, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        [headerName]: parsed.protocol === 'mpp'
          ? `Payment ${paymentHeader}`
          : paymentHeader,
      },
    })

    if (!paidResponse.ok && paidResponse.status === 402) {
      throw new PaymentError('Payment was rejected by server')
    }

    // Payment confirmed — record spend in backend DB
    if (parsed.protocol === 'x402' && x402Meta) {
      const facilitatorResponse = await paidResponse.clone().json().catch(() => null)
      const txHash = facilitatorResponse?.transaction ?? facilitatorResponse?.txHash ?? null
      if (!txHash) throw new PaymentError('Facilitator did not return tx hash — cannot confirm payment')

      await globalThis.fetch(`${this.config.baseUrl}/sdk/agent/record-spend`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
        },
        body: JSON.stringify({ txHash, lamports: x402Meta.lamports, payTo: x402Meta.payTo }),
      })
    }

    // Record spend in local history for policy checks within this session
    const record: SpendRecord = {
      amount: amountSol,
      timestamp: new Date().toISOString(),
      url,
    }
    this.spendHistory.push(record)

    // Notify
    const details: PaymentDetails = {
      url,
      amount: String(amountSol),
      currency: parsed.protocol === 'mpp' ? parsed.challenge.currency : 'SOL',
      recipient: parsed.protocol === 'mpp' ? parsed.challenge.recipient : parsed.requirements.payTo,
      protocol: parsed.protocol,
    }
    this.config.onPayment(details)

    return paidResponse
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

  // Internal: returns a sign function that calls backend for Privy signing
  private _makeSignFn(): (msg: Uint8Array) => Promise<Uint8Array> {
    return async (msg: Uint8Array): Promise<Uint8Array> => {
      const res = await fetch(`${this.config.baseUrl}/sdk/agent/sign`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
        },
        body: JSON.stringify({ message: Array.from(msg) }),
      })
      if (!res.ok) throw new PaymentError('Failed to sign message')
      const { signature } = await res.json()
      return new Uint8Array(signature)
    }
  }
}
