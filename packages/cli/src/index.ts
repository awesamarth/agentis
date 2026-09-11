#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { AgentisApiError } from '@agentis-hq/sdk'
import { login, logout, sessions, whoami } from './lib/session'
import { createLocalWallet, listLocalWallets } from './lib/local-wallet'
import { validateCommand } from './lib/command-validation'
import { formatOutput } from './lib/output'
import { banner, localCreationOptions, confirmLocalSend } from './lib/local-prompts'
import { localSendTerms, sendLocalTransfer } from './lib/local-send'

const args = process.argv.slice(2)
async function main() {
  validateCommand(args)
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, 'no-browser': { type: 'boolean' }, agent: { type: 'string' }, local: { type: 'boolean' }, name: { type: 'string' },
    wallet: { type: 'string' }, 'max-amount-atomic': { type: 'string' }, 'max-fee-atomic': { type: 'string' },
    file: { type: 'string' }, key: { type: 'string' }, hash: { type: 'string' }, json: { type: 'boolean' },
    chains: { type: 'string' }, chain: { type: 'string' }, to: { type: 'string' }, amount: { type: 'string' }, asset: { type: 'string' }, 'max-fee': { type: 'string' }, yes: { type: 'boolean' },
  } })
  const [command, subcommand, id] = positionals
  if (values.help && ['login', 'logout', 'whoami'].includes(command ?? '')) {
    console.log(command === 'login' ? 'agentis login [--no-browser]\nAuthorize selected agents and network wallets in your browser; store scoped executor keys locally. No owner JWT is stored.' : command === 'logout' ? 'agentis logout\nRemove local credentials. Server keys remain active until revoked in the dashboard.' : 'agentis whoami\nShow linked agents and network scopes without exposing keys.')
    return
  }
  if (!command || values.help) {
    if (!values.json) banner()
    console.log(`Usage: agentis ${command ?? '<command>'}
  login [--no-browser]
  logout
  whoami
  wallet list [--local]
  wallet create --local [--name <name>] [--chains base,arc,tempo,solana]
    Interactive name + chain selection; Base selected by default. Flags work without a terminal.
  wallet send --local --wallet <name-or-id> --chain <chain> --to <address> --amount <decimal> --key <request-key>
    [--asset ETH|SOL|USDC|alphaUSD] [--max-fee <decimal>] [--yes]
    Testnets only. Native asset by default (alphaUSD on Tempo). --yes skips user confirmation.
    Reuse identical terms and --key after uncertainty: only the receipt is checked, never a resend.
  fetch <url> --wallet <wallet-id> --max-amount-atomic <cap> --key <idempotency-key>
    Base/Arc/Solana testnet USDC x402 or Tempo alphaUSD MPP GET; Tempo also requires --max-fee-atomic (18-decimal protocol USD units).
  operations create --file <request.json> --key <idempotency-key>
  operations list|get <id>|wait <id>
  operations approve|reject <id> --hash <operation-hash>   (owner only)
  capabilities

Human-readable output by default. Add --json for machine-readable output.
Run agentis login, or set AGENTIS_TOKEN to override stored login.
Set AGENTIS_API_URL (default http://localhost:3001). Use --agent <id-or-name>
to narrow commands to one linked agent; wallet IDs route payments automatically.
Use an executor grant for agents; fresh owner JWT for administration.
Hosted legacy money commands are unavailable during migration. Local wallets use
filesystem protection, not encrypted custody. No transaction can target mainnet yet.`)
    return
  }
  if (values.local && command !== 'wallet') throw Error('--local currently supports wallet create/list/send only; local x402/MPP is not implemented yet')
  if (command === 'wallet' && subcommand === 'send' && !values.local) throw Error('Use wallet send --local; hosted transfers use operations create')
  let output: unknown
  if (command === 'login') output = await login(values['no-browser'], values.json)
  else if (command === 'logout') output = logout()
  else if (command === 'whoami') output = whoami()
  else if (command === 'wallet' && values.local) {
    if (subcommand === 'create') {
      const options = await localCreationOptions(values.name, values.chains, values.json)
      output = await createLocalWallet(options.name, undefined, options.chains)
    } else if (subcommand === 'send') {
      if (!values.wallet || !values.chain || !values.to || !values.amount || !values.key) throw Error('--wallet, --chain, --to, --amount and --key required; amounts are decimal token units')
      const input = { wallet: values.wallet, chain: values.chain, to: values.to, amount: values.amount, key: values.key, asset: values.asset, maxFee: values['max-fee'] }
      const terms = localSendTerms(input)
      await confirmLocalSend(`Send ${values.amount} ${terms.symbol} from ${terms.wallet.name} to ${terms.to} on ${terms.chain} testnet? Fee budget: ${terms.maxFee} ${terms.chain === 'base' ? 'ETH' : terms.chain === 'solana' ? 'SOL' : terms.chain === 'tempo' ? 'alphaUSD' : 'USDC'}.`, values.yes ?? false, values.json ?? false)
      output = await sendLocalTransfer(input)
    } else output = listLocalWallets()
  } else {
    const linked = sessions(values.agent)
    let client = linked[0]!.client
    async function forWallet(walletId: string) {
      if (linked.length === 1) return linked[0]!.client
      for (const item of linked) if ((await item.client.wallets.list()).some(wallet => wallet.id === walletId)) return item.client
      throw Error('Wallet is not linked to this CLI login')
    }
    async function forOperation(operationId: string) {
      if (linked.length === 1) return linked[0]!.client
      for (const item of linked) {
        try { await item.client.operations.get(operationId); return item.client }
        catch (error) { if (!(error instanceof AgentisApiError) || error.status !== 404) throw error }
      }
      throw Error('Operation is not accessible with these CLI keys')
    }
    if (command === 'fetch') {
      if (!subcommand || !values.wallet || !values['max-amount-atomic'] || !values.key) throw new Error('URL, --wallet, --max-amount-atomic and --key required; reuse the key after timeouts')
      client = await forWallet(values.wallet)
      const operation = await client.fetch({ url: subcommand, walletId: values.wallet, maxAmountAtomic: values['max-amount-atomic'], ...(values['max-fee-atomic'] ? { maxFeeAtomic: values['max-fee-atomic'] } : {}) }, { idempotencyKey: values.key })
      output = operation.status === 'queued' ? await client.operations.wait(operation.id, { timeoutMs: 120_000 }) : operation
    }
    else if (command === 'capabilities') output = await client.capabilities()
    else if (command === 'wallet' && subcommand === 'list') output = (await Promise.all(linked.map(item => item.client.wallets.list()))).flat()
    else if (command === 'operations') {
      if (subcommand === 'create') {
        if (!values.file || !values.key) throw new Error('--file and --key required; reuse the same key after timeouts')
        const input = JSON.parse(readFileSync(values.file, 'utf8'))
        client = await forWallet(input.walletId)
        output = await client.operations.create(input, { idempotencyKey: values.key })
      } else if (subcommand === 'list') output = (await Promise.all(linked.map(item => item.client.operations.list()))).flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      else {
        if (!id) throw new Error('Operation ID required')
        client = await forOperation(id)
        if (subcommand === 'get') output = await client.operations.get(id)
        else if (subcommand === 'wait') output = await client.operations.wait(id)
        else {
          if (!values.hash) throw new Error('--hash required: review the exact operation before approving')
          output = subcommand === 'approve' ? await client.operations.approve(id, values.hash) : await client.operations.reject(id, values.hash)
        }
      }
    } else throw new Error('Hosted creation and unmigrated capabilities are unavailable; use the wallet-link API')
  }
  console.log(values.json ? JSON.stringify(output, null, 2) : formatOutput(command!, output))
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Command failed'); process.exitCode = 1 })
