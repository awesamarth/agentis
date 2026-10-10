import { and, eq } from 'drizzle-orm'
import type { Database } from '../../db'
import { cardCheckouts, operations, wallets } from '../../db/schema'
import { findNetwork } from '@agentis-hq/core/networks'
import type { UsdLimits } from '@agentis-hq/core/operations'

export const cardHolding = ['pending_approval', 'queued', 'submitting', 'awaiting_provider', 'unknown'] as const
const cryptoHolding = ['pending_approval', 'queued', 'submitting', 'submitted', 'unknown']
type Usage = { total: bigint; hourly: bigint; daily: bigint; spent: bigint; reserved: bigint; unpriced: boolean }
function add(usage: Usage, row: { status: string; usdReservedMicros: string | null; usdSettledMicros: string | null; createdAt: Date; settledAt: Date | null }, holding: readonly string[]) {
  const held = holding.includes(row.status), amount = BigInt((held ? row.usdReservedMicros : row.usdSettledMicros) ?? '0')
  const age = Date.now() - (row.settledAt ?? row.createdAt).getTime()
  usage.total += amount; usage[held ? 'reserved' : 'spent'] += amount
  if (held || age < 3_600_000) usage.hourly += amount
  if (held || age < 86_400_000) usage.daily += amount
}
export async function cardUsage(db: Pick<Database, 'select'>, ownerId: string, agentId: string | null, testMode: boolean, excludeId?: string): Promise<Usage> {
  const rows = await db.select({ id: cardCheckouts.id, budgetUnsafe: cardCheckouts.budgetUnsafe, status: cardCheckouts.status, usdReservedMicros: cardCheckouts.usdReservedMicros, usdSettledMicros: cardCheckouts.usdSettledMicros, createdAt: cardCheckouts.createdAt, settledAt: cardCheckouts.settledAt }).from(cardCheckouts).where(and(eq(cardCheckouts.ownerId, ownerId), agentId ? eq(cardCheckouts.agentId, agentId) : undefined, eq(cardCheckouts.testMode, testMode)))
  const usage = { total: 0n, hourly: 0n, daily: 0n, spent: 0n, reserved: 0n, unpriced: false }
  for (const row of rows) {
    usage.unpriced ||= row.budgetUnsafe
    if (row.id !== excludeId) add(usage, row, cardHolding)
  }
  return usage
}
/** Call under the same owner advisory lock used by crypto reservations and policy edits. */
export async function cardBudgetReason(db: Pick<Database, 'select'>, ownerId: string, agentId: string, testMode: boolean, limits: UsdLimits, amount: bigint, excludeId?: string) {
  const usage = await cardUsage(db, ownerId, agentId, testMode, excludeId)
  if (usage.unpriced) return 'An unpriced card settlement blocks new spending until reconciled'
  const crypto = await db.select({ chainId: wallets.chainId, status: operations.status, usdReservedMicros: operations.usdReservedMicros, usdSettledMicros: operations.usdSettledMicros, createdAt: operations.createdAt, settledAt: operations.settledAt }).from(operations).innerJoin(wallets, eq(wallets.id, operations.walletId)).where(and(eq(operations.ownerId, ownerId), eq(wallets.agentId, agentId)))
  for (const row of crypto) if (findNetwork(row.chainId)?.testnet === testMode) add(usage, row, cryptoHolding)
  for (const [field, used] of [['perTransaction', 0n], ['hourly', usage.hourly], ['daily', usage.daily], ['total', usage.total]] as const) {
    if (limits[field] !== null && used + amount > BigInt(limits[field]!)) return `${field} USD budget exceeded`
  }
  return null
}
