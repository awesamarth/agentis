import { join } from 'path'
import { createHmac, timingSafeEqual } from 'crypto'

const DB_PATH = process.env.AGENTIS_DB_PATH ?? join(import.meta.dir, '../../data/db.json')
const KEY_SECRETS_PATH = process.env.AGENTIS_KEY_SECRETS_PATH ?? join(import.meta.dir, '../../data/key-secrets.json')
const KEY_HASH_SECRET = process.env.API_KEY_HASH_SECRET ?? 'agentis-local-dev-key-hash-secret'

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
  apiKey?: string
  apiKeyHash?: string
  apiKeyPrefix?: string
  apiKeySuffix?: string
  apiKeyMasked?: string
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
  accountKey?: string
  accountKeyHash?: string
  accountKeyPrefix?: string
  accountKeySuffix?: string
  accountKeyMasked?: string
  createdAt: string
}

export type OAuthClient = {
  clientId: string
  clientName: string
  redirectUris: string[]
  tokenEndpointAuthMethod: 'none'
  grantTypes: Array<'authorization_code' | 'refresh_token'>
  createdAt: string
}

export type OAuthAuthorizationRequest = {
  id: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  scope: string[]
  state?: string
  resource?: string
  status: 'pending' | 'approved' | 'denied'
  userId?: string
  createdAt: string
  expiresAt: string
}

type OAuthAuthorizationCode = {
  codeHash: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  scope: string[]
  userId: string
  resource?: string
  createdAt: string
  expiresAt: string
  usedAt?: string
}

export type OAuthGrant = {
  id: string
  userId: string
  clientId: string
  clientName: string
  scope: string[]
  resource?: string
  accessTokenHash: string
  accessTokenExpiresAt: string
  refreshTokenHash: string
  refreshTokenExpiresAt: string
  createdAt: string
  updatedAt: string
  revokedAt?: string
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
  oauthClients: OAuthClient[]
  oauthAuthorizationRequests: OAuthAuthorizationRequest[]
  oauthAuthorizationCodes: OAuthAuthorizationCode[]
  oauthGrants: OAuthGrant[]
}

type KeySecrets = {
  agents: Record<string, { apiKey: string; masked: string; updatedAt: string }>
  accounts: Record<string, { accountKey: string; masked: string; updatedAt: string }>
  loginSessions: Record<string, { accountKey: string; masked: string; expiresAt: string; updatedAt: string }>
}

function maskKey(key: string): string {
  return `${key.slice(0, 13)}••••••••${key.slice(-4)}`
}

function hashKey(key: string): string {
  return createHmac('sha256', KEY_HASH_SECRET).update(key).digest('hex')
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

async function readKeySecrets(): Promise<KeySecrets> {
  const file = Bun.file(KEY_SECRETS_PATH)
  if (!(await file.exists())) return { agents: {}, accounts: {}, loginSessions: {} }
  const data = await file.json().catch(() => ({}))
  return {
    agents: data.agents ?? {},
    accounts: data.accounts ?? {},
    loginSessions: data.loginSessions ?? {},
  }
}

async function writeKeySecrets(data: KeySecrets): Promise<void> {
  await Bun.write(KEY_SECRETS_PATH, JSON.stringify(data, null, 2))
}

function attachAgentMasked(agent: Agent): Agent {
  return {
    ...agent,
    apiKeyMasked: agent.apiKeyMasked ?? (
      agent.apiKeyPrefix && agent.apiKeySuffix
        ? `${agent.apiKeyPrefix}••••••••${agent.apiKeySuffix}`
        : undefined
    ),
  }
}

function attachAccountMasked(account: Account): Account {
  return {
    ...account,
    accountKeyMasked: account.accountKeyMasked ?? (
      account.accountKeyPrefix && account.accountKeySuffix
        ? `${account.accountKeyPrefix}••••••••${account.accountKeySuffix}`
        : undefined
    ),
  }
}

async function migratePlaintextKeys(data: DB): Promise<boolean> {
  let changed = false
  const secrets = await readKeySecrets()
  const now = new Date().toISOString()

  for (const agent of data.agents ?? []) {
    if (agent.apiKey?.startsWith('agt_live_')) {
      secrets.agents[agent.id] = {
        apiKey: agent.apiKey,
        masked: maskKey(agent.apiKey),
        updatedAt: now,
      }
      agent.apiKeyHash = hashKey(agent.apiKey)
      agent.apiKeyPrefix = agent.apiKey.slice(0, 13)
      agent.apiKeySuffix = agent.apiKey.slice(-4)
      agent.apiKeyMasked = maskKey(agent.apiKey)
      delete agent.apiKey
      changed = true
    }
  }

  for (const account of data.accounts ?? []) {
    if (account.accountKey?.startsWith('agt_user_')) {
      secrets.accounts[account.userId] = {
        accountKey: account.accountKey,
        masked: maskKey(account.accountKey),
        updatedAt: now,
      }
      account.accountKeyHash = hashKey(account.accountKey)
      account.accountKeyPrefix = account.accountKey.slice(0, 13)
      account.accountKeySuffix = account.accountKey.slice(-4)
      account.accountKeyMasked = maskKey(account.accountKey)
      delete account.accountKey
      changed = true
    }
  }

  for (const session of data.loginSessions ?? []) {
    if (session.accountKey?.startsWith('agt_user_')) {
      secrets.loginSessions[session.id] = {
        accountKey: session.accountKey,
        masked: maskKey(session.accountKey),
        expiresAt: session.expiresAt,
        updatedAt: now,
      }
      delete session.accountKey
      changed = true
    }
  }

  if (changed) {
    await writeKeySecrets(secrets)
  }
  return changed
}

async function readDb(): Promise<DB> {
  const file = Bun.file(DB_PATH)
  const exists = await file.exists()
  if (!exists) {
    return {
      agents: [],
      accounts: [],
      loginSessions: [],
      facilitators: [],
      oauthClients: [],
      oauthAuthorizationRequests: [],
      oauthAuthorizationCodes: [],
      oauthGrants: [],
    }
  }
  const data = await file.json()
  if (!data.accounts) data.accounts = []
  if (!data.loginSessions) data.loginSessions = []
  if (!data.facilitators) data.facilitators = []
  if (!data.oauthClients) data.oauthClients = []
  if (!data.oauthAuthorizationRequests) data.oauthAuthorizationRequests = []
  if (!data.oauthAuthorizationCodes) data.oauthAuthorizationCodes = []
  if (!data.oauthGrants) data.oauthGrants = []
  const migrated = await migratePlaintextKeys(data)
  // Migrate old tx records missing amountUsd — assume 1:1 with raw amount as fallback
  for (const agent of data.agents ?? []) {
    for (const tx of agent.transactions ?? []) {
      if (tx.amountUsd === undefined) tx.amountUsd = tx.amount
    }
  }
  if (migrated) await Bun.write(DB_PATH, JSON.stringify(data, null, 2))
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
    .map(attachAgentMasked)
}

export async function createAgent(agent: Omit<Agent, 'transactions' | 'monthSpend'> & { apiKey: string }): Promise<Agent> {
  const db = await readDb()
  const apiKey = agent.apiKey
  const { apiKey: _apiKey, ...rest } = agent
  const full: Agent = {
    ...rest,
    apiKeyHash: hashKey(apiKey),
    apiKeyPrefix: apiKey.slice(0, 13),
    apiKeySuffix: apiKey.slice(-4),
    apiKeyMasked: maskKey(apiKey),
    transactions: [],
    monthSpend: { month: '', spend: 0 },
  }
  db.agents.push(full)
  const secrets = await readKeySecrets()
  secrets.agents[full.id] = { apiKey, masked: maskKey(apiKey), updatedAt: new Date().toISOString() }
  await writeKeySecrets(secrets)
  await writeDb(db)
  return { ...full, apiKey }
}

export async function getAgentById(id: string): Promise<Agent | undefined> {
  const db = await readDb()
  const agent = db.agents.find(a => a.id === id)
  return agent ? attachAgentMasked(agent) : undefined
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
  db.agents[idx] = {
    ...db.agents[idx]!,
    apiKeyHash: hashKey(apiKey),
    apiKeyPrefix: apiKey.slice(0, 13),
    apiKeySuffix: apiKey.slice(-4),
    apiKeyMasked: maskKey(apiKey),
  }
  delete db.agents[idx]!.apiKey
  const secrets = await readKeySecrets()
  secrets.agents[id] = { apiKey, masked: maskKey(apiKey), updatedAt: new Date().toISOString() }
  await writeKeySecrets(secrets)
  await writeDb(db)
  return { ...db.agents[idx]!, apiKey }
}

export async function getAgentByApiKey(apiKey: string): Promise<Agent | undefined> {
  const db = await readDb()
  const hash = hashKey(apiKey)
  const agent = db.agents.find(a => a.apiKeyHash && safeCompare(a.apiKeyHash, hash))
  return agent ? attachAgentMasked(agent) : undefined
}

export async function getAgentApiKeySecret(id: string): Promise<string | undefined> {
  const secrets = await readKeySecrets()
  return secrets.agents[id]?.apiKey
}

export async function getAccountByUserId(userId: string): Promise<Account | undefined> {
  const db = await readDb()
  const account = db.accounts.find(a => a.userId === userId)
  return account ? attachAccountMasked(account) : undefined
}

export async function getAccountByKey(accountKey: string): Promise<Account | undefined> {
  const db = await readDb()
  const hash = hashKey(accountKey)
  const account = db.accounts.find(a => a.accountKeyHash && safeCompare(a.accountKeyHash, hash))
  return account ? attachAccountMasked(account) : undefined
}

export async function getAccountKeySecret(userId: string): Promise<string | undefined> {
  const secrets = await readKeySecrets()
  return secrets.accounts[userId]?.accountKey
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
  db.loginSessions[idx] = { ...db.loginSessions[idx]!, status: 'complete' }
  const secrets = await readKeySecrets()
  secrets.loginSessions[id] = {
    accountKey,
    masked: maskKey(accountKey),
    expiresAt: db.loginSessions[idx]!.expiresAt,
    updatedAt: new Date().toISOString(),
  }
  await writeKeySecrets(secrets)
  await writeDb(db)
  return db.loginSessions[idx]!
}

export async function getLoginSessionAccountKey(id: string): Promise<string | undefined> {
  const secrets = await readKeySecrets()
  const entry = secrets.loginSessions[id]
  if (!entry) return undefined
  if (new Date(entry.expiresAt) < new Date()) return undefined
  return entry.accountKey
}

export async function createOrUpdateAccount(userId: string, accountKey: string): Promise<Account> {
  const db = await readDb()
  const existing = db.accounts.findIndex(a => a.userId === userId)
  const account: Account = {
    userId,
    accountKeyHash: hashKey(accountKey),
    accountKeyPrefix: accountKey.slice(0, 13),
    accountKeySuffix: accountKey.slice(-4),
    accountKeyMasked: maskKey(accountKey),
    createdAt: new Date().toISOString(),
  }
  if (existing !== -1) {
    db.accounts[existing] = account
  } else {
    db.accounts.push(account)
  }
  const secrets = await readKeySecrets()
  secrets.accounts[userId] = { accountKey, masked: maskKey(accountKey), updatedAt: new Date().toISOString() }
  await writeKeySecrets(secrets)
  await writeDb(db)
  return { ...account, accountKey }
}

export async function getOAuthClient(clientId: string): Promise<OAuthClient | undefined> {
  if (clientId === 'agentis-cli') {
    return {
      clientId,
      clientName: 'Agentis CLI',
      redirectUris: [],
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code', 'refresh_token'],
      createdAt: '2026-06-07T00:00:00.000Z',
    }
  }
  const db = await readDb()
  return db.oauthClients.find(client => client.clientId === clientId)
}

export async function registerOAuthClient(client: OAuthClient): Promise<OAuthClient> {
  const db = await readDb()
  const existing = db.oauthClients.findIndex(candidate => candidate.clientId === client.clientId)
  if (existing === -1) db.oauthClients.push(client)
  else db.oauthClients[existing] = client
  await writeDb(db)
  return client
}

export async function createOAuthAuthorizationRequest(
  request: OAuthAuthorizationRequest,
): Promise<OAuthAuthorizationRequest> {
  const db = await readDb()
  db.oauthAuthorizationRequests.push(request)
  await writeDb(db)
  return request
}

export async function getOAuthAuthorizationRequest(
  id: string,
): Promise<OAuthAuthorizationRequest | undefined> {
  const db = await readDb()
  return db.oauthAuthorizationRequests.find(request => request.id === id)
}

export async function completeOAuthAuthorizationRequest(
  id: string,
  patch: Pick<OAuthAuthorizationRequest, 'status'> & { userId?: string },
): Promise<OAuthAuthorizationRequest> {
  const db = await readDb()
  const index = db.oauthAuthorizationRequests.findIndex(request => request.id === id)
  if (index === -1) throw new Error('Authorization request not found')
  db.oauthAuthorizationRequests[index] = {
    ...db.oauthAuthorizationRequests[index]!,
    ...patch,
  }
  await writeDb(db)
  return db.oauthAuthorizationRequests[index]!
}

export async function createOAuthAuthorizationCode(input: {
  code: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  scope: string[]
  userId: string
  resource?: string
  expiresAt: string
}): Promise<void> {
  const db = await readDb()
  const { code, ...stored } = input
  db.oauthAuthorizationCodes.push({
    ...stored,
    codeHash: hashKey(code),
    createdAt: new Date().toISOString(),
  })
  await writeDb(db)
}

export async function consumeOAuthAuthorizationCode(
  code: string,
  expected: { clientId: string; redirectUri: string; codeChallenge: string },
): Promise<OAuthAuthorizationCode | undefined> {
  const db = await readDb()
  const hash = hashKey(code)
  const index = db.oauthAuthorizationCodes.findIndex(candidate =>
    !candidate.usedAt &&
    candidate.clientId === expected.clientId &&
    candidate.redirectUri === expected.redirectUri &&
    candidate.codeChallenge === expected.codeChallenge &&
    safeCompare(candidate.codeHash, hash)
  )
  if (index === -1) return undefined
  const authorizationCode = db.oauthAuthorizationCodes[index]!
  if (new Date(authorizationCode.expiresAt) <= new Date()) return undefined
  db.oauthAuthorizationCodes[index] = {
    ...authorizationCode,
    usedAt: new Date().toISOString(),
  }
  await writeDb(db)
  return authorizationCode
}

export async function createOAuthGrant(input: {
  id: string
  userId: string
  clientId: string
  clientName: string
  scope: string[]
  resource?: string
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshTokenExpiresAt: string
}): Promise<OAuthGrant> {
  const db = await readDb()
  const now = new Date().toISOString()
  const grant: OAuthGrant = {
    id: input.id,
    userId: input.userId,
    clientId: input.clientId,
    clientName: input.clientName,
    scope: input.scope,
    resource: input.resource,
    accessTokenHash: hashKey(input.accessToken),
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    refreshTokenHash: hashKey(input.refreshToken),
    refreshTokenExpiresAt: input.refreshTokenExpiresAt,
    createdAt: now,
    updatedAt: now,
  }
  db.oauthGrants.push(grant)
  await writeDb(db)
  return grant
}

export async function getOAuthGrantByAccessToken(token: string): Promise<OAuthGrant | undefined> {
  const db = await readDb()
  const hash = hashKey(token)
  return db.oauthGrants.find(grant =>
    !grant.revokedAt &&
    new Date(grant.accessTokenExpiresAt) > new Date() &&
    safeCompare(grant.accessTokenHash, hash)
  )
}

export async function getOAuthGrantByRefreshToken(token: string): Promise<OAuthGrant | undefined> {
  const db = await readDb()
  const hash = hashKey(token)
  return db.oauthGrants.find(grant =>
    !grant.revokedAt &&
    new Date(grant.refreshTokenExpiresAt) > new Date() &&
    safeCompare(grant.refreshTokenHash, hash)
  )
}

export async function rotateOAuthGrantTokens(input: {
  grantId: string
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshTokenExpiresAt: string
}): Promise<OAuthGrant> {
  const db = await readDb()
  const index = db.oauthGrants.findIndex(grant => grant.id === input.grantId && !grant.revokedAt)
  if (index === -1) throw new Error('OAuth grant not found')
  db.oauthGrants[index] = {
    ...db.oauthGrants[index]!,
    accessTokenHash: hashKey(input.accessToken),
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    refreshTokenHash: hashKey(input.refreshToken),
    refreshTokenExpiresAt: input.refreshTokenExpiresAt,
    updatedAt: new Date().toISOString(),
  }
  await writeDb(db)
  return db.oauthGrants[index]!
}

export async function revokeOAuthToken(token: string): Promise<void> {
  const db = await readDb()
  const hash = hashKey(token)
  const index = db.oauthGrants.findIndex(grant =>
    safeCompare(grant.accessTokenHash, hash) || safeCompare(grant.refreshTokenHash, hash)
  )
  if (index === -1) return
  db.oauthGrants[index] = {
    ...db.oauthGrants[index]!,
    revokedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await writeDb(db)
}

export async function getOAuthGrantsByUser(userId: string): Promise<OAuthGrant[]> {
  const db = await readDb()
  return db.oauthGrants.filter(grant => grant.userId === userId)
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
