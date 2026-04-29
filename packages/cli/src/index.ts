#!/usr/bin/env bun
import { login, logout, whoami } from './commands/auth'
import { agentList, agentCreate, agentSend, agentBalance } from './commands/agent'
import { walletCreate, walletList } from './commands/wallet'
import { policyGet, policyInitOnchain, policySet } from './commands/policy'
import { paidFetch } from './commands/fetch'
import { privacyCommand } from './commands/privacy'
import { facilitatorCommand } from './commands/facilitator'

const args = process.argv.slice(2)
const cmd = args[0]
const sub = args[1]

const blue = '\x1b[38;5;117m'
const green = '\x1b[38;5;114m'
const muted = '\x1b[38;5;244m'
const bold = '\x1b[1m'
const reset = '\x1b[0m'

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

async function main() {
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

    default:
      showHelp()
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
