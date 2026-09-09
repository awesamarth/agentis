#!/usr/bin/env bun
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAgentisMcpServer } from './server'
const accessToken = process.env.AGENTIS_TOKEN
if (!accessToken?.startsWith('agt_exec_')) throw new Error('Set AGENTIS_TOKEN to a scoped executor grant, not an owner/account credential')
await createAgentisMcpServer({ accessToken, apiBase: process.env.AGENTIS_API_URL }).connect(new StdioServerTransport())
