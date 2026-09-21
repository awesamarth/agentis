import { Hono } from 'hono'
import { z } from 'zod'
import type { Principal } from '../../operations'
import { resolveRecipient } from './resolution'
import type { EnsService } from './service'

const id = z.string().uuid()
export function ensPublicRoutes() {
  const app = new Hono()
  app.get('/resolve', async c => c.json(await resolveRecipient(z.string().min(1).max(255).parse(c.req.query('name')), z.string().max(128).parse(c.req.query('chainId')))))
  return app
}
export function ensRoutes(service: EnsService) {
  const app = new Hono<{ Variables: { principal: Principal } }>()
  app.get('/', async c => c.json(await service.show(c.get('principal'), id.parse(c.req.query('walletId')))))
  app.post('/setup', async c => c.json(await service.start(c.get('principal'), await c.req.json())))
  app.post('/next', async c => {
    const input = z.object({ walletId: id }).strict().parse(await c.req.json())
    return c.json(await service.next(c.get('principal'), input.walletId))
  })
  app.post('/records', async c => {
    const input = z.object({ walletId: id, key: z.enum(['endpoint', 'description']), value: z.string().trim().max(2048) }).strict().parse(await c.req.json())
    return c.json(await service.write(c.get('principal'), input.walletId, 'record', input.key, input.value, c.req.header('Idempotency-Key') ?? ''), 202)
  })
  app.post('/retry', async c => {
    const input = z.object({ walletId: id, operationId: id, confirm: z.literal(true) }).strict().parse(await c.req.json())
    return c.json(await service.retry(c.get('principal'), input.walletId, input.operationId))
  })
  app.post('/delegation', async c => {
    const input = z.object({ walletId: id, key: z.enum(['endpoint', 'description']), grant: z.boolean() }).strict().parse(await c.req.json())
    return c.json(await service.delegation(c.get('principal'), input.walletId, input.key, input.grant))
  })
  app.post('/request-setup', async c => {
    const input = z.object({ walletId: id, parent: z.string().max(255).optional(), label: z.string().max(63).optional() }).strict().parse(await c.req.json())
    const wallet = await service.wallet(c.get('principal'), input.walletId)
    const params = new URLSearchParams({ agent: wallet.agentId!, ...(input.parent ? { parent: input.parent } : {}), ...(input.label ? { label: input.label } : {}) })
    return c.json({ approvalUrl: `${service.dashboardUrl}/plugins/ens/setup?${params}`, message: 'Owner must review the name, enable the ENS plugin and Ethereum Sepolia, and sign namespace transactions. No permission changes have been made.' })
  })
  return app
}
