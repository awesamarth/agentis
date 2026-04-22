#!/usr/bin/env bun
import { login, logout, whoami } from './commands/auth'
import { agentList, agentCreate } from './commands/agent'

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

    case 'agent':
      switch (sub) {
        case 'list':
          await agentList()
          break
        case 'create':
          await agentCreate(args[2])
          break
        default:
          console.log('Usage: agentis agent <list|create>')
      }
      break

    default:
      console.log(`agentis — financial infrastructure for AI agents

Commands:
  login              authenticate with your Agentis account
  logout             remove stored credentials
  whoami             show current account
  agent list         list your agents
  agent create       create a new agent
`)
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
