import { Hono } from 'hono'
import { privy } from '../lib/privy'
import { getAccountByUserId, createOrUpdateAccount, getAccountByKey, getAgentsByUser, createAgent } from '../lib/db'
import { randomBytes } from 'crypto'
import { deriveOnchainPolicy } from '../lib/onchain-policy'

const account = new Hono<{ Variables: { userId: string; authedViaKey: boolean } }>()

// Middleware: accepts either Privy JWT or account key
account.use('*', async (c, next) => {
  const authHeader = c.req.header('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = authHeader.slice(7)

  if (token.startsWith('agt_user_')) {
    // Account key auth
    const acc = await getAccountByKey(token)
    if (!acc) return c.json({ error: 'Invalid account key' }, 401)
    c.set('userId', acc.userId)
    c.set('authedViaKey', true)
  } else {
    // Privy JWT auth
    try {
      const { userId } = await privy.verifyAuthToken(token)
      c.set('userId', userId)
      c.set('authedViaKey', false)
    } catch {
      return c.json({ error: 'Invalid token' }, 401)
    }
  }
  await next()
})

// GET /account/key — get existing account key (masked) — JWT only
account.get('/key', async (c) => {
  if (c.get('authedViaKey')) return c.json({ error: 'Use Privy JWT to manage account keys' }, 403)
  const userId = c.get('userId')
  const acc = await getAccountByUserId(userId)
  if (!acc) return c.json({ accountKey: null })
  const masked = acc.accountKey.slice(0, 13) + '••••••••' + acc.accountKey.slice(-4)
  return c.json({ accountKey: masked })
})

// POST /account/key — generate or regenerate account key — JWT only
account.post('/key', async (c) => {
  if (c.get('authedViaKey')) return c.json({ error: 'Use Privy JWT to manage account keys' }, 403)
  const userId = c.get('userId')
  const accountKey = 'agt_user_' + randomBytes(24).toString('hex')
  const acc = await createOrUpdateAccount(userId, accountKey)
  return c.json({ accountKey: acc.accountKey })
})

// GET /account/agents — list all agents for this account (JWT or account key)
account.get('/agents', async (c) => {
  const userId = c.get('userId')
  const userAgents = await getAgentsByUser(userId)
  return c.json(userAgents)
})

// POST /account/agents — create a new agent (JWT or account key)
account.post('/agents', async (c) => {
  const userId = c.get('userId')
  const { name, policyMode } = await c.req.json()
  if (!name?.trim()) return c.json({ error: 'Agent name is required' }, 400)

  const wallet = await privy.walletApi.createWallet({ chainType: 'solana' })
  const apiKey = 'agt_live_' + randomBytes(24).toString('hex')

  const walletAddress = wallet.address
  const useOnchainPolicy = policyMode === 'onchain'

  const agent = await createAgent({
    id: crypto.randomUUID(),
    name: name.trim(),
    userId,
    walletId: wallet.id,
    walletAddress,
    apiKey,
    createdAt: new Date().toISOString(),
    policyMode: useOnchainPolicy ? 'onchain' : 'backend',
    onchainPolicy: useOnchainPolicy ? deriveOnchainPolicy(walletAddress) : undefined,
  })

  return c.json(agent, 201)
})

export default account
