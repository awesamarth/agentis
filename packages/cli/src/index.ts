#!/usr/bin/env bun
import { login, logout, whoami } from './commands/auth'
import { agentList, agentCreate, agentSend, agentBalance } from './commands/agent'
import { walletCreate, walletList } from './commands/wallet'
import { policyGet, policySet } from './commands/policy'

const args = process.argv.slice(2)
const cmd = args[0]
const sub = args[1]

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
          await agentCreate(args[2])
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
        default:
          console.log('Usage: agentis policy <get|set>')
      }
      break

    default:
      console.log(`agentis — financial infrastructure for AI agents

Commands:
  login                                    authenticate with your Agentis account
  logout                                   remove stored credentials
  whoami                                   show current account

  wallet create --name <name>              create hosted wallet (requires login)
  wallet create --name <name> --local      create local encrypted wallet
  wallet list                              list all wallets (hosted + local)

  agent list                               list your hosted agents
  agent create <name>                      create a new hosted agent
  agent send <name-or-id> <to> <amount>    send SOL (amount in lamports)
    --sol                                  treat amount as SOL instead of lamports
    --token <mint>                         send SPL token (amount in atomic units)

  policy get <name-or-id>                  show agent policy
  policy set <name-or-id> [flags]          update agent policy
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
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
