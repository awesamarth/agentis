import { Hono } from 'hono'
import { getListedFacilitators, recordFacilitatorHeartbeat } from '../lib/db'

const facilitators = new Hono()

facilitators.get('/explore', async (c) => {
  const listed = await getListedFacilitators()
  return c.json(listed.map(({ heartbeatSecret, ownerUserId, ...safe }) => safe))
})

facilitators.post('/:id/heartbeat', async (c) => {
  const id = c.req.param('id')
  const secret = c.req.header('x-agentis-heartbeat-secret')
  if (!secret) return c.json({ error: 'Missing heartbeat secret' }, 401)

  const body = await c.req.json().catch(() => ({}))
  const updated = await recordFacilitatorHeartbeat(id, secret, {
    publicUrl: body.publicUrl ? String(body.publicUrl) : undefined,
    version: body.version ? String(body.version) : undefined,
    supported: Array.isArray(body.supported) ? body.supported.map(String) : undefined,
    settledCount: body.settledCount === undefined ? undefined : Number(body.settledCount),
    settledVolumeUsd: body.settledVolumeUsd === undefined ? undefined : Number(body.settledVolumeUsd),
    sellerCount: body.sellerCount === undefined ? undefined : Number(body.sellerCount),
    feeBps: body.feeBps === undefined ? undefined : Number(body.feeBps),
  })

  if (!updated) return c.json({ error: 'Invalid facilitator heartbeat' }, 401)
  return c.json({ ok: true, status: updated.status, listed: updated.listed })
})

export default facilitators
