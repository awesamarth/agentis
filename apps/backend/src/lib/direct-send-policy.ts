import { checkPolicy, type Policy, type SpendRecord } from '@agentis-hq/core'

type SendTransaction = {
  amount: number
  amountUsd?: number
  recipient: string
  timestamp: string
}

export function enforceDirectSendPolicy(input: {
  policy: Policy
  amountUsd: number
  recipient: string
  transactions?: SendTransaction[]
}): void {
  const history: SpendRecord[] = (input.transactions ?? []).map(transaction => ({
    amount: transaction.amountUsd ?? transaction.amount,
    timestamp: transaction.timestamp,
    url: transaction.recipient,
  }))

  checkPolicy(input.policy, input.amountUsd, input.recipient, history)
}
