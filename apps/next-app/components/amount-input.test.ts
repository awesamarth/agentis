import { test, expect } from 'bun:test'
import { parseAmount } from './amount-input'

test('amount inputs respect SOL, SPL and EVM precision without rounding', () => {
  expect(parseAmount('0.001', 9)).toBe(1_000_000n)
  expect(parseAmount('1.000001', 6)).toBe(1_000_001n)
  expect(parseAmount('1', 18)).toBe(1_000_000_000_000_000_000n)
  for (const value of ['0.0000001', '-1', 'NaN', '1e3', '1,2']) expect(() => parseAmount(value, 6)).toThrow()
})
