import { parseUnits } from 'viem'

export function parseAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !/^\d+(\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > decimals) throw new Error(`Enter an unsigned amount with at most ${decimals} decimal places`)
  return parseUnits(value, decimals)
}
