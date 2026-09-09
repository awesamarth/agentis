import { expect, test } from 'bun:test'
import { usdCost, parsePrice } from './usd-budget'
import type { OperationInput } from '@agentis-hq/core/operations'

test('USD accounting rounds up, includes fees, charges failed payments only gas, and rejects bad prices', () => {
  const input: OperationInput = { walletId: crypto.randomUUID(), chainId: 'eip155:84532', action: 'transfer', asset: 'native', to: '0x0000000000000000000000000000000000001234', amountAtomic: '1000000000000000000', maxFeeAtomic: '1000000000000000', reason: 'test' }
  const quote = { assetPrice: '2000000000000000000000', feePrice: '2000000000000000000000', assetDecimals: 18, feeDecimals: 18, expiresAt: Date.now() + 30_000 }
  expect(usdCost(input, quote)).toBe(2002000000n)
  expect(usdCost(input, quote, input.maxFeeAtomic, false)).toBe(2000000n)
  expect(usdCost({ ...input, amountAtomic: '1' }, quote, '0')).toBe(1n)
  const valid = { price: 2000, timestamp: Math.floor(Date.now() / 1000), confidence: 0.99 }
  expect(parsePrice(valid).value).toBe(quote.assetPrice)
  expect(() => parsePrice({ ...valid, timestamp: valid.timestamp - 400 })).toThrow('stale')
  expect(() => parsePrice({ ...valid, confidence: 0.5 })).toThrow()
  expect(() => parsePrice({ ...valid, price: 0 })).toThrow()
})
