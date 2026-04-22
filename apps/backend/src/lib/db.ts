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

export type TxRecord = {
  txHash: string
  amount: number       // SOL (raw chain value)
  amountUsd: number    // USD at time of payment
  recipient: string
  timestamp: string    // ISO
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
  transactions: TxRecord[]
  monthSpend: { month: string; spend: number }  // month = "YYYY-MM"
}

type Account = {
  userId: string       // Privy DID
  accountKey: string   // agt_user_xxx
  createdAt: string
}

export type LoginSession = {
  id: string           // random hex, used as session ID
  status: 'pending' | 'complete'
  accountKey?: string  // set on complete
  createdAt: string
  expiresAt: string    // 10 min TTL
}

type DB = {
  agents: Agent[]
  accounts: Account[]
  loginSessions: LoginSession[]
}

async function readDb(): Promise<DB> {
  const file = Bun.file(DB_PATH)
  const exists = await file.exists()
  if (!exists) return { agents: [], accounts: [], loginSessions: [] }
  const data = await file.json()
  if (!data.accounts) data.accounts = []
  if (!data.loginSessions) data.loginSessions = []
  // Migrate old tx records missing amountUsd — assume 1:1 with raw amount as fallback
  for (const agent of data.agents ?? []) {
    for (const tx of agent.transactions ?? []) {
      if (tx.amountUsd === undefined) tx.amountUsd = tx.amount
    }
  }
  return data
}

async function writeDb(data: DB): Promise<void> {
  await Bun.write(DB_PATH, JSON.stringify(data, null, 2))
}

export async function getAgentsByUser(userId: string): Promise<Agent[]> {
  const db = await readDb()
  return db.agents
    .filter(a => a.userId === userId)
    .map(a => ({ ...a, transactions: a.transactions ?? [], monthSpend: a.monthSpend ?? { month: '', spend: 0 } }))
}

export async function createAgent(agent: Omit<Agent, 'transactions' | 'monthSpend'>): Promise<Agent> {
  const db = await readDb()
  const full: Agent = {
    ...agent,
    transactions: [],
    monthSpend: { month: '', spend: 0 },
  }
  db.agents.push(full)
  await writeDb(db)
  return full
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

export async function recordTransaction(id: string, tx: TxRecord): Promise<void> {
  const db = await readDb()
  const idx = db.agents.findIndex(a => a.id === id)
  if (idx === -1) throw new Error('Agent not found')

  const agent = db.agents[idx]!
  const now = new Date().toISOString().slice(0, 7)

  // Migrate old agents that don't have these fields yet
  if (!agent.transactions) agent.transactions = []
  if (!agent.monthSpend) agent.monthSpend = { month: '', spend: 0 }

  // Reset month cache if it's a new month
  if (agent.monthSpend.month !== now) {
    agent.monthSpend = { month: now, spend: 0 }
  }

  agent.transactions.push(tx)
  agent.monthSpend.spend += tx.amountUsd

  db.agents[idx] = agent
  await writeDb(db)
}

export async function updateAgentApiKey(id: string, apiKey: string): Promise<Agent> {
  const db = await readDb()
  const idx = db.agents.findIndex(a => a.id === id)
  if (idx === -1) throw new Error('Agent not found')
  db.agents[idx] = { ...db.agents[idx]!, apiKey }
  await writeDb(db)
  return db.agents[idx]!
}

export async function getAgentByApiKey(apiKey: string): Promise<Agent | undefined> {
  const db = await readDb()
  return db.agents.find(a => a.apiKey === apiKey)
}

export async function getAccountByUserId(userId: string): Promise<Account | undefined> {
  const db = await readDb()
  return db.accounts.find(a => a.userId === userId)
}

export async function getAccountByKey(accountKey: string): Promise<Account | undefined> {
  const db = await readDb()
  return db.accounts.find(a => a.accountKey === accountKey)
}

export async function createLoginSession(id: string): Promise<LoginSession> {
  const db = await readDb()
  const session: LoginSession = {
    id,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }
  db.loginSessions.push(session)
  await writeDb(db)
  return session
}

export async function getLoginSession(id: string): Promise<LoginSession | undefined> {
  const db = await readDb()
  return db.loginSessions.find(s => s.id === id)
}

export async function completeLoginSession(id: string, accountKey: string): Promise<LoginSession> {
  const db = await readDb()
  const idx = db.loginSessions.findIndex(s => s.id === id)
  if (idx === -1) throw new Error('Session not found')
  db.loginSessions[idx] = { ...db.loginSessions[idx]!, status: 'complete', accountKey }
  await writeDb(db)
  return db.loginSessions[idx]!
}

export async function createOrUpdateAccount(userId: string, accountKey: string): Promise<Account> {
  const db = await readDb()
  const existing = db.accounts.findIndex(a => a.userId === userId)
  const account: Account = { userId, accountKey, createdAt: new Date().toISOString() }
  if (existing !== -1) {
    db.accounts[existing] = account
  } else {
    db.accounts.push(account)
  }
  await writeDb(db)
  return account
}
