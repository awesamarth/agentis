import { describe, expect, test } from 'bun:test'
import type { Policy } from '@agentis-hq/core'
import { enforceDirectSendPolicy } from './direct-send-policy'

const basePolicy: Policy = {
  hourlyLimit: null,
  dailyLimit: null,
  monthlyLimit: null,
  maxBudget: null,
  maxPerTx: null,
  allowedDomains: [],
  killSwitch: false,
}

describe('enforceDirectSendPolicy', () => {
  test('compares direct SOL sends to USD policy limits', () => {
    expect(() => enforceDirectSendPolicy({
      policy: { ...basePolicy, maxPerTx: 1 },
      amountUsd: 1.25,
      recipient: '11111111111111111111111111111111',
    })).toThrow('Exceeds max per transaction limit ($1)')
  })

  test('uses recorded USD values for cumulative limits', () => {
    const timestamp = new Date().toISOString()
    expect(() => enforceDirectSendPolicy({
      policy: { ...basePolicy, dailyLimit: 2 },
      amountUsd: 0.75,
      recipient: '11111111111111111111111111111111',
      transactions: [{
        amount: 0.01,
        amountUsd: 1.5,
        recipient: '11111111111111111111111111111111',
        timestamp,
      }],
    })).toThrow('Daily spend limit exceeded ($2)')
  })

  test('allows a send that remains within the USD limits', () => {
    expect(() => enforceDirectSendPolicy({
      policy: { ...basePolicy, maxPerTx: 1, dailyLimit: 2 },
      amountUsd: 0.5,
      recipient: '11111111111111111111111111111111',
      transactions: [{
        amount: 0.01,
        amountUsd: 1,
        recipient: '11111111111111111111111111111111',
        timestamp: new Date().toISOString(),
      }],
    })).not.toThrow()
  })
})
