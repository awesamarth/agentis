// Read-only policy/history authorization regression; no network, DB mutations or money.
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'
import { OperationService } from '../apps/backend/src/operations'
import type { Database } from '../apps/backend/src/db'
const dialect = new PgDialect()
const wallet = { id: 'wallet-a', agentId: 'agent-a', ownerId: 'owner-a', chainId: 'eip155:84532', enabled: true, policy: { mode: 'ask', budgetMode: 'usd' } }
const grant = { id: 'grant-a', ownerId: 'owner-a', walletId: null, agentId: 'agent-a', chainIds: ['eip155:84532'], revokedAt: null, expiresAt: null }
const agent = { id: 'agent-a', name: 'Research', mode: 'ask', limits: { perTransaction: '0', hourly: null, daily: '1000000', total: '2000000' }, allowedRecipients: [] }
function service(rows: unknown[][]) {
  const filters: { sql: string; params: unknown[] }[] = []
  const db = { select() {
    const result = rows.shift()!
    const query = {
      from() { return query }, innerJoin() { return query },
      where(filter: Parameters<PgDialect['sqlToQuery']>[0]) { filters.push(dialect.sqlToQuery(filter)); return query },
      orderBy() { return query }, limit() { return query },
      then(resolve: (value: unknown[]) => unknown) { return Promise.resolve(result).then(resolve) },
    }
    return query
  } }
  return { instance: new OperationService(db as unknown as Database, null, {}, 'http://localhost:3000'), filters }
}
const principal = { kind: 'agent' as const, ownerId: 'owner-a', grantId: 'grant-a' }
const valid = service([[wallet], [grant], [agent], [
  { status: 'confirmed', settled: '200', reserved: '999' }, { status: 'failed', settled: '25' },
  { status: 'unknown', reserved: '300' }, { status: 'queued', reserved: '40' }, { status: 'denied' },
]])
const policy = await valid.instance.policyView(principal, wallet.id)
assert.equal(policy.spentMicros, '225'); assert.equal(policy.reservedMicros, '340')
assert.equal(policy.limits.perTransaction, '0'); assert.equal(policy.limits.hourly, null)
assert(valid.filters[0]!.params.includes('owner-a')); assert(valid.filters[0]!.params.includes(true))
assert(valid.filters[2]!.params.includes('owner-a')); assert(valid.filters[3]!.params.includes('agent-a')); assert(valid.filters[3]!.params.includes('owner-a'))
for (const changes of [
  { ownerId: 'owner-b' }, { agentId: 'agent-b' }, { walletId: 'wallet-b' },
  { chainIds: ['eip155:42431'] }, { revokedAt: new Date() }, { expiresAt: new Date(0) },
]) {
  const denied = service([[wallet], [{ ...grant, ...changes }]])
  await assert.rejects(denied.instance.policyView(principal, wallet.id), /Wallet not found/)
  assert.equal(denied.filters.length, 2, 'Denied grants must not read agent budgets')
}
await assert.rejects(service([[]]).instance.policyView(principal, 'missing'), /Wallet not found/)
const history = service([[]]); await history.instance.list(principal, true)
assert(history.filters[0]!.params.includes('owner-a')); assert(history.filters[0]!.params.includes('grant-a'))
console.log('Hosted read views: grant owner/agent/wallet/network/expiry/revocation checks, shared USD aggregation and credential-scoped history passed. No money sent.')
