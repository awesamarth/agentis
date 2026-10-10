#!/usr/bin/env bun
import { httpMethod, type HttpRequestFields } from '@agentis-hq/core/operations'
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { AgentisClient, AgentisApiError } from '@agentis-hq/sdk'
import { localNetworks, parseChains } from './lib/local-networks'
import { login, logout, sessions, whoami, apiUrl } from './lib/session'
import { createLocalWallet, listLocalWallets } from './lib/local-wallet'
import { validateCommand } from './lib/command-validation'
import { formatOutput } from './lib/output'
import { walletList } from './lib/wallet-list'
import { walletBalance } from './lib/wallet-balance'
import { sendHostedTransfer } from './lib/hosted-send'
import { hostedPolicy, hostedHistory } from './lib/hosted-views'
import { banner, localCreationOptions, confirmLocalSend, promptLocalRules } from './lib/local-prompts'
import { localSendTerms, sendLocalTransfer } from './lib/local-send'
import { exactAmount } from './lib/transfer-terms'
import { defaultRules, ruleLimit, type LocalRules } from './lib/local-rules'
import { showLocalPolicy, setLocalPolicy } from './lib/local-policy'
import { loadLocalWallet } from './lib/local-wallet'
import { localHistory } from './lib/local-history'
import { localPaidFetch } from './lib/local-paid'
import { runIdentity, identityHelp } from './lib/identity'
import { runUniswap, uniswapAvailable, uniswapHelp, planText } from './lib/uniswap'

const args = process.argv.slice(2)
async function main() {
  validateCommand(args)
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, 'no-browser': { type: 'boolean' }, agent: { type: 'string' }, local: { type: 'boolean' }, hosted: { type: 'boolean' }, name: { type: 'string' },
    method: { type: 'string', short: 'X' }, data: { type: 'string', short: 'd' }, 'data-file': { type: 'string' }, header: { type: 'string', short: 'H', multiple: true },
    wallet: { type: 'string' }, 'max-amount-atomic': { type: 'string' }, 'max-fee-atomic': { type: 'string' },
    from: { type: 'string' }, 'exact-output': { type: 'boolean' }, 'slippage-bps': { type: 'string' }, 'eth-percent': { type: 'string' }, 'every-minutes': { type: 'string' }, preview: { type: 'boolean' }, 'swap-funding': { type: 'boolean' },
    'minimum-output-atomic': { type: 'string' }, 'maximum-input-atomic': { type: 'string' },
    parent: { type: 'string' }, label: { type: 'string' }, record: { type: 'string' }, endpoint: { type: 'string' }, description: { type: 'string' },
    file: { type: 'string' }, key: { type: 'string' }, hash: { type: 'string' }, json: { type: 'boolean' },
    chains: { type: 'string' }, chain: { type: 'string' }, to: { type: 'string' }, amount: { type: 'string' }, asset: { type: 'string' }, 'max-fee': { type: 'string' }, 'fee-asset': { type: 'string' }, yes: { type: 'boolean' },
    'max-amount': { type: 'string' }, 'per-transaction': { type: 'string' }, hourly: { type: 'string' }, daily: { type: 'string' }, total: { type: 'string' }, pause: { type: 'boolean' }, resume: { type: 'boolean' }, limit: { type: 'string' },
  } })
  const [command, subcommand, id] = positionals
  const requestFields = (): HttpRequestFields => {
    if (values.data !== undefined && values['data-file'] !== undefined) throw Error('Choose --data or --data-file')
    const headers: Record<string, string> = {}
    for (const header of values.header ?? []) {
      const colon = header.indexOf(':')
      if (colon < 1) throw Error('Use --header "Name: value"')
      const name = header.slice(0, colon).trim().toLowerCase()
      if (Object.hasOwn(headers, name)) throw Error('Duplicate header')
      headers[name] = header.slice(colon + 1).trim()
    }
    const body = values.data !== undefined ? { body: values.data } : values['data-file'] !== undefined ? { bodyBase64: readFileSync(values['data-file']).toString('base64') } : {}
    return { ...(values.method || Object.keys(body).length ? { method: httpMethod.parse((values.method ?? 'POST').toUpperCase()) } : {}), ...(values.header ? { headers } : {}), ...body }
  }
  if (command === 'discover') {
    if (Object.keys(values).some(flag => !['help', 'json', 'limit'].includes(flag))) throw Error('Discovery accepts only --limit, --json and --help; no wallet or login is needed')
    if (values.help) {
      console.log('agentis discover "<query>" [--limit 8] [--json]\nagentis discover describe <service-id> [--json]\nPublic Mercator catalog reads only. Queries are sent to Mercator. No provider calls or payments; use --json for full schemas.')
      return
    }
    const client = new AgentisClient({ baseUrl: apiUrl() })
    let output
    if (subcommand === 'describe') {
      if (positionals.length !== 3 || values.limit !== undefined) throw Error('Use agentis discover describe <service-id> [--json]')
      output = await client.discovery.describe(id!)
    } else {
      if (!subcommand) throw Error('Use agentis discover "<query>" [--limit 8] [--json]')
      output = await client.discovery.search({ query: positionals.slice(1).join(' '), ...(values.limit === undefined ? {} : { limit: Number(values.limit) }) })
    }
    console.log(values.json ? JSON.stringify(output, null, 2) : formatOutput('discover', output))
    return
  }
  if (command === 'cards') {
    if (Object.keys(values).some(flag => !['agent', 'help', 'json', ...(['request', 'ask', 'confirm'].includes(subcommand!) ? ['file', 'key'] : [])].includes(flag))) throw Error('Unsupported cards command option')
    if (values.help) { console.log('agentis cards status|setup|list [--agent <name-or-id>] [--json]\nagentis cards ask --file <ask.json> --key <stable-key> [--agent <name-or-id>]\n  JSON: {"ask":"what to buy","conversationId":"optional previous turn id","deliveryAddress":{...}}\nagentis cards confirm --file <cart.json> --key <stable-key> [--agent <name-or-id>]\n  JSON: {"conversationId":"turn id","cartHash":"exact returned cart hash"}\nagentis cards conversation <turn-id> | get|cancel|execute|continue <checkout-id> [--agent <name-or-id>]\nagentis cards request --file <official-sdk-capture.json> --key <stable-key> [--agent <name-or-id>]\nSeparate card consent is required. Ask waits for owner approval; Auto submits within agent limits. Agentcard/bank approval may remain. Continue ONLY a documented unpaid provider-approval pause, never a timeout. Read the original checkout after uncertainty; do not blindly confirm again. Browser purchases use @agentis-hq/sdk/cards/browser.'); return }
    if (positionals.length !== (['get', 'cancel', 'conversation', 'execute', 'continue'].includes(subcommand!) ? 3 : 2)) throw Error('Check agentis cards --help for the command arguments')
    const linked = sessions(values.agent)
    if (linked.length !== 1) throw Error('Select one linked agent with --agent')
    const selected = linked[0]!.agentId ?? values.agent, cards = linked[0]!.client.cards
    let result: unknown
    if (subcommand === 'get' || subcommand === 'cancel') result = await cards.checkouts[subcommand](id!)
    else if (subcommand === 'conversation') result = await cards.purchases.conversation(id!)
    else if (subcommand === 'continue') result = await cards.purchases.continue(id!)
    else if (subcommand === 'execute') {
      const checkout = await cards.checkouts.get(id!)
      if (checkout.rail !== 'purchase') throw Error('Browser purchases must be submitted by their active browser adapter')
      result = await cards.checkouts.execute(id!)
    } else {
      if (!selected) throw Error('When using AGENTIS_TOKEN, supply an agent UUID with --agent')
      if (subcommand === 'list') result = await cards.checkouts.list(selected)
      else if (['request', 'ask', 'confirm'].includes(subcommand!)) {
        if (!values.file || !values.key) throw Error('--file and --key are required; never use a new key after uncertainty')
        let input
        try { input = JSON.parse(readFileSync(values.file, 'utf8')) } catch { throw Error('Could not read valid checkout JSON; capture contents were not logged') }
        if (input?.agentId && input.agentId !== selected) throw Error('Input agentId must match the selected agent')
        const payload = { ...input, agentId: selected }
        result = subcommand === 'ask' ? await cards.purchases.ask(payload, { idempotencyKey: values.key }) : subcommand === 'confirm' ? await cards.purchases.confirm(payload, { idempotencyKey: values.key }) : await cards.checkouts.create(payload, { idempotencyKey: values.key })
      } else result = await cards.status(selected)
    }
    // Private provider links and browser replay material must never enter terminal/agent output.
    console.log(JSON.stringify(result, (name, value) => name === 'providerApprovalUrl' ? undefined : value, 2))
    return
  }
  const { header: _headers, ...commandValues } = values
  if (command === 'identity') { await runIdentity(subcommand, id, commandValues); return }
  if (['swap', 'rebalance', 'dca'].includes(command ?? '')) { if (values.local) throw Error('Uniswap currently supports hosted agents only'); await runUniswap(command!, subcommand, id, commandValues); return }
  if (values['swap-funding'] && (values.local || command !== 'fetch')) throw Error('--swap-funding currently supports hosted fetch only')
  if (values.help && ['login', 'logout', 'whoami'].includes(command ?? '')) {
    console.log(command === 'login' ? 'agentis login [--no-browser]\nAuthorize selected agents and network wallets in your browser; store scoped executor keys locally. No owner JWT is stored.' : command === 'logout' ? 'agentis logout\nRemove local credentials. Server keys remain active until revoked in the dashboard.' : 'agentis whoami\nShow linked agents and network scopes without exposing keys.')
    return
  }
  if (!command || values.help) {
    const pluginHelp = await uniswapAvailable(values.agent) ? `\n${uniswapHelp}\n` : ''
    if (!values.json) banner()
    console.log(`Usage: agentis ${command ?? '<command>'}
  login [--no-browser]
  logout
  whoami
  wallet list [--local | --hosted]   Both by default; flags select one custody type.
  wallet balance [--local | --hosted] [--wallet <name-or-id>] [--agent <hosted-name-or-id>]
  wallet history --local --wallet <name-or-id> [--limit 20]
  wallet history [--hosted] [--agent <name-or-id>] [--wallet <wallet-id>] [--limit 20]
  policy show [--hosted] [--agent <name-or-id>] [--wallet <wallet-id>]
  policy show|set --local --wallet <name-or-id>
    [--per-transaction <USD>] [--hourly <USD>] [--daily <USD>] [--total <USD>] [--pause|--resume]
    Use none to remove a cap; zero blocks spending. No flags on set opens interactive editing.
  fetch <url> --local --wallet <name-or-id> --chain <chain> --max-amount <decimal> --key <request-key>
    [--max-fee <decimal>] [--yes]  Local x402 / Tempo MPP; --asset selects a Tempo token, --fee-asset selects its gas token.
  wallet create --local [--name <name>] [--chains base,ethereum,tempo,solana]
    Interactive name + chain selection; Base selected by default. Flags work without a terminal.
  wallet send [--hosted | --local] --wallet <name-or-id> --chain <chain> --to <address> --amount <decimal> --key <request-key>
    [--asset <symbol>] [--fee-asset <Tempo-symbol>] [--max-fee <decimal>] [--yes]
    Hosted by default: ask mode returns a dashboard approval link; automatic executes within policy.
    Mainnet by default. Use base-sepolia, sepolia, arc, tempo-testnet or solana-devnet for testnets. --yes skips local confirmation only.
    Reuse identical terms and --key after uncertainty: only the receipt is checked, never a resend.
  fetch <url> --wallet <wallet-id> --max-amount-atomic <cap> --key <idempotency-key>
    Paid HTTP via x402 or Tempo/Solana MPP. --method/-X, --header/-H, --data/-d or --data-file (exact bytes).
    Data defaults to POST; otherwise GET. Set Content-Type for the provider's body format.
    Hosted unsponsored MPP requires --max-fee-atomic (Tempo: 18 decimals; Solana: lamports, includes ATA rent).
    Solana defaults to USDC; use --asset SOL for native MPP. Sponsored charges cost the agent zero gas.
    Tempo: --asset OUSD|USDC.e|pathUSD|alphaUSD (alphaUSD is testnet only), --fee-asset <symbol> optional.
  operations create --file <request.json> --key <idempotency-key>
  operations list|get <id>|wait <id>
  operations approve|reject <id> --hash <operation-hash>   (owner only)
  capabilities
  cards status|setup|ask|confirm|conversation|request|list|get|cancel|execute|continue   See cards --help.
  discover "<query>" [--limit 8] [--json]   Public API discovery; no wallet/login/payment.
  discover describe <service-id> [--json]  Endpoints, input schemas and payment offers.

${pluginHelp}
${identityHelp}`)
    return
  }
  if (values.local && values.hosted) throw Error('Choose --local or --hosted, not both')
  if (values.hosted && !((command === 'wallet' && ['list', 'history', 'send', 'balance'].includes(subcommand!)) || (command === 'policy' && subcommand === 'show'))) throw Error('--hosted supports wallet list/history/send/balance and policy show')
  if (values.local && !['wallet', 'fetch', 'policy'].includes(command!)) throw Error('--local supports wallet, fetch and policy commands')
  if (command === 'policy' && subcommand === 'set' && !values.local) throw Error('Hosted rules are edited in the dashboard; policy set requires --local')
  if (values.pause && values.resume) throw Error('Choose --pause or --resume, not both')
  const policyChanges: Partial<LocalRules> = {}
  for (const [flag, field] of [['per-transaction', 'perTransaction'], ['hourly', 'hourly'], ['daily', 'daily'], ['total', 'total']] as const) {
    const limit = ruleLimit(values[flag]); if (limit !== undefined) policyChanges[field] = limit
  }
  if (values.pause || values.resume) policyChanges.paused = Boolean(values.pause)

  let output: unknown
  if (command === 'login') output = await login(values['no-browser'], values.json)
  else if (command === 'logout') output = logout()
  else if (command === 'whoami') output = whoami()
  else if (command === 'wallet' && subcommand === 'balance') output = await walletBalance(values.local ?? false, values.hosted ?? false, values.wallet, values.agent)
  else if (command === 'wallet' && subcommand === 'send' && !values.local) {
    if (!values.wallet || !values.chain || !values.to || !values.amount || !values.key) throw Error('--wallet, --chain, --to, --amount and --key required; amounts are decimal token units')
    output = await sendHostedTransfer({ wallet: values.wallet, chain: values.chain, to: values.to, amount: values.amount, key: values.key, asset: values.asset, maxFee: values['max-fee'], feeAsset: values['fee-asset'] }, values.agent)
  }
  else if (command === 'policy' && !values.local) output = await hostedPolicy(values.agent, values.wallet)
  else if (command === 'wallet' && subcommand === 'history' && !values.local) output = await hostedHistory(values.agent, values.wallet, Number(values.limit ?? '20'))
  else if (command === 'policy') {
    if (!values.wallet) throw Error('--wallet required')
    if (subcommand === 'show') {
      const wallet = loadLocalWallet(values.wallet)
      const environments = [...new Set(wallet.chains.map(chain => localNetworks[chain].testnet ? 'testnet' as const : 'mainnet' as const))]
      const views = []
      for (const environment of environments) views.push(await showLocalPolicy(wallet.id, environment))
      output = views
    }
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
    const network = localNetworks[parseChains(values.chain)[0]!]!
    const selected = Object.values(network.assets).find(token => token.symbol === values.asset || token.id === values.asset || (values.asset === 'sol' && token.id === 'native'))
    const decimals = network.family === 'solana' ? (selected?.decimals ?? 6) : 6
    output = await localPaidFetch({ ...requestFields(), wallet: values.wallet, chain: values.chain, url: subcommand, key: values.key, asset: values.asset, feeAsset: values['fee-asset'], maxAmountAtomic: values['max-amount-atomic'] ?? exactAmount(values['max-amount']!, decimals).toString(), maxFeeAtomic: values['max-fee-atomic'] ?? (/^0+(\.0+)?$/.test(values['max-fee'] ?? '') ? '0' : exactAmount(values['max-fee'] ?? network.defaultFee, network.decimals).toString()) }, summary => confirmLocalSend(summary, values.yes ?? false, values.json ?? false))
  } else if (command === 'wallet' && subcommand === 'list') {
    output = await walletList(values.local ?? false, values.hosted ?? false, values.agent)
  } else if (command === 'wallet' && values.local) {
    if (subcommand === 'create') {
      const options = await localCreationOptions(values.name, values.chains, values.json, policyChanges)
      output = await createLocalWallet(options.name, undefined, options.chains, options.policy)
    } else if (subcommand === 'send') {
      if (!values.wallet || !values.chain || !values.to || !values.amount || !values.key) throw Error('--wallet, --chain, --to, --amount and --key required; amounts are decimal token units')
      const input = { wallet: values.wallet, chain: values.chain, to: values.to, amount: values.amount, key: values.key, asset: values.asset, maxFee: values['max-fee'], feeAsset: values['fee-asset'] }
      if (input.to.includes('.')) {
        const chains = parseChains(input.chain); if (chains.length !== 1) throw Error('Choose one payment network')
        if (!localNetworks[chains[0]!].testnet) throw Error('Use a recipient address for mainnet payments')
        const resolved = await new AgentisClient({ baseUrl: apiUrl(), token: '' }).identity.resolve(input.to, localNetworks[chains[0]!].chainId)
        if (!values.json) console.log(`${resolved.name} → ${resolved.address} (${resolved.chainId})`)
        input.to = resolved.address
      }
      const terms = localSendTerms(input)
      const confirm = () => confirmLocalSend(`Send ${values.amount} ${terms.symbol} from ${terms.wallet.name} to ${terms.to} on ${localNetworks[terms.chain].name}? Fee budget: ${terms.maxFee} ${terms.feeAsset ? Object.values(localNetworks[terms.chain].assets).find(asset => asset.id === terms.feeAsset)?.symbol : localNetworks[terms.chain].currency}.`, values.yes ?? false, values.json ?? false)
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
      if (values['swap-funding']) {
        if (values.asset || values['fee-asset']) throw Error('Tempo token selection cannot be combined with swap funding')
        const result = await client.uniswap.fetch({ ...requestFields(), url: subcommand, walletId: values.wallet, maxAmountAtomic: values['max-amount-atomic'] }, { idempotencyKey: values.key })
        console.log(values.json ? JSON.stringify(result, null, 2) : result.funding ? planText(result.funding) : formatOutput('operations', result.payment)); return
      }
      const operation = await client.fetch({ ...requestFields(), url: subcommand, walletId: values.wallet, asset: values.asset, feeAsset: values['fee-asset'], maxAmountAtomic: values['max-amount-atomic'], ...(values['max-fee-atomic'] ? { maxFeeAtomic: values['max-fee-atomic'] } : {}) }, { idempotencyKey: values.key })
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
  console.log(values.json ? JSON.stringify(output, null, 2) : '\n' + formatOutput(command === 'wallet' && ['history', 'balance'].includes(subcommand!) ? subcommand! : command!, output))
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Command failed'); process.exitCode = 1 })
