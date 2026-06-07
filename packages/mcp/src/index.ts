#!/usr/bin/env bun
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAgentisMcpServer } from './server'

const accessToken = process.env.AGENTIS_ACCOUNT_KEY
if (!accessToken) {
  console.error('Set AGENTIS_ACCOUNT_KEY before starting Agentis MCP.')
  process.exit(1)
}

const server = createAgentisMcpServer({
  accessToken,
  apiBase: process.env.AGENTIS_API_URL,
  mainnetRpcUrl: process.env.AGENTIS_MAINNET_RPC_URL,
})
await server.connect(new StdioServerTransport())
