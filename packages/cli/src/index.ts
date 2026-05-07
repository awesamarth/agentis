#!/usr/bin/env bun
import { login, logout, whoami } from './commands/auth'
import { agentList, agentCreate, agentSend, agentBalance } from './commands/agent'
import { walletCreate, walletList } from './commands/wallet'
import { policyGet, policyInitOnchain, policySet } from './commands/policy'
import { paidFetch } from './commands/fetch'
import { privacyCommand } from './commands/privacy'
import { facilitatorCommand } from './commands/facilitator'
import { earnCommand } from './commands/earn'

const args = process.argv.slice(2)
const cmd = args[0]
const sub = args[1]

const blue = '\x1b[38;5;117m'
const green = '\x1b[38;5;114m'
const muted = '\x1b[38;5;244m'
const bold = '\x1b[1m'
const reset = '\x1b[0m'

type HelpSpec = {
  usage: string
  description: string
  commands?: [string, string][]
  options?: [string, string][]
  examples?: string[]
}

const helpSpecs: Record<string, HelpSpec> = {
  login: {
    usage: 'agentis login',
    description: 'Authenticate with your Agentis account and store an account API key in your OS keychain.',
  },
  logout: {
    usage: 'agentis logout',
    description: 'Remove stored Agentis CLI credentials from your OS keychain.',
  },
  whoami: {
    usage: 'agentis whoami',
    description: 'Show the currently authenticated Agentis account key in masked form.',
  },
  wallet: {
    usage: 'agentis wallet <command>',
    description: 'Create and list hosted or local Solana wallets.',
    commands: [
      ['create --name <name> [--local]', 'create a hosted wallet, or a local encrypted wallet with --local'],
      ['list', 'list hosted and local wallets'],
    ],
  },
  'wallet create': {
    usage: 'agentis wallet create --name <name> [--local]',
    description: 'Create a hosted Agentis wallet when logged in, or a local encrypted wallet when --local is provided.',
    options: [
      ['--name <name>', 'wallet name'],
      ['--local', 'create a local encrypted wallet instead of a hosted Agentis wallet'],
      ['-h, --help', 'display help for command'],
    ],
  },
  'wallet list': {
    usage: 'agentis wallet list',
    description: 'List hosted wallets from Agentis and local encrypted wallets on this machine.',
    options: [['-h, --help', 'display help for command']],
  },
  agent: {
    usage: 'agentis agent <command>',
    description: 'Manage hosted agents and send funds from hosted or local wallets.',
    commands: [
      ['list', 'list hosted agents'],
      ['create <name> [--onchain-policy]', 'create a hosted agent'],
      ['balance <name-or-id>', 'show SOL and token balances'],
      ['send <name-or-id> <to> <amount> [options]', 'send SOL from an agent or local wallet'],
    ],
  },
  'agent list': {
    usage: 'agentis agent list',
    description: 'List hosted agents owned by your Agentis account.',
    options: [['-h, --help', 'display help for command']],
  },
  'agent create': {
    usage: 'agentis agent create <name> [--onchain-policy]',
    description: 'Create a hosted agent wallet and return its wallet address and API key.',
    options: [
      ['--onchain-policy', 'create the agent in Quasar on-chain policy mode'],
      ['-h, --help', 'display help for command'],
    ],
  },
  'agent balance': {
    usage: 'agentis agent balance <name-or-id>',
    description: 'Show SOL and known SPL token balances for a hosted agent or local wallet.',
    options: [['-h, --help', 'display help for command']],
  },
  'agent send': {
    usage: 'agentis agent send <name-or-id> <to> <amount> [options]',
    description: 'Send SOL from a hosted agent or local encrypted wallet. Amount is lamports by default.',
    options: [
      ['--sol', 'treat amount as SOL instead of lamports'],
      ['--token <mint>', 'send an SPL token by mint address; currently not implemented'],
      ['-h, --help', 'display help for command'],
    ],
  },
  fetch: {
    usage: 'agentis fetch <url> --agent <name-or-id> [options]',
    description: 'Fetch a URL and automatically pay MPP or x402 payment requests through the selected hosted agent.',
    options: [
      ['--agent <name-or-id>', 'hosted agent to pay from'],
      ['--method <method>', 'HTTP method to use; defaults to GET'],
      ['-h, --help', 'display help for command'],
    ],
  },
  earn: {
    usage: 'agentis earn <command>',
    description: 'Manage Jupiter Earn deposits and positions for hosted agent wallets.',
    commands: [
      ['deposit <agent> --asset USDC --amount <amount> --mainnet', 'deposit mainnet USDC into Jupiter Earn'],
      ['withdraw <agent> --asset USDC [--amount <amount>] --mainnet', 'withdraw mainnet USDC from Jupiter Earn'],
      ['positions <agent> --mainnet [--all]', 'show Jupiter Earn positions'],
      ['sweep [--dry-run|--no-dry-run]', 'sweep all hosted agents mainnet USDC into Jupiter Earn'],
    ],
  },
  'earn deposit': {
    usage: 'agentis earn deposit <agent> --asset USDC --amount <amount> --mainnet',
    description: 'Deposit mainnet USDC from a hosted agent wallet into Jupiter Earn.',
    options: [
      ['--asset USDC', 'asset to deposit; currently USDC'],
      ['--amount <amount>', 'UI amount, for example 1 for 1 USDC'],
      ['--mainnet', 'required safety flag'],
      ['-h, --help', 'display help for command'],
    ],
  },
  'earn withdraw': {
    usage: 'agentis earn withdraw <agent> --asset USDC [--amount <amount>] --mainnet',
    description: 'Withdraw mainnet USDC from Jupiter Earn back to a hosted agent wallet. Omitting --amount redeems the full USDC Earn position.',
    options: [
      ['--asset USDC', 'asset to withdraw; currently USDC'],
      ['--amount <amount>', 'optional UI amount, for example 1 for 1 USDC'],
      ['--mainnet', 'required safety flag'],
      ['-h, --help', 'display help for command'],
    ],
  },
  'earn positions': {
    usage: 'agentis earn positions <agent> --mainnet [--all]',
    description: 'Show Jupiter Earn positions for a hosted agent wallet.',
    options: [
      ['--mainnet', 'required safety flag'],
      ['--all', 'show empty vaults as well as non-zero positions'],
      ['-h, --help', 'display help for command'],
    ],
  },
  'earn sweep': {
    usage: 'agentis earn sweep [--dry-run|--no-dry-run]',
    description: 'Read all hosted agents mainnet USDC balances and deposit non-zero balances into Jupiter Earn.',
    options: [
      ['--dry-run', 'print the sweep plan only'],
      ['--no-dry-run', 'execute directly without first printing the dry-run plan'],
      ['-h, --help', 'display help for command'],
    ],
  },
  privacy: {
    usage: 'agentis privacy <command> --agent <name-or-id>',
    description: 'Use Umbra privacy flows for hosted agent wallets.',
    commands: [
      ['status --agent <name-or-id>', 'show Umbra registration status'],
      ['register --agent <name-or-id>', 'register with Umbra'],
      ['balance --agent <name-or-id> [--mint <mint>]', 'show encrypted balance'],
      ['deposit --agent <name-or-id> --amount <atomic> [--mint <mint>]', 'deposit into encrypted balance'],
      ['withdraw --agent <name-or-id> --amount <atomic> [--mint <mint>]', 'withdraw encrypted balance'],
      ['create-utxo --agent <name-or-id> --to <wallet> --amount <atomic>', 'create receiver-claimable UTXO'],
      ['scan --agent <name-or-id>', 'scan claimable UTXOs'],
      ['claim-latest --agent <name-or-id>', 'claim latest publicReceived UTXO'],
    ],
  },
  'privacy status': {
    usage: 'agentis privacy status --agent <name-or-id>',
    description: 'Show direct Umbra account status for a hosted agent.',
    options: [['--agent <name-or-id>', 'hosted agent'], ['-h, --help', 'display help for command']],
  },
  'privacy register': {
    usage: 'agentis privacy register --agent <name-or-id> [options]',
    description: 'Register a hosted agent wallet with Umbra.',
    options: [
      ['--agent <name-or-id>', 'hosted agent'],
      ['--no-confidential', 'disable confidential mode during registration'],
      ['--no-anonymous', 'disable anonymous mode during registration'],
      ['-h, --help', 'display help for command'],
    ],
  },
  'privacy balance': {
    usage: 'agentis privacy balance --agent <name-or-id> [--mint <mint>]',
    description: 'Show encrypted Umbra balance for a hosted agent.',
    options: [['--agent <name-or-id>', 'hosted agent'], ['--mint <mint>', 'token mint'], ['-h, --help', 'display help for command']],
  },
  'privacy deposit': {
    usage: 'agentis privacy deposit --agent <name-or-id> --amount <atomic> [--mint <mint>]',
    description: 'Deposit public funds into an encrypted Umbra balance.',
    options: [['--agent <name-or-id>', 'hosted agent'], ['--amount <atomic>', 'token amount in atomic units'], ['--mint <mint>', 'token mint'], ['-h, --help', 'display help for command']],
  },
  'privacy withdraw': {
    usage: 'agentis privacy withdraw --agent <name-or-id> --amount <atomic> [--mint <mint>]',
    description: 'Withdraw an encrypted Umbra balance to the public wallet balance.',
    options: [['--agent <name-or-id>', 'hosted agent'], ['--amount <atomic>', 'token amount in atomic units'], ['--mint <mint>', 'token mint'], ['-h, --help', 'display help for command']],
  },
  'privacy create-utxo': {
    usage: 'agentis privacy create-utxo --agent <name-or-id> --to <wallet> --amount <atomic> [--mint <mint>]',
    description: 'Create a receiver-claimable Umbra UTXO for another wallet.',
    options: [['--agent <name-or-id>', 'hosted agent'], ['--to <wallet>', 'receiver wallet address'], ['--amount <atomic>', 'token amount in atomic units'], ['--mint <mint>', 'token mint'], ['-h, --help', 'display help for command']],
  },
  'privacy scan': {
    usage: 'agentis privacy scan --agent <name-or-id>',
    description: 'Scan Umbra for UTXOs claimable by the hosted agent.',
    options: [['--agent <name-or-id>', 'hosted agent'], ['-h, --help', 'display help for command']],
  },
  'privacy claim-latest': {
    usage: 'agentis privacy claim-latest --agent <name-or-id>',
    description: 'Claim the latest publicReceived Umbra UTXO for the hosted agent.',
    options: [['--agent <name-or-id>', 'hosted agent'], ['-h, --help', 'display help for command']],
  },
  facilitator: {
    usage: 'agentis facilitator <command>',
    description: 'Create, list, and publish Agentis x402 facilitator scaffolds.',
    commands: [
      ['create <name> [options]', 'register and scaffold a Kora-backed x402 facilitator'],
      ['list', 'list registered facilitators'],
      ['publish <name-or-id> --url <public-url> [--listed]', 'publish public URL and discovery settings'],
    ],
  },
  'facilitator create': {
    usage: 'agentis facilitator create <name> [options]',
    description: 'Register a facilitator in Agentis and scaffold a Kora-backed x402 facilitator project.',
    options: [
      ['--dir <path>', 'output directory'],
      ['--network <network>', 'accepted network; defaults to Solana devnet CAIP-2'],
      ['--mint <mint>', 'accepted token mint; defaults to devnet USDC'],
      ['--fee-bps <bps>', 'seller prepaid fee rate; defaults to 500'],
      ['--listed', 'opt into public facilitator discovery'],
      ['-h, --help', 'display help for command'],
    ],
  },
  'facilitator list': {
    usage: 'agentis facilitator list',
    description: 'List facilitators registered to your Agentis account.',
    options: [['-h, --help', 'display help for command']],
  },
  'facilitator publish': {
    usage: 'agentis facilitator publish <name-or-id> --url <public-url> [--listed]',
    description: 'Set a facilitator public URL and optionally list it in public discovery.',
    options: [
      ['--url <public-url>', 'public facilitator endpoint URL'],
      ['--listed', 'opt into public facilitator discovery'],
      ['-h, --help', 'display help for command'],
    ],
  },
  policy: {
    usage: 'agentis policy <command>',
    description: 'Read, update, and initialize agent spend policies.',
    commands: [
      ['get <name-or-id>', 'show agent policy'],
      ['set <name-or-id> [flags]', 'update agent policy'],
      ['init-onchain <name-or-id>', 'initialize Quasar policy PDAs after funding'],
    ],
  },
  'policy get': {
    usage: 'agentis policy get <name-or-id>',
    description: 'Show policy settings for a hosted agent or local wallet.',
    options: [['-h, --help', 'display help for command']],
  },
  'policy set': {
    usage: 'agentis policy set <name-or-id> [flags]',
    description: 'Update policy settings for a hosted agent or local wallet.',
    options: [
      ['--kill', 'activate kill switch'],
      ['--resume', 'deactivate kill switch'],
      ['--max-per-tx <usd>', 'max spend per transaction'],
      ['--hourly <usd>', 'hourly spend limit'],
      ['--daily <usd>', 'daily spend limit'],
      ['--monthly <usd>', 'monthly spend limit'],
      ['--budget <usd>', 'total lifetime budget cap'],
      ['--allow <domain>', 'add domain to whitelist'],
      ['--disallow <domain>', 'remove domain from whitelist'],
      ['-h, --help', 'display help for command'],
    ],
  },
  'policy init-onchain': {
    usage: 'agentis policy init-onchain <name-or-id>',
    description: 'Initialize Quasar policy PDAs for an on-chain policy hosted agent after the wallet is funded.',
    options: [['-h, --help', 'display help for command']],
  },
}

function showHelp() {
  console.log(`${blue}${bold}
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║███████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║╚════██║
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║███████║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚══════╝
${reset}${muted}v0.1.0${reset}

${bold}Agentis${reset} — financial infrastructure for AI agents

${green}${bold}Commands:${reset}
  login                                    authenticate with your Agentis account
  logout                                   remove stored credentials
  whoami                                   show current account

  wallet create --name <name>              create hosted wallet (requires login)
  wallet create --name <name> --local      create local encrypted wallet
  wallet list                              list all wallets (hosted + local)

  agent list                               list your hosted agents
  agent create <name>                      create a new hosted agent
    --onchain-policy                       create with Quasar on-chain policy mode
  agent send <name-or-id> <to> <amount>    send SOL (amount in lamports)
    --sol                                  treat amount as SOL instead of lamports
    --token <mint>                         send SPL token (amount in atomic units)

  fetch <url> --agent <name-or-id>         fetch a URL and auto-pay MPP/x402 402s
    --method <method>                      HTTP method (default GET)

  earn deposit <agent>                     deposit into Jupiter Earn (mainnet only)
    --asset USDC                           asset to deposit
    --amount <amount>                      UI amount, e.g. 1 for 1 USDC
    --mainnet                              required safety flag
  earn withdraw <agent> --mainnet          withdraw all USDC from Jupiter Earn
    --amount <amount>                      optional UI amount, e.g. 1 for 1 USDC
  earn positions <agent> --mainnet         show Jupiter Earn positions
  earn sweep [--dry-run|--no-dry-run]      sweep all agents' mainnet USDC into Earn

  facilitator create <name>                scaffold a Kora-backed x402 facilitator
    --dir <path>                           output directory
    --fee-bps <bps>                        prepaid seller fee rate (default 500)
    --listed                               opt into public facilitator discovery
  facilitator list                         list registered facilitators
  facilitator publish <name-or-id> --url   set public URL and optional listing

  privacy status --agent <name-or-id>      show direct Umbra account status
  privacy register --agent <name-or-id>    register server-side Privy wallet with Umbra
  privacy balance --agent <name-or-id>     show encrypted balance
  privacy deposit --agent <name-or-id>     deposit into encrypted balance
    --amount <atomic>                      token amount in atomic units
    --mint <mint>                          token mint (default: devnet wSOL/SOL)
  privacy withdraw --agent <name-or-id>    withdraw encrypted balance to public balance
  privacy create-utxo --agent <name-or-id> create receiver-claimable UTXO
    --to <wallet>                          destination wallet
  privacy scan --agent <name-or-id>        scan claimable UTXOs
  privacy claim-latest --agent <name-or-id> claim latest publicReceived UTXO

  policy get <name-or-id>                  show agent policy
  policy set <name-or-id> [flags]          update agent policy
  policy init-onchain <name-or-id>         initialize Quasar policy PDAs after funding
    --kill                                 activate kill switch
    --resume                               deactivate kill switch
    --max-per-tx <usd>                     max spend per transaction
    --hourly <usd>                         hourly spend limit
    --daily <usd>                          daily spend limit
    --monthly <usd>                        monthly spend limit
    --budget <usd>                         total lifetime budget cap
    --allow <domain>                       add domain to whitelist
    --disallow <domain>                    remove domain from whitelist
`)
}

function hasHelpFlag(values: string[]) {
  return values.includes('--help') || values.includes('-h')
}

function helpPath(values: string[]) {
  return values.filter(value => value !== '--help' && value !== '-h').slice(0, 2).join(' ')
}

function printRows(title: string, rows: [string, string][]) {
  console.log(`\n${green}${bold}${title}:${reset}`)
  for (const [left, right] of rows) {
    console.log(`  ${left.padEnd(38)} ${right}`)
  }
}

function showCommandHelp(path: string) {
  if (!path) {
    showHelp()
    return
  }

  const spec = helpSpecs[path] ?? helpSpecs[path.split(' ')[0]!]
  if (!spec) {
    showHelp()
    return
  }

  console.log(`${bold}Usage:${reset} ${spec.usage}\n`)
  console.log(spec.description)
  if (spec.commands) printRows('Commands', spec.commands)
  if (spec.options) printRows('Options', spec.options)
  if (spec.examples) printRows('Examples', spec.examples.map(example => [example, '']))
  console.log()
}

async function main() {
  if (!cmd || hasHelpFlag(args)) {
    showCommandHelp(helpPath(args))
    return
  }

  switch (cmd) {
    case 'login':
      await login()
      break

    case 'logout':
      await logout()
      break

    case 'whoami':
      await whoami()
      break

    case 'wallet':
      switch (sub) {
        case 'create':
          await walletCreate(args.slice(2))
          break
        case 'list':
          await walletList()
          break
        default:
          console.log('Usage: agentis wallet <create|list>')
      }
      break

    case 'agent':
      switch (sub) {
        case 'list':
          await agentList()
          break
        case 'create':
          await agentCreate(args.slice(2))
          break
        case 'send':
          await agentSend(args.slice(2))
          break
        case 'balance':
          await agentBalance(args[2])
          break
        default:
          console.log('Usage: agentis agent <list|create|send|balance>')
      }
      break

    case 'policy':
      switch (sub) {
        case 'get':
          await policyGet(args[2])
          break
        case 'set':
          await policySet(args[2], args.slice(3))
          break
        case 'init-onchain':
          await policyInitOnchain(args[2])
          break
        default:
          console.log('Usage: agentis policy <get|set|init-onchain>')
      }
      break

    case 'fetch':
      await paidFetch(args.slice(1))
      break

    case 'privacy':
      await privacyCommand(args.slice(1))
      break

    case 'facilitator':
      await facilitatorCommand(args.slice(1))
      break

    case 'earn':
      await earnCommand(args.slice(1))
      break

    default:
      showHelp()
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
