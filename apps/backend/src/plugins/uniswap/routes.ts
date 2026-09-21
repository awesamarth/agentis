import { Hono } from 'hono'
import { z } from 'zod'
import type { Principal } from '../../operations'
import type { UniswapService } from './service'

const id = z.string().uuid()

export function uniswapRoutes(service: UniswapService) {
  const app = new Hono<{ Variables: { principal: Principal } }>()
  app.post('/dca-requests', async c => c.json(await service.requestSetup(c.get('principal'), await c.req.json()), 201))
  app.get('/dca-requests/:id', async c => c.json(await service.setup(c.get('principal'), id.parse(c.req.param('id')))))
  app.post('/dca-requests/:id', async c => {
    const input = z.object({ approve: z.boolean(), confirm: z.literal(true) }).strict().parse(await c.req.json())
    return c.json(await service.completeSetup(c.get('principal'), id.parse(c.req.param('id')), input.approve))
  })
  app.post('/fetch', async c => c.json(await service.fundFetch(c.get('principal'), await c.req.json(), c.req.header('Idempotency-Key') ?? ''), 202))
  app.post('/quote', async c => c.json(await service.quote(c.get('principal'), await c.req.json())))
  app.post('/swaps', async c => c.json(await service.create(c.get('principal'), await c.req.json(), c.req.header('Idempotency-Key') ?? ''), 202))
  app.get('/swaps/:id', async c => c.json(await service.get(c.get('principal'), id.parse(c.req.param('id')))))
  app.get('/rebalance-target', async c => c.json(await service.target(c.get('principal'), id.parse(c.req.query('walletId')))))
  app.post('/rebalance-target', async c => {
    const input = z.object({ walletId: id, ethPercent: z.number().int().min(0).max(100) }).strict().parse(await c.req.json())
    return c.json(await service.saveTarget(c.get('principal'), input.walletId, input.ethPercent))
  })
  app.post('/rebalance/execute', async c => {
    const input = z.object({ walletId: id, ethPercent: z.number().int().min(0).max(100) }).strict().parse(await c.req.json())
    return c.json(await service.executeRebalance(c.get('principal'), input.walletId, input.ethPercent, c.req.header('Idempotency-Key') ?? ''), 202)
  })
  app.post('/rebalance', async c => {
    const input = z.object({ walletId: id, ethPercent: z.number().int().min(0).max(100) }).strict().parse(await c.req.json())
    return c.json(await service.rebalance(c.get('principal'), input.walletId, input.ethPercent))
  })
  app.get('/dca', async c => c.json(await service.listSchedules(c.get('principal'), id.parse(c.req.query('walletId')))))
  app.post('/dca', async c => c.json(await service.saveSchedule(c.get('principal'), await c.req.json()), 201))
  app.put('/dca/:id', async c => c.json(await service.saveSchedule(c.get('principal'), await c.req.json(), id.parse(c.req.param('id')))))
  app.patch('/dca/:id', async c => {
    const input = z.object({ status: z.enum(['active', 'paused', 'cancelled']), confirm: z.literal(true) }).strict().parse(await c.req.json())
    return c.json(await service.scheduleStatus(c.get('principal'), id.parse(c.req.param('id')), input.status))
  })
  return app
}
