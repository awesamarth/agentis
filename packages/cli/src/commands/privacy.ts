import { AgentisClient } from '@agentis/sdk'
import { getToken } from '../lib/keychain'
import { API_BASE, apiFetch } from '../lib/config'

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx === -1 ? undefined : args[idx + 1]
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

async function resolveHostedAgent(nameOrId: string, token: string): Promise<any> {
  const res = await apiFetch('/account/agents', {}, token)
  if (!res.ok) {
    console.error('Failed to fetch hosted agents')
    process.exit(1)
  }

  const agents = await res.json()
  const agent = agents.find((a: any) => a.id === nameOrId || a.name === nameOrId)
  if (!agent) {
    console.error(`Hosted agent not found: ${nameOrId}`)
    process.exit(1)
  }

  return agent
}

async function getPrivacyClient(args: string[]): Promise<AgentisClient> {
  const agentName = getFlag(args, '--agent')
  if (!agentName) {
    console.error('Missing --agent <name-or-id>')
    process.exit(1)
  }

  const token = await getToken()
  if (!token) {
    console.error('Not logged in. Run `agentis login` first.')
    process.exit(1)
  }

  const agent = await resolveHostedAgent(agentName, token)
  return AgentisClient.create({
    apiKey: agent.apiKey,
    baseUrl: API_BASE,
  })
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2))
}

function getAmountOptions(args: string[]) {
  return {
    amount: getFlag(args, '--amount'),
    mint: getFlag(args, '--mint'),
  }
}

export async function privacyCommand(args: string[]) {
  const sub = args[0]
  const rest = args.slice(1)

  if (!sub) {
    console.log('Usage: agentis privacy <status|register|balance|deposit|withdraw|create-utxo|scan|claim-latest> --agent <name-or-id>')
    return
  }

  const client = await getPrivacyClient(rest)

  switch (sub) {
    case 'status':
      printJson(await client.privacy.status())
      break

    case 'register':
      printJson(await client.privacy.register({
        confidential: !hasFlag(rest, '--no-confidential'),
        anonymous: !hasFlag(rest, '--no-anonymous'),
      }))
      break

    case 'balance':
      printJson(await client.privacy.balance({ mint: getFlag(rest, '--mint') }))
      break

    case 'deposit':
      printJson(await client.privacy.deposit(getAmountOptions(rest)))
      break

    case 'withdraw':
      printJson(await client.privacy.withdraw(getAmountOptions(rest)))
      break

    case 'create-utxo':
      printJson(await client.privacy.createUtxo({
        ...getAmountOptions(rest),
        to: getFlag(rest, '--to'),
      }))
      break

    case 'scan':
      printJson(await client.privacy.scan())
      break

    case 'claim-latest':
      printJson(await client.privacy.claimLatest())
      break

    default:
      console.log('Usage: agentis privacy <status|register|balance|deposit|withdraw|create-utxo|scan|claim-latest> --agent <name-or-id>')
  }
}
