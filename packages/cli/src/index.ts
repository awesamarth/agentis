#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { AgentisApiError } from '@agentis-hq/sdk'
import { login, logout, sessions, whoami } from './lib/session'
import { createLocalWallet, listLocalWallets } from './lib/local-wallet'
import { validateCommand } from './lib/command-validation'
import { formatOutput } from './lib/output'
import { walletList } from './lib/wallet-list'
import { hostedPolicy, hostedHistory } from './lib/hosted-views'
import { banner, localCreationOptions, confirmLocalSend, promptLocalRules } from './lib/local-prompts'
import { localSendTerms, sendLocalTransfer, exactAmount } from './lib/local-send'
import { defaultRules, ruleLimit, type LocalRules } from './lib/local-rules'
import { showLocalPolicy, setLocalPolicy } from './lib/local-policy'
import { loadLocalWallet } from './lib/local-wallet'
import { localHistory } from './lib/local-history'
import { localPaidFetch } from './lib/local-paid'

const args = process.argv.slice(2)
async function main() {
  validateCommand(args)
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, 'no-browser': { type: 'boolean' }, agent: { type: 'string' }, local: { type: 'boolean' }, hosted: { type: 'boolean' }, name: { type: 'string' },
    wallet: { type: 'string' }, 'max-amount-atomic': { type: 'string' }, 'max-fee-atomic': { type: 'string' },
    file: { type: 'string' }, key: { type: 'string' }, hash: { type: 'string' }, json: { type: 'boolean' },
    chains: { type: 'string' }, chain: { type: 'string' }, to: { type: 'string' }, amount: { type: 'string' }, asset: { type: 'string' }, 'max-fee': { type: 'string' }, yes: { type: 'boolean' },
    'max-amount': { type: 'string' }, 'per-transaction': { type: 'string' }, hourly: { type: 'string' }, daily: { type: 'string' }, total: { type: 'string' }, pause: { type: 'boolean' }, resume: { type: 'boolean' }, limit: { type: 'string' },
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
  wallet list [--local | --hosted]   Both by default; flags select one custody type.
  wallet history --local --wallet <name-or-id> [--limit 20]
  wallet history [--hosted] [--agent <name-or-id>] [--wallet <wallet-id>] [--limit 20]
  policy show [--hosted] [--agent <name-or-id>] [--wallet <wallet-id>]
  policy show|set --local --wallet <name-or-id>
    [--per-transaction <USD>] [--hourly <USD>] [--daily <USD>] [--total <USD>] [--pause|--resume]
    Use none to remove a cap; zero blocks spending. No flags on set opens interactive editing.
  fetch <url> --local --wallet <name-or-id> --chain <chain> --max-amount <decimal> --key <request-key>
    [--max-fee <decimal>] [--yes]  Local x402 (Base/Arc/Solana USDC) / Tempo MPP alphaUSD.
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
  if (values.local && values.hosted) throw Error('Choose --local or --hosted, not both')
  if (values.hosted && !((command === 'wallet' && ['list', 'history'].includes(subcommand!)) || (command === 'policy' && subcommand === 'show'))) throw Error('--hosted supports wallet list/history and policy show')
  if (values.local && !['wallet', 'fetch', 'policy'].includes(command!)) throw Error('--local supports wallet, fetch and policy commands')
  if (command === 'policy' && subcommand === 'set' && !values.local) throw Error('Hosted rules are edited in the dashboard; policy set requires --local')
  if (values.pause && values.resume) throw Error('Choose --pause or --resume, not both')
  const policyChanges: Partial<LocalRules> = {}
  for (const [flag, field] of [['per-transaction', 'perTransaction'], ['hourly', 'hourly'], ['daily', 'daily'], ['total', 'total']] as const) {
    const limit = ruleLimit(values[flag]); if (limit !== undefined) policyChanges[field] = limit
  }
  if (values.pause || values.resume) policyChanges.paused = Boolean(values.pause)
  if (command === 'wallet' && subcommand === 'send' && !values.local) throw Error('Use wallet send --local; hosted transfers use operations create')
  let output: unknown
  if (command === 'login') output = await login(values['no-browser'], values.json)
  else if (command === 'logout') output = logout()
  else if (command === 'whoami') output = whoami()
  else if (command === 'policy' && !values.local) output = await hostedPolicy(values.agent, values.wallet)
  else if (command === 'wallet' && subcommand === 'history' && !values.local) output = await hostedHistory(values.agent, values.wallet, Number(values.limit ?? '20'))
  else if (command === 'policy') {
    if (!values.wallet) throw Error('--wallet required')
    if (subcommand === 'show') output = await showLocalPolicy(values.wallet)
    else {
      let changes = policyChanges
      if (!Object.keys(changes).length) {
        if (values.json || !process.stdin.isTTY || !process.stdout.isTTY) throw Error('Supply policy flags without an interactive terminal')
        changes = await promptLocalRules(loadLocalWallet(values.wallet).policy ?? defaultRules)
      }
      output = await setLocalPolicy(values.wallet, changes)
    }
  } else if (command === 'fetch' && values.local) {
    if (!subcommand || !values.wallet || !values.chain || !values.key || (!values['max-amount'] && !values['max-amount-atomic'])) throw Error('URL, --wallet, --chain, --max-amount and --key required')
    output = await localPaidFetch({ wallet: values.wallet, chain: values.chain, url: subcommand, key: values.key, maxAmountAtomic: values['max-amount-atomic'] ?? exactAmount(values['max-amount']!, 6).toString(), maxFeeAtomic: values['max-fee-atomic'] ?? exactAmount(values['max-fee'] ?? '0.01', 18).toString() }, summary => confirmLocalSend(summary, values.yes ?? false, values.json ?? false))
  } else if (command === 'wallet' && subcommand === 'list') {
    output = await walletList(values.local ?? false, values.hosted ?? false, values.agent)
  } else if (command === 'wallet' && values.local) {
    if (subcommand === 'create') {
      const options = await localCreationOptions(values.name, values.chains, values.json, policyChanges)
      output = await createLocalWallet(options.name, undefined, options.chains, options.policy)
    } else if (subcommand === 'send') {
      if (!values.wallet || !values.chain || !values.to || !values.amount || !values.key) throw Error('--wallet, --chain, --to, --amount and --key required; amounts are decimal token units')
      const input = { wallet: values.wallet, chain: values.chain, to: values.to, amount: values.amount, key: values.key, asset: values.asset, maxFee: values['max-fee'] }
      const terms = localSendTerms(input)
      const confirm = () => confirmLocalSend(`Send ${values.amount} ${terms.symbol} from ${terms.wallet.name} to ${terms.to} on ${terms.chain} testnet? Fee budget: ${terms.maxFee} ${terms.chain === 'base' ? 'ETH' : terms.chain === 'solana' ? 'SOL' : terms.chain === 'tempo' ? 'alphaUSD' : 'USDC'}.`, values.yes ?? false, values.json ?? false)
      output = await sendLocalTransfer(input, confirm)
    } else if (subcommand === 'history') {
      if (!values.wallet) throw Error('--wallet required')
      output = localHistory(values.wallet, Number(values.limit ?? '20'))
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
  console.log(values.json ? JSON.stringify(output, null, 2) : '\n' + formatOutput(command === 'wallet' && subcommand === 'history' ? 'history' : command!, output))
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Command failed'); process.exitCode = 1 })
