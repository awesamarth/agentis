import { getToken } from '../lib/keychain'
import { apiFetch } from '../lib/config'
import { resolveAccountAgent } from '../lib/account'

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx === -1 ? undefined : args[idx + 1]
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

async function resolveHostedAgent(nameOrId: string, token: string): Promise<any> {
  return resolveAccountAgent(nameOrId, token)
}

async function getPrivacyContext(args: string[]): Promise<{ token: string; agent: any }> {
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
  return { token, agent }
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

async function privacyFetch(context: { token: string; agent: any }, path: string, body?: Record<string, unknown>) {
  const res = await apiFetch(`/agents/${context.agent.id}/umbra${path}`, body === undefined
    ? {}
    : {
      method: 'POST',
      body: JSON.stringify(body),
    }, context.token)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('Privacy request failed:', data.error ?? res.statusText)
    process.exit(1)
  }
  return data
}

export async function privacyCommand(args: string[]) {
  const sub = args[0]
  const rest = args.slice(1)

  if (!sub) {
    console.log('Usage: agentis privacy <status|register|balance|deposit|withdraw|create-utxo|scan|claim-latest> --agent <name-or-id>')
    return
  }

  const context = await getPrivacyContext(rest)

  switch (sub) {
    case 'status':
      printJson(await privacyFetch(context, '/status'))
      break

    case 'register':
      printJson(await privacyFetch(context, '/register', {
        confidential: !hasFlag(rest, '--no-confidential'),
        anonymous: !hasFlag(rest, '--no-anonymous'),
      }))
      break

    case 'balance':
      printJson(await privacyFetch(context, `/balance${getFlag(rest, '--mint') ? `?mint=${encodeURIComponent(getFlag(rest, '--mint')!)}` : ''}`))
      break

    case 'deposit':
      printJson(await privacyFetch(context, '/deposit', getAmountOptions(rest)))
      break

    case 'withdraw':
      printJson(await privacyFetch(context, '/withdraw', getAmountOptions(rest)))
      break

    case 'create-utxo':
      printJson(await privacyFetch(context, '/create-utxo', {
        ...getAmountOptions(rest),
        to: getFlag(rest, '--to'),
      }))
      break

    case 'scan':
      printJson(await privacyFetch(context, '/scan'))
      break

    case 'claim-latest':
      printJson(await privacyFetch(context, '/claim-latest', {}))
      break

    default:
      console.log('Usage: agentis privacy <status|register|balance|deposit|withdraw|create-utxo|scan|claim-latest> --agent <name-or-id>')
  }
}
