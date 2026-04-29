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

type PolicyMode = 'backend' | 'onchain'

type OnchainPolicyState = {
  programId: string
  owner: string
  agent: string
  policy: string
  spendCounter: string
  initialized: boolean
  initializedAt?: string
  initializedSignature?: string
  lastPolicySignature?: string
  lastSpendSignature?: string
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
  privacyEnabled?: boolean
  umbraStatus?: 'disabled' | 'pending' | 'registered' | 'failed'
  umbraRegisteredAt?: string
  umbraRegistrationSignatures?: string[]
  umbraError?: string
  policyMode?: PolicyMode
  onchainPolicy?: OnchainPolicyState
  policy?: Policy
  transactions: TxRecord[]
  monthSpend: { month: string; spend: number }  // month = "YYYY-MM"
}

type Account = {
  userId: string       // Privy DID
  accountKey: string   // agt_user_xxx
  createdAt: string
}

export type FacilitatorRecord = {
  id: string
  ownerUserId: string
  name: string
  status: 'scaffolded' | 'live' | 'offline'
  heartbeatSecret: string
  network: string
  acceptedMint: string
  feeBps: number
  publicUrl: string | null
  listed: boolean
  createdAt: string
  updatedAt: string
  lastHeartbeatAt?: string
  metrics?: {
    version?: string
    supported?: string[]
    settledCount?: number
    settledVolumeUsd?: number
    sellerCount?: number
    feeBps?: number
  }
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
  facilitators: FacilitatorRecord[]
}

async function readDb(): Promise<DB> {
  const file = Bun.file(DB_PATH)
  const exists = await file.exists()
  if (!exists) return { agents: [], accounts: [], loginSessions: [], facilitators: [] }
  const data = await file.json()
  if (!data.accounts) data.accounts = []
  if (!data.loginSessions) data.loginSessions = []
  if (!data.facilitators) data.facilitators = []
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
    .map(a => ({
      ...a,
      privacyEnabled: a.privacyEnabled ?? false,
      umbraStatus: a.umbraStatus ?? (a.privacyEnabled ? 'pending' : 'disabled'),
      policyMode: a.policyMode ?? 'backend',
      transactions: a.transactions ?? [],
      monthSpend: a.monthSpend ?? { month: '', spend: 0 },
    }))
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
  // never allow patching sensitive fields — only user-controlled config and system privacy status
  const safe: Partial<Pick<Agent, 'name' | 'policy' | 'policyMode' | 'onchainPolicy' | 'privacyEnabled' | 'umbraStatus' | 'umbraRegisteredAt' | 'umbraRegistrationSignatures' | 'umbraError'>> = {}
  if (patch.name !== undefined) safe.name = patch.name
  if (patch.policy !== undefined) safe.policy = patch.policy
  if (patch.policyMode !== undefined) safe.policyMode = patch.policyMode
  if (patch.onchainPolicy !== undefined) safe.onchainPolicy = patch.onchainPolicy
  if (patch.privacyEnabled !== undefined) safe.privacyEnabled = patch.privacyEnabled
  if (patch.umbraStatus !== undefined) safe.umbraStatus = patch.umbraStatus
  if (patch.umbraRegisteredAt !== undefined) safe.umbraRegisteredAt = patch.umbraRegisteredAt
  if (patch.umbraRegistrationSignatures !== undefined) safe.umbraRegistrationSignatures = patch.umbraRegistrationSignatures
  if (patch.umbraError !== undefined) safe.umbraError = patch.umbraError
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

export async function createFacilitator(input: Omit<FacilitatorRecord, 'createdAt' | 'updatedAt' | 'status' | 'publicUrl' | 'metrics' | 'lastHeartbeatAt'> & { publicUrl?: string | null }): Promise<FacilitatorRecord> {
  const db = await readDb()
  const now = new Date().toISOString()
  const facilitator: FacilitatorRecord = {
    ...input,
    status: 'scaffolded',
    publicUrl: input.publicUrl ?? null,
    createdAt: now,
    updatedAt: now,
  }
  db.facilitators.push(facilitator)
  await writeDb(db)
  return facilitator
}

export async function getFacilitatorsByUser(userId: string): Promise<FacilitatorRecord[]> {
  const db = await readDb()
  return db.facilitators.filter(f => f.ownerUserId === userId)
}

export async function getFacilitatorById(id: string): Promise<FacilitatorRecord | undefined> {
  const db = await readDb()
  return db.facilitators.find(f => f.id === id)
}

export async function updateFacilitator(id: string, ownerUserId: string, patch: Partial<Pick<FacilitatorRecord, 'name' | 'publicUrl' | 'listed' | 'feeBps' | 'acceptedMint' | 'network'>>): Promise<FacilitatorRecord> {
  const db = await readDb()
  const idx = db.facilitators.findIndex(f => f.id === id && f.ownerUserId === ownerUserId)
  if (idx === -1) throw new Error('Facilitator not found')
  const current = db.facilitators[idx]!
  const safePatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  db.facilitators[idx] = {
    ...current,
    ...safePatch,
    status: current.lastHeartbeatAt ? 'live' : current.status,
    updatedAt: new Date().toISOString(),
  }
  await writeDb(db)
  return db.facilitators[idx]!
}

export async function recordFacilitatorHeartbeat(id: string, heartbeatSecret: string, metrics: FacilitatorRecord['metrics'] & { publicUrl?: string | null }): Promise<FacilitatorRecord | undefined> {
  const db = await readDb()
  const idx = db.facilitators.findIndex(f => f.id === id && f.heartbeatSecret === heartbeatSecret)
  if (idx === -1) return undefined
  const now = new Date().toISOString()
  const current = db.facilitators[idx]!
  db.facilitators[idx] = {
    ...current,
    status: 'live',
    publicUrl: metrics.publicUrl ?? current.publicUrl,
    lastHeartbeatAt: now,
    updatedAt: now,
    metrics: {
      version: metrics.version,
      supported: metrics.supported,
      settledCount: metrics.settledCount,
      settledVolumeUsd: metrics.settledVolumeUsd,
      sellerCount: metrics.sellerCount,
      feeBps: metrics.feeBps,
    },
  }
  await writeDb(db)
  return db.facilitators[idx]!
}

export async function getListedFacilitators(): Promise<FacilitatorRecord[]> {
  const db = await readDb()
  const cutoff = Date.now() - 2 * 60 * 1000
  return db.facilitators
    .filter(f => f.listed && f.publicUrl)
    .map(f => {
      const lastSeen = f.lastHeartbeatAt ? new Date(f.lastHeartbeatAt).getTime() : 0
      return { ...f, status: lastSeen >= cutoff ? 'live' : 'offline' }
    })
}
