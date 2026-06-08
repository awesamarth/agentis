import { describe, expect, test } from 'bun:test'
import {
  enforceJupiterPolicy,
  uiAmountToAtomic,
  validateTradeTokens,
  type JupiterAgent,
  type JupiterToken,
} from './jupiter'

const usdc: JupiterToken = {
  id: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: 'USDC',
  decimals: 6,
  isVerified: true,
}

const sol: JupiterToken = {
  id: 'So11111111111111111111111111111111111111112',
  symbol: 'SOL',
  decimals: 9,
  isVerified: true,
}

function agent(overrides: Partial<JupiterAgent['policy']> = {}): JupiterAgent {
  return {
    id: 'agent-1',
    walletId: 'wallet-1',
    walletAddress: '11111111111111111111111111111111',
    policy: {
      hourlyLimit: null,
      dailyLimit: null,
      monthlyLimit: null,
      maxBudget: null,
      maxPerTx: null,
      allowedDomains: ['example.com'],
      killSwitch: false,
      ...overrides,
    },
    transactions: [],
  }
}

describe('Jupiter helpers', () => {
  test('converts UI amounts without floating-point rounding', () => {
    expect(uiAmountToAtomic('1.000001', 6)).toBe('1000001')
    expect(() => uiAmountToAtomic('0.0000001', 6)).toThrow('at most 6 decimal places')
  })

  test('allows safe Token-2022 assets for swaps', () => {
    expect(() => validateTradeTokens(
      { ...sol, tokenProgram: 'TokenzQdYh...' },
      usdc,
    )).not.toThrow()
  })

  test('enforces swap-specific policy without applying paid-fetch domains', async () => {
    await expect(enforceJupiterPolicy({
      agent: agent({ allowedMints: [usdc.id, sol.id], maxSlippageBps: 50 }),
      inputToken: { ...usdc, usdPrice: 1 },
      outputToken: sol,
      inputAmountUi: 10,
      slippageBps: 25,
      action: 'swap',
    })).resolves.toEqual({ amountUsd: 10 })
  })

  test('rejects disallowed mints and excessive slippage', async () => {
    await expect(enforceJupiterPolicy({
      agent: agent({ allowedMints: [usdc.id] }),
      inputToken: { ...usdc, usdPrice: 1 },
      outputToken: sol,
      inputAmountUi: 10,
      action: 'swap',
    })).rejects.toThrow('Token is not allowed')

    await expect(enforceJupiterPolicy({
      agent: agent({ maxSlippageBps: 20 }),
      inputToken: { ...usdc, usdPrice: 1 },
      outputToken: sol,
      inputAmountUi: 10,
      slippageBps: 25,
      action: 'swap',
    })).rejects.toThrow('Exceeds max slippage')
  })
})
