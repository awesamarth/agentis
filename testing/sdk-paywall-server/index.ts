import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { honoPaywall, paywall } from '@agentis-hq/sdk/server'

const PORT = Number(process.env.PORT ?? 4003)
const RECIPIENT = process.env.RECIPIENT_ADDRESS ?? '77rKFXbTbWQMXeQ97AYwThPcuh8sotTtz3jssRMRszGq'
const MPP_SECRET_KEY = process.env.MPP_SECRET_KEY ?? 'agentis-sdk-paywall-test-secret'

const app = new Hono()
app.use('*', logger())

app.get('/', c => c.json({
  status: 'ok',
  service: 'agentis-sdk-paywall-server',
  recipient: RECIPIENT,
  endpoints: [
    '/mpp-sol',
    '/mpp-usdc',
    '/mpp-usdt',
    '/x402-usdc',
    '/x402-usdt',
    '/both-usdc',
    '/x402-echo',
    '/mpp-echo',
    '/standard-mpp-usdc',
  ],
}))

app.use('/mpp-sol', honoPaywall({
  protocol: 'mpp',
  asset: 'sol',
  amount: '10000',
  recipient: RECIPIENT,
  mppSecretKey: MPP_SECRET_KEY,
  mppRealm: 'agentis-sdk-paywall-test',
  description: 'SDK MPP SOL test',
}))
app.get('/mpp-sol', c => c.json({ ok: true, protocol: 'mpp', asset: 'sol' }))

app.use('/mpp-usdc', honoPaywall({
  protocol: 'mpp',
  asset: 'usdc',
  amount: '1000',
  recipient: RECIPIENT,
  mppSecretKey: MPP_SECRET_KEY,
  mppRealm: 'agentis-sdk-paywall-test',
  description: 'SDK MPP USDC test',
}))
app.get('/mpp-usdc', c => c.json({ ok: true, protocol: 'mpp', asset: 'usdc' }))

app.use('/mpp-usdt', honoPaywall({
  protocol: 'mpp',
  asset: 'usdt',
  amount: '1000',
  recipient: RECIPIENT,
  mppSecretKey: MPP_SECRET_KEY,
  mppRealm: 'agentis-sdk-paywall-test',
  description: 'SDK MPP USDT test',
}))
app.get('/mpp-usdt', c => c.json({ ok: true, protocol: 'mpp', asset: 'usdt' }))

app.use('/x402-usdc', honoPaywall({
  protocol: 'x402',
  asset: 'usdc',
  amount: '1000',
  recipient: RECIPIENT,
  description: 'SDK x402 USDC test',
}))
app.get('/x402-usdc', c => c.json({ ok: true, protocol: 'x402', asset: 'usdc' }))

app.use('/x402-usdt', honoPaywall({
  protocol: 'x402',
  asset: 'usdt',
  amount: '1000',
  recipient: RECIPIENT,
  description: 'SDK x402 USDT test',
}))
app.get('/x402-usdt', c => c.json({ ok: true, protocol: 'x402', asset: 'usdt' }))

app.use('/both-usdc', honoPaywall({
  protocol: 'both',
  asset: 'usdc',
  amount: '1000',
  recipient: RECIPIENT,
  mppSecretKey: MPP_SECRET_KEY,
  mppRealm: 'agentis-sdk-paywall-test',
  description: 'SDK dual MPP/x402 USDC test',
}))
app.get('/both-usdc', c => c.json({ ok: true, protocol: 'both', asset: 'usdc' }))

app.use('/x402-echo', honoPaywall({
  protocol: 'x402',
  asset: 'usdc',
  amount: '1000',
  recipient: RECIPIENT,
  description: 'SDK x402 method forwarding test',
}))
app.all('/x402-echo', async c => c.json({
  ok: true,
  protocol: 'x402',
  method: c.req.method,
  contentType: c.req.header('content-type'),
  body: await c.req.text(),
}, c.req.method === 'POST' ? 201 : 202))

app.use('/mpp-echo', honoPaywall({
  protocol: 'mpp',
  asset: 'usdc',
  amount: '1000',
  recipient: RECIPIENT,
  mppSecretKey: MPP_SECRET_KEY,
  mppRealm: 'agentis-sdk-paywall-test',
  description: 'SDK MPP method forwarding test',
}))
app.all('/mpp-echo', async c => c.json({
  ok: true,
  protocol: 'mpp',
  method: c.req.method,
  contentType: c.req.header('content-type'),
  body: await c.req.text(),
}, c.req.method === 'POST' ? 201 : 202))

const standardMppUsdc = paywall({
  protocol: 'mpp',
  asset: 'usdc',
  amount: '1000',
  recipient: RECIPIENT,
  mppSecretKey: MPP_SECRET_KEY,
  mppRealm: 'agentis-sdk-paywall-test',
  description: 'SDK standard Request/Response MPP USDC test',
}, async () => Response.json({ ok: true, adapter: 'standard', protocol: 'mpp', asset: 'usdc' }))

app.all('/standard-mpp-usdc', c => standardMppUsdc(c.req.raw))

export default {
  port: PORT,
  fetch: app.fetch,
}

console.log(`Agentis SDK paywall test server running on http://localhost:${PORT}`)
console.log(`  Recipient: ${RECIPIENT}`)
console.log('  GET /mpp-sol           - 10000 lamports via MPP')
console.log('  GET /mpp-usdc          - 1000 atomic devnet USDC via MPP')
console.log('  GET /mpp-usdt          - 1000 atomic devnet dUSDT via MPP')
console.log('  GET /x402-usdc         - 1000 atomic devnet USDC via x402')
console.log('  GET /x402-usdt         - 1000 atomic devnet dUSDT via x402')
console.log('  GET /both-usdc         - 1000 atomic devnet USDC via MPP or x402')
console.log('  POST/PATCH /x402-echo  - 1000 atomic devnet USDC via x402')
console.log('  POST/PATCH /mpp-echo   - 1000 atomic devnet USDC via MPP')
console.log('  GET /standard-mpp-usdc - standard Request/Response helper')
