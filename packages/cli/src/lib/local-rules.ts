import { z } from 'zod'
import { parseUnits } from 'viem'
export const usdLimit = z.string().regex(/^\d+(\.\d{1,6})?$/).max(30).nullable()
export const localRules = z.object({ paused: z.boolean(), perTransaction: usdLimit, hourly: usdLimit, daily: usdLimit, total: usdLimit }).strict()
export type LocalRules = z.infer<typeof localRules>
export const defaultRules: LocalRules = { paused: false, perTransaction: null, hourly: null, daily: null, total: null }
export const usdMicros = (value: string) => parseUnits(value, 6)
export function ruleLimit(value: string | undefined) { return value === undefined ? undefined : value.trim() === '' || value.toLowerCase() === 'none' ? null : usdLimit.parse(value) }
