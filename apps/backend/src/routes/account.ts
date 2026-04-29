import { Hono } from 'hono'
import { privy } from '../lib/privy'
import {
  getAccountByUserId,
  createOrUpdateAccount,
  getAccountByKey,
  getAgentsByUser,
  createAgent,
  createFacilitator,
  getFacilitatorsByUser,
  updateFacilitator,
} from '../lib/db'
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

// GET /account/facilitators — list facilitator records owned by this account
account.get('/facilitators', async (c) => {
  const userId = c.get('userId')
  const facilitators = await getFacilitatorsByUser(userId)
  return c.json(facilitators.map(({ heartbeatSecret, ...safe }) => safe))
})

// POST /account/facilitators — register a facilitator scaffold before deployment
account.post('/facilitators', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const name = String(body.name ?? '').trim()
  if (!name) return c.json({ error: 'Facilitator name is required' }, 400)

  const feeBps = Number(body.feeBps ?? 500)
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 10_000) {
    return c.json({ error: 'feeBps must be between 0 and 10000' }, 400)
  }

  const network = String(body.network ?? 'solana-devnet')
  const acceptedMint = String(body.acceptedMint ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
  const publicUrl = body.publicUrl ? String(body.publicUrl) : null

  const facilitator = await createFacilitator({
    id: 'fac_' + randomBytes(12).toString('hex'),
    ownerUserId: userId,
    name,
    heartbeatSecret: 'agt_fac_hb_' + randomBytes(24).toString('hex'),
    network,
    acceptedMint,
    feeBps,
    publicUrl,
    listed: Boolean(body.listed),
  })

  return c.json(facilitator, 201)
})

// PATCH /account/facilitators/:id — publish/update discoverability metadata
account.patch('/facilitators/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = await c.req.json()

  try {
    const updated = await updateFacilitator(id, userId, {
      name: body.name === undefined ? undefined : String(body.name).trim(),
      publicUrl: body.publicUrl === undefined ? undefined : (body.publicUrl ? String(body.publicUrl) : null),
      listed: body.listed === undefined ? undefined : Boolean(body.listed),
      feeBps: body.feeBps === undefined ? undefined : Number(body.feeBps),
      acceptedMint: body.acceptedMint === undefined ? undefined : String(body.acceptedMint),
      network: body.network === undefined ? undefined : String(body.network),
    })
    const { heartbeatSecret, ...safe } = updated
    return c.json(safe)
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Failed to update facilitator' }, 404)
  }
})

export default account
