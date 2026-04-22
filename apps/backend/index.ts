import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import agents from './src/routes/agents'
import sdk from './src/routes/sdk'
import account from './src/routes/account'
import { solToUsd } from './src/lib/price'

const app = new Hono()

app.use('/agents/*', cors({ origin: 'http://localhost:3000' }))
app.use('/account/*', cors({ origin: 'http://localhost:3000' }))
app.use('/sol-price', cors({ origin: '*' }))
app.use('*', logger())

app.get('/', (c) => c.json({ status: 'ok', service: 'agentis-backend' }))

app.get('/sol-price', async (c) => {
  const usd = await solToUsd(1)
  return c.json({ usd })
})
app.route('/agents', agents)
app.route('/sdk', sdk)
app.route('/account', account)

export default {
  port: process.env.PORT ?? 3001,
  fetch: app.fetch,
}
