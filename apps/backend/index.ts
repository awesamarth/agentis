import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import agents from './src/routes/agents'
import sdk from './src/routes/sdk'
import account from './src/routes/account'
import auth from './src/routes/auth'
import umbra from './src/routes/umbra'
import facilitators from './src/routes/facilitators'
import { solToUsd } from './src/lib/price'

const app = new Hono()

app.use('/agents/*', cors({ origin: 'http://localhost:3000' }))
app.use('/account/*', cors({ origin: 'http://localhost:3000' }))
app.use('/auth/*', cors({ origin: 'http://localhost:3000' }))
app.use('/sdk/*', cors({ origin: 'http://localhost:3000' }))
app.use('/umbra/*', cors({ origin: 'http://localhost:3000' }))
app.use('/facilitators/*', cors({ origin: '*' }))
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
app.route('/auth', auth)
app.route('/umbra', umbra)
app.route('/facilitators', facilitators)

export default {
  port: process.env.PORT ?? 3001,
  idleTimeout: 60,
  fetch: app.fetch,
}
