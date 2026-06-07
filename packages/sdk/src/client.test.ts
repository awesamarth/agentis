import { afterEach, describe, expect, test } from 'bun:test'
import { AgentisClient } from './client'

const originalFetch = globalThis.fetch
const API_KEY = 'agt_live_test'
const BASE_URL = 'https://api.agentis.test'
const TARGET_URL = 'https://paid.example.test/echo?mode=full'
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

const agent = {
  id: 'agent-test',
  name: 'test-agent',
  walletAddress: '11111111111111111111111111111111',
  policyMode: 'backend',
  privacyEnabled: false,
  policy: {
    hourlyLimit: null,
    dailyLimit: null,
    monthlyLimit: null,
    maxBudget: null,
    maxPerTx: null,
    allowedDomains: [],
    killSwitch: false,
  },
  transactions: [],
}

function x402Challenge(): Response {
  const requirements = {
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      amount: '1000',
      asset: DEVNET_USDC,
      payTo: agent.walletAddress,
      maxTimeoutSeconds: 60,
    }],
  }
  return new Response(null, {
    status: 402,
    headers: {
      'payment-required': btoa(JSON.stringify(requirements)),
    },
  })
}

function mppChallenge(): Response {
  const request = {
    amount: '1000',
    currency: DEVNET_USDC,
    recipient: agent.walletAddress,
    methodDetails: { decimals: 6 },
  }
  const encoded = btoa(JSON.stringify(request))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return new Response(null, {
    status: 402,
    headers: {
      'www-authenticate': `Payment id="test", realm="test", method="solana", intent="charge", request="${encoded}"`,
      'cache-control': 'no-store',
    },
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('AgentisClient.fetch', () => {
  test('forwards an x402 POST body and accepts a 201 response', async () => {
    const calls: Request[] = []
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      calls.push(request)

      if (request.url === `${BASE_URL}/sdk/agent`) return Response.json(agent)
      if (request.url === TARGET_URL) return x402Challenge()
      if (request.url === `${BASE_URL}/sdk/agent/fetch-paid`) {
        const payload = await request.json()
        expect(payload.method).toBe('POST')
        expect(payload.headers['content-type']).toBe('application/json')
        expect(atob(payload.bodyBase64)).toBe('{"hello":"world"}')

        const body = JSON.stringify({ created: true })
        return Response.json({
          status: 201,
          headers: {
            'content-type': 'application/json',
            'content-length': '999',
          },
          bodyBase64: btoa(body),
        })
      }
      throw new Error(`Unexpected request: ${request.url}`)
    }

    const client = await AgentisClient.create({ apiKey: API_KEY, baseUrl: BASE_URL })
    const response = await client.fetch(TARGET_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"hello":"world"}',
    })

    expect(response.status).toBe(201)
    expect(response.headers.has('content-length')).toBe(false)
    expect(await response.json()).toEqual({ created: true })
    expect(calls).toHaveLength(3)
  })

  test('forwards an MPP PATCH body and accepts a 202 binary response', async () => {
    const responseBytes = new Uint8Array([0, 1, 2, 250, 255])
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)

      if (request.url === `${BASE_URL}/sdk/agent`) return Response.json(agent)
      if (request.url === TARGET_URL) return mppChallenge()
      if (request.url === `${BASE_URL}/sdk/agent/fetch-paid-mpp`) {
        const payload = await request.json()
        expect(payload.method).toBe('PATCH')
        expect(payload.headers['content-type']).toBe('application/octet-stream')
        expect(Array.from(Uint8Array.from(atob(payload.bodyBase64), char => char.charCodeAt(0))))
          .toEqual([9, 8, 7])

        return Response.json({
          status: 202,
          headers: {
            'content-type': 'application/octet-stream',
            'content-encoding': 'gzip',
          },
          bodyBase64: btoa(String.fromCharCode(...responseBytes)),
        })
      }
      throw new Error(`Unexpected request: ${request.url}`)
    }

    const client = await AgentisClient.create({ apiKey: API_KEY, baseUrl: BASE_URL })
    const response = await client.fetch(TARGET_URL, {
      method: 'PATCH',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array([9, 8, 7]),
    })

    expect(response.status).toBe(202)
    expect(response.headers.has('content-encoding')).toBe(false)
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(responseBytes))
  })

  test('returns non-402 responses without using the payment proxy', async () => {
    let calls = 0
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      calls++
      if (request.url === `${BASE_URL}/sdk/agent`) return Response.json(agent)
      return new Response(null, { status: 204 })
    }

    const client = await AgentisClient.create({ apiKey: API_KEY, baseUrl: BASE_URL })
    const response = await client.fetch(TARGET_URL, { method: 'DELETE' })

    expect(response.status).toBe(204)
    expect(calls).toBe(2)
  })

  test('surfaces payment backend and facilitator failures', async () => {
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      if (request.url === `${BASE_URL}/sdk/agent`) return Response.json(agent)
      if (request.url === TARGET_URL) return x402Challenge()
      if (request.url === `${BASE_URL}/sdk/agent/fetch-paid`) {
        return Response.json({ error: 'Facilitator unavailable' }, { status: 502 })
      }
      throw new Error(`Unexpected request: ${request.url}`)
    }

    const client = await AgentisClient.create({ apiKey: API_KEY, baseUrl: BASE_URL })
    expect(client.fetch(TARGET_URL)).rejects.toThrow('Facilitator unavailable')
  })
})
