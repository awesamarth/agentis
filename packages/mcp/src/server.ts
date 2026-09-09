import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AgentisClient } from '@agentis-hq/sdk'
import { operationInput } from '@agentis-hq/core/operations'
import { z } from 'zod'

export function createAgentisMcpServer(options: { accessToken: string; apiBase?: string }) {
  const client = new AgentisClient({ baseUrl: options.apiBase ?? 'http://localhost:3001', token: options.accessToken })
  const server = new McpServer({ name: 'agentis', version: '0.3.0' })
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  server.registerTool('agentis_capabilities', { description: 'Inspect actual enabled capabilities. Listed networks are not necessarily executable.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => result(await client.capabilities()))
  server.registerTool('agentis_request_operation', {
    description: 'Request a financial action within the delegated wallet grant. Keep the same idempotency key across retries. Pending approval returns a URL for the human; never approve your own request.',
    inputSchema: { operation: operationInput, idempotencyKey: z.string().min(1).max(128) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ operation, idempotencyKey }) => result(await client.operations.create(operation, { idempotencyKey })))
  server.registerTool('agentis_get_operation', { description: 'Get operation status and receipt. Unknown means reconcile, not create another payment.', inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true } }, async ({ id }) => result(await client.operations.get(id)))
  server.registerTool('agentis_list_operations', { description: 'List operations visible to this grant.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => result(await client.operations.list()))
  // No policy mutation, credential administration or approval tools for the agent.
  return server
}
