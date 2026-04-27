export type Policy = {
  hourlyLimit: number | null
  dailyLimit: number | null
  monthlyLimit: number | null
  maxBudget: number | null
  maxPerTx: number | null
  allowedDomains: string[]
  killSwitch: boolean
}

export type AgentInfo = {
  id: string
  name: string
  walletAddress: string
  privacyEnabled?: boolean
  umbraStatus?: 'disabled' | 'pending' | 'registered' | 'failed'
  umbraRegisteredAt?: string
  policyMode?: 'backend' | 'onchain'
  onchainPolicy?: {
    programId: string
    owner: string
    agent: string
    policy: string
    spendCounter: string
    initialized: boolean
  }
  policy: Policy
  transactions: TxRecord[]
}

export type TxRecord = {
  txHash: string
  amount: number       // SOL
  amountUsd?: number   // USD at time of payment
  recipient: string
  timestamp: string    // ISO
}

export type SpendRecord = {
  amount: number   // USD
  timestamp: string
  url: string
}
