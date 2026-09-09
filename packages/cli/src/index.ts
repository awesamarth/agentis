#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { AgentisClient } from '@agentis-hq/sdk'
import { createLocalWallet, listLocalWallets } from './lib/local-wallet'
import { validateCommand } from './lib/command-validation'

const args = process.argv.slice(2)
async function main() {
  validateCommand(args)
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, local: { type: 'boolean' }, name: { type: 'string' },
    file: { type: 'string' }, key: { type: 'string' }, hash: { type: 'string' }, json: { type: 'boolean' },
  } })
  const [command, subcommand, id] = positionals
  if (!command || values.help) {
    console.log(`Usage: agentis ${command ?? '<command>'}
  wallet list [--local]
  wallet create --local --name <name>
  operations create --file <request.json> --key <idempotency-key>
  operations list|get <id>|wait <id>
  operations approve|reject <id> --hash <operation-hash>   (owner only)
  capabilities

Set AGENTIS_API_URL (default http://localhost:3001) and AGENTIS_TOKEN.
Use an executor grant for agents; fresh owner JWT for administration.
Hosted legacy money commands are unavailable during migration. Local wallets use
filesystem protection, not encrypted custody. No transaction can target mainnet yet.`)
    return
  }
  let output: unknown
  if (command === 'wallet' && values.local) {
    if (subcommand === 'create') output = await createLocalWallet(values.name ?? '')
    else output = listLocalWallets()
  } else {
    const token = process.env.AGENTIS_TOKEN
    if (!token) throw new Error('AGENTIS_TOKEN is required; never pass tokens inline as command arguments')
    const client = new AgentisClient({ baseUrl: process.env.AGENTIS_API_URL ?? 'http://localhost:3001', token })
    if (command === 'capabilities') output = await client.capabilities()
    else if (command === 'wallet' && subcommand === 'list') output = await client.wallets.list()
    else if (command === 'operations') {
      if (subcommand === 'create') {
        if (!values.file || !values.key) throw new Error('--file and --key required; reuse the same key after timeouts')
        output = await client.operations.create(JSON.parse(readFileSync(values.file, 'utf8')), { idempotencyKey: values.key })
      } else if (subcommand === 'list') output = await client.operations.list()
      else {
        if (!id) throw new Error('Operation ID required')
        if (subcommand === 'get') output = await client.operations.get(id)
        else if (subcommand === 'wait') output = await client.operations.wait(id)
        else {
          if (!values.hash) throw new Error('--hash required: review the exact operation before approving')
          output = subcommand === 'approve' ? await client.operations.approve(id, values.hash) : await client.operations.reject(id, values.hash)
        }
      }
    } else throw new Error('Hosted creation and unmigrated capabilities are unavailable; use the wallet-link API')
  }
  console.log(JSON.stringify(output, null, 2))
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Command failed'); process.exitCode = 1 })
