import { AgentisClient } from '@agentis-hq/sdk'

const apiKey = process.env.AGENTIS_API_KEY
if (!apiKey) throw new Error('AGENTIS_API_KEY is required')

const client = await AgentisClient.create({
  apiKey,
  baseUrl: process.env.AGENTIS_BACKEND_URL ?? 'http://localhost:3001',
})

const cases = [
  {
    name: 'external x402 POST',
    url: `${process.env.X402_SERVER ?? 'http://localhost:4000'}/echo`,
    method: 'POST',
    expectedStatus: 201,
  },
  {
    name: 'external x402 PATCH',
    url: `${process.env.X402_SERVER ?? 'http://localhost:4000'}/echo`,
    method: 'PATCH',
    expectedStatus: 202,
  },
  {
    name: 'external MPP POST',
    url: `${process.env.MPP_SERVER ?? 'http://localhost:4001'}/mpp-echo`,
    method: 'POST',
    expectedStatus: 201,
  },
  {
    name: 'external MPP PATCH',
    url: `${process.env.MPP_SERVER ?? 'http://localhost:4001'}/mpp-echo`,
    method: 'PATCH',
    expectedStatus: 202,
  },
] as const

for (const testCase of cases) {
  const requestBody = JSON.stringify({ name: testCase.name })
  const response = await client.fetch(testCase.url, {
    method: testCase.method,
    headers: {
      'content-type': 'application/json',
      'x-agentis-conformance': 'paid-methods',
    },
    body: requestBody,
  })

  if (response.status !== testCase.expectedStatus) {
    throw new Error(`${testCase.name}: expected ${testCase.expectedStatus}, got ${response.status}: ${await response.text()}`)
  }

  const result = await response.json() as {
    method?: string
    contentType?: string
    body?: string
  }
  if (result.method !== testCase.method || result.body !== requestBody) {
    throw new Error(`${testCase.name}: request was not preserved: ${JSON.stringify(result)}`)
  }

  console.log(`pass: ${testCase.name}`)
}
