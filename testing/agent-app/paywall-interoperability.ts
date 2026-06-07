import { AgentisClient } from '@agentis-hq/sdk'

const apiKey = process.env.AGENTIS_API_KEY
if (!apiKey) throw new Error('AGENTIS_API_KEY is required')

const client = await AgentisClient.create({
  apiKey,
  baseUrl: process.env.AGENTIS_BACKEND_URL ?? 'http://localhost:3001',
})
const server = process.env.SDK_PAYWALL_SERVER ?? 'http://localhost:4003'

const cases = [
  { protocol: 'x402', method: 'POST', expectedStatus: 201 },
  { protocol: 'x402', method: 'PATCH', expectedStatus: 202 },
  { protocol: 'mpp', method: 'POST', expectedStatus: 201 },
  { protocol: 'mpp', method: 'PATCH', expectedStatus: 202 },
] as const

for (const testCase of cases) {
  const body = JSON.stringify({ source: 'official-client', protocol: testCase.protocol })
  const response = await client.fetch(`${server}/${testCase.protocol}-echo`, {
    method: testCase.method,
    headers: { 'content-type': 'application/json' },
    body,
  })

  if (response.status !== testCase.expectedStatus) {
    throw new Error(`${testCase.protocol} ${testCase.method}: expected ${testCase.expectedStatus}, got ${response.status}`)
  }
  if (testCase.protocol === 'x402' && !response.headers.has('payment-response')) {
    throw new Error('x402 paid response is missing PAYMENT-RESPONSE')
  }
  if (testCase.protocol === 'mpp') {
    if (!response.headers.has('payment-receipt')) {
      throw new Error('MPP paid response is missing Payment-Receipt')
    }
    if (response.headers.get('cache-control') !== 'private') {
      throw new Error('MPP paid response must use Cache-Control: private')
    }
  }

  const result = await response.json() as { method?: string; body?: string }
  if (result.method !== testCase.method || result.body !== body) {
    throw new Error(`${testCase.protocol} ${testCase.method}: request changed in transit`)
  }

  console.log(`pass: Agentis ${testCase.protocol} paywall with official ${testCase.protocol} client (${testCase.method})`)
}
