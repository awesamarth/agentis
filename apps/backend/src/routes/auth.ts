import { Hono } from 'hono'
import { privy } from '../lib/privy'
import { createLoginSession, getLoginSession, completeLoginSession, createOrUpdateAccount } from '../lib/db'
import { randomBytes } from 'crypto'

const auth = new Hono()

// POST /auth/session — CLI calls this to start a login flow
// Returns sessionId + the URL the user should open in browser
auth.post('/session', async (c) => {
  const id = randomBytes(16).toString('hex')
  await createLoginSession(id)
  const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3000'
  return c.json({
    sessionId: id,
    loginUrl: `${dashboardUrl}/cli-auth?session=${id}`,
  })
})

// GET /auth/session/:id — CLI polls this
auth.get('/session/:id', async (c) => {
  const session = await getLoginSession(c.req.param('id'))
  if (!session) return c.json({ error: 'Session not found' }, 404)

  if (new Date(session.expiresAt) < new Date()) {
    return c.json({ error: 'Session expired' }, 410)
  }

  if (session.status === 'complete') {
    return c.json({ status: 'complete', accountKey: session.accountKey })
  }

  return c.json({ status: 'pending' })
})

// POST /auth/session/:id/complete — dashboard calls this after Privy login
auth.post('/session/:id/complete', async (c) => {
  const session = await getLoginSession(c.req.param('id'))
  if (!session) return c.json({ error: 'Session not found' }, 404)
  if (new Date(session.expiresAt) < new Date()) return c.json({ error: 'Session expired' }, 410)
  if (session.status === 'complete') return c.json({ error: 'Session already completed' }, 400)

  const authHeader = c.req.header('authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  const token = authHeader.slice(7)

  let userId: string
  try {
    const verified = await privy.verifyAuthToken(token)
    userId = verified.userId
  } catch {
    return c.json({ error: 'Invalid Privy token' }, 401)
  }

  // Generate or reuse account key
  const accountKey = 'agt_user_' + randomBytes(24).toString('hex')
  await createOrUpdateAccount(userId, accountKey)
  await completeLoginSession(session.id, accountKey)

  return c.json({ success: true })
})

export default auth
