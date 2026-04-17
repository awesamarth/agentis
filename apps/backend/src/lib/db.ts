import { join } from 'path'

const DB_PATH = join(import.meta.dir, '../../data/db.json')

type Policy = {
  hourlyLimit: number | null
  dailyLimit: number | null
  monthlyLimit: number | null
  maxBudget: number | null
  maxPerTx: number | null
  allowedDomains: string[]
  killSwitch: boolean
}

type Agent = {
  id: string
  name: string
  userId: string
  walletId: string
  walletAddress: string
  apiKey: string
  createdAt: string
  policy?: Policy
}

type DB = {
  agents: Agent[]
}

async function readDb(): Promise<DB> {
  const file = Bun.file(DB_PATH)
  const exists = await file.exists()
  if (!exists) return { agents: [] }
  return file.json()
}

async function writeDb(data: DB): Promise<void> {
  await Bun.write(DB_PATH, JSON.stringify(data, null, 2))
}

export async function getAgentsByUser(userId: string): Promise<Agent[]> {
  const db = await readDb()
  return db.agents.filter(a => a.userId === userId)
}

export async function createAgent(agent: Agent): Promise<Agent> {
  const db = await readDb()
  db.agents.push(agent)
  await writeDb(db)
  return agent
}

export async function getAgentById(id: string): Promise<Agent | undefined> {
  const db = await readDb()
  return db.agents.find(a => a.id === id)
}

export async function updateAgent(id: string, patch: Partial<Agent>): Promise<Agent> {
  const db = await readDb()
  const idx = db.agents.findIndex(a => a.id === id)
  if (idx === -1) throw new Error('Agent not found')
  // never allow patching sensitive fields — only name and policy
  const safe: Partial<Pick<Agent, 'name' | 'policy'>> = {}
  if (patch.name !== undefined) safe.name = patch.name
  if (patch.policy !== undefined) safe.policy = patch.policy
  db.agents[idx] = { ...db.agents[idx]!, ...safe }
  await writeDb(db)
  return db.agents[idx]!
}

export async function getAgentByApiKey(apiKey: string): Promise<Agent | undefined> {
  const db = await readDb()
  return db.agents.find(a => a.apiKey === apiKey)
}
