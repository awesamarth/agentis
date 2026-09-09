import { describe, expect, test } from 'bun:test'
import { AgentisClient, AgentisApiError } from './client'
import type { Operation, OperationInput } from '@agentis-hq/core/operations'
const input: OperationInput = { walletId: '00000000-0000-4000-8000-000000000001', action: 'transfer', chainId: 'eip155:31337', asset: 'native', to: '0x0000000000000000000000000000000000001234', amountAtomic: '1000', maxFeeAtomic: '10', reason: 'API task' }
const operation: Operation = { ...input, id: input.walletId, status: 'pending_approval', operationHash: 'a'.repeat(64), policyVersion: 1, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), approvalUrl: 'http://localhost:3000/operations/id', transactionHash: null, error: null, receipt: null }
describe('SDK operation contract', () => {
  test('forwards exact amounts and stable idempotency key; pending approval is a result', async () => {
    const client = new AgentisClient({ baseUrl: 'http://localhost:3001', token: 'executor', fetch: (async (url, init) => {
      expect(String(url)).toEndWith('/v1/operations')
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('task-1')
      expect(JSON.parse(String(init?.body))).toEqual(input)
      expect(init?.redirect).toBe('error')
      return Response.json(operation, { status: 202 })
    }) as typeof fetch })
    expect(await client.operations.create(input, { idempotencyKey: 'task-1' })).toEqual(operation)
  })
  test('approval includes the exact binding, not just an operation ID', async () => {
    const client = new AgentisClient({ baseUrl: 'https://api.example.com', token: async () => 'owner-jwt', fetch: (async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ operationHash: operation.operationHash })
      return Response.json({ ...operation, status: 'queued' })
    }) as typeof fetch })
    expect((await client.operations.approve(operation.id, operation.operationHash)).status).toBe('queued')
  })
  test('wait returns approval/unknown rather than retrying payment', async () => {
    let requests = 0
    const client = new AgentisClient({ baseUrl: 'http://localhost:3001', token: 'executor', fetch: (async () => { requests++; return Response.json({ ...operation, status: 'unknown' }) }) as typeof fetch })
    expect((await client.operations.wait(operation.id)).status).toBe('unknown')
    expect(requests).toBe(1)
    const signal = AbortSignal.abort()
    await expect(client.operations.wait(operation.id, { signal })).rejects.toThrow()
  })
  test('typed API errors and unsafe base URL rejection', async () => {
    const client = new AgentisClient({ baseUrl: 'https://api.example.com', token: 'executor', fetch: (async () => Response.json({ error: { code: 'owner_required', message: 'Owner only' } }, { status: 403 })) as typeof fetch })
    await expect(client.operations.approve(operation.id, operation.operationHash)).rejects.toBeInstanceOf(AgentisApiError)
    expect(() => new AgentisClient({ baseUrl: 'http://example.com', token: 'secret' })).toThrow()
  })
})
