import { apiFetch } from './config'

export function printExpiredLoginAndExit(): never {
  console.error('Stored Agentis login is expired or invalid. Run `agentis logout` and then `agentis login`.')
  process.exit(1)
}

export async function fetchAccountAgents(token: string): Promise<any[]> {
  const res = await apiFetch('/account/agents', {}, token)
  if (res.status === 401) printExpiredLoginAndExit()
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    console.error('Failed to fetch hosted agents:', data.error ?? res.statusText)
    process.exit(1)
  }
  return res.json()
}

export async function findAccountAgent(nameOrId: string, token: string): Promise<any | null> {
  const agents = await fetchAccountAgents(token)
  return agents.find((a: any) => a.id === nameOrId || a.name === nameOrId) ?? null
}

export async function resolveAccountAgent(nameOrId: string, token: string): Promise<any> {
  const agent = await findAccountAgent(nameOrId, token)
  if (!agent) {
    console.error(`Hosted agent not found: ${nameOrId}`)
    process.exit(1)
  }
  return agent
}
