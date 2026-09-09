import { expect, test } from 'bun:test'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createAgentisMcpServer } from './server'
test('agent tools expose no approval, policy mutation or credential administration', async () => {
  const server = createAgentisMcpServer({ accessToken: 'agt_exec_test' })
  const client = new Client({ name: 'test', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(left)
  await client.connect(right)
  try {
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name).sort()).toEqual(['agentis_capabilities', 'agentis_get_operation', 'agentis_list_operations', 'agentis_request_operation'])
  } finally { await client.close(); await server.close() }
})
