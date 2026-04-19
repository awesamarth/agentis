import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import agents from './src/routes/agents'
import sdk from './src/routes/sdk'

const app = new Hono()

app.use('/agents/*', cors({ origin: 'http://localhost:3000' }))
app.use('*', logger())

app.get('/', (c) => c.json({ status: 'ok', service: 'agentis-backend' }))
app.route('/agents', agents)
app.route('/sdk', sdk)

export default {
  port: process.env.PORT ?? 3001,
  fetch: app.fetch,
}
