import { AgentisClient } from '@agentis/sdk'
import { getToken } from '../lib/keychain'
import { API_BASE } from '../lib/config'
import { resolveAccountAgent } from '../lib/account'

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx === -1 ? undefined : args[idx + 1]
}

async function resolveHostedAgent(nameOrId: string, token: string): Promise<any> {
  return resolveAccountAgent(nameOrId, token)
}

export async function paidFetch(args: string[]) {
  const url = args[0]
  const agentName = getFlag(args, '--agent')
  const method = getFlag(args, '--method') ?? 'GET'

  if (!url || !agentName) {
    console.error('Usage: agentis fetch <url> --agent <name-or-id> [--method GET]')
    process.exit(1)
  }

  const token = await getToken()
  if (!token) {
    console.error('Not logged in. Run `agentis login` first.')
    process.exit(1)
  }

  const agent = await resolveHostedAgent(agentName, token)
  const client = await AgentisClient.create({
    apiKey: agent.apiKey,
    baseUrl: API_BASE,
    onPayment: (payment) => {
      console.log(`paid ${payment.amount} ${payment.currency} via ${payment.protocol}`)
    },
  })

  const response = await client.fetch(url, { method })
  const body = await response.text()

  console.log(`status ${response.status}`)
  if (body) console.log(body)
}
