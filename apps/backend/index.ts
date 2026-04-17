import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import agents from './src/routes/agents'

const app = new Hono()

app.use('*', cors({ origin: 'http://localhost:3000' }))
app.use('*', logger())

app.get('/', (c) => c.json({ status: 'ok', service: 'agentis-backend' }))
app.route('/agents', agents)

export default {
  port: process.env.PORT ?? 3001,
  fetch: app.fetch,
}
