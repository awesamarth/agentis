import type { Policy, SpendRecord } from './types'
import { KillSwitchError, PolicyError } from './errors'

export function checkPolicy(
  policy: Policy,
  amountUsd: number,
  url: string,
  history: SpendRecord[]
): void {
  if (policy.killSwitch) throw new KillSwitchError()

  if (policy.allowedDomains.length > 0) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '')
      const allowed = policy.allowedDomains.some(
        d => hostname === d || hostname.endsWith('.' + d)
      )
      if (!allowed) throw new PolicyError(`Domain not whitelisted: ${hostname}`)
    } catch (e) {
      if (e instanceof PolicyError) throw e
    }
  }

  if (policy.maxPerTx !== null && amountUsd > policy.maxPerTx) {
    throw new PolicyError(`Exceeds max per transaction limit ($${policy.maxPerTx})`)
  }

  const now = Date.now()

  if (policy.hourlyLimit !== null) {
    const spend = history
      .filter(t => now - new Date(t.timestamp).getTime() < 60 * 60 * 1000)
      .reduce((s, t) => s + t.amount, 0)
    if (spend + amountUsd > policy.hourlyLimit)
      throw new PolicyError(`Hourly spend limit exceeded ($${policy.hourlyLimit})`)
  }

  if (policy.dailyLimit !== null) {
    const spend = history
      .filter(t => now - new Date(t.timestamp).getTime() < 24 * 60 * 60 * 1000)
      .reduce((s, t) => s + t.amount, 0)
    if (spend + amountUsd > policy.dailyLimit)
      throw new PolicyError(`Daily spend limit exceeded ($${policy.dailyLimit})`)
  }

  if (policy.monthlyLimit !== null) {
    const currentMonth = new Date().toISOString().slice(0, 7)
    const spend = history
      .filter(t => t.timestamp.slice(0, 7) === currentMonth)
      .reduce((s, t) => s + t.amount, 0)
    if (spend + amountUsd > policy.monthlyLimit)
      throw new PolicyError(`Monthly spend limit exceeded ($${policy.monthlyLimit})`)
  }

  if (policy.maxBudget !== null) {
    const spend = history.reduce((s, t) => s + t.amount, 0)
    if (spend + amountUsd > policy.maxBudget)
      throw new PolicyError(`Total budget cap exceeded ($${policy.maxBudget})`)
  }
}
