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
  policy: Policy
  transactions: TxRecord[]
}

export type TxRecord = {
  txHash: string
  amount: number       // SOL
  recipient: string
  timestamp: string    // ISO
}

export type SpendRecord = {
  amount: number   // USD
  timestamp: string
  url: string
}
