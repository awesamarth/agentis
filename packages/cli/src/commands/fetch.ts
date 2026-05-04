import { getToken } from '../lib/keychain'
import { apiFetch } from '../lib/config'
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
  const res = await apiFetch(`/agents/${agent.id}/fetch`, {
    method: 'POST',
    body: JSON.stringify({ url, method }),
  }, token)
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    console.error('Fetch failed:', data.error ?? res.statusText)
    process.exit(1)
  }

  console.log(`status ${data.status}`)
  if (data.body) console.log(data.body)
}
