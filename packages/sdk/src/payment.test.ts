import { describe, expect, test } from 'bun:test'
import { parse402WithBody } from './payment'
import { Challenge } from 'mppx'

const requirement = {
  scheme: 'exact',
  network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  payTo: '11111111111111111111111111111111',
  maxTimeoutSeconds: 60,
}

describe('x402 version detection', () => {
  test('parses v2 requirements from PAYMENT-REQUIRED', async () => {
    const response = new Response(null, {
      status: 402,
      headers: {
        'payment-required': btoa(JSON.stringify({
          x402Version: 2,
          accepts: [{ ...requirement, amount: '1000' }],
        })),
      },
    })

    const parsed = await parse402WithBody(response)
    expect(parsed?.protocol).toBe('x402')
    expect(parsed?.protocol === 'x402' && parsed.x402Version).toBe(2)
  })

  test('keeps v1 body detection for backward compatibility', async () => {
    const response = Response.json({
      x402Version: 1,
      accepts: [{ ...requirement, maxAmountRequired: '1000' }],
    }, { status: 402 })

    const parsed = await parse402WithBody(response)
    expect(parsed?.protocol).toBe('x402')
    expect(parsed?.protocol === 'x402' && parsed.x402Version).toBe(1)
  })

  test('rejects unsupported x402 versions and non-Solana networks', async () => {
    const unsupportedVersion = new Response(null, {
      status: 402,
      headers: {
        'payment-required': btoa(JSON.stringify({
          x402Version: 3,
          accepts: [{ ...requirement, amount: '1000' }],
        })),
      },
    })
    const unsupportedNetwork = new Response(null, {
      status: 402,
      headers: {
        'payment-required': btoa(JSON.stringify({
          x402Version: 2,
          accepts: [{
            ...requirement,
            network: 'eip155:84532',
            amount: '1000',
          }],
        })),
      },
    })

    expect(await parse402WithBody(unsupportedVersion)).toBeNull()
    expect(await parse402WithBody(unsupportedNetwork)).toBeNull()
  })
})

describe('MPP challenge validation', () => {
  test('parses a valid Solana charge challenge', async () => {
    const challenge = Challenge.from({
      id: 'valid-challenge-id',
      realm: 'test',
      method: 'solana',
      intent: 'charge',
      expires: new Date(Date.now() + 60_000).toISOString(),
      request: {
        amount: '1000',
        currency: requirement.asset,
        recipient: requirement.payTo,
        methodDetails: { decimals: 6, network: 'devnet' },
      },
    })
    const response = new Response(null, {
      status: 402,
      headers: { 'www-authenticate': Challenge.serialize(challenge) },
    })

    const parsed = await parse402WithBody(response)
    expect(parsed?.protocol).toBe('mpp')
    expect(parsed?.protocol === 'mpp' && parsed.amount).toBe(0.001)
  })

  test('rejects malformed, expired, and non-Solana MPP challenges', async () => {
    const expired = Challenge.from({
      id: 'expired-challenge-id',
      realm: 'test',
      method: 'solana',
      intent: 'charge',
      expires: new Date(Date.now() - 60_000).toISOString(),
      request: {
        amount: '1000',
        currency: requirement.asset,
        recipient: requirement.payTo,
        methodDetails: { decimals: 6, network: 'devnet' },
      },
    })
    const wrongMethod = Challenge.from({
      id: 'wrong-method-challenge-id',
      realm: 'test',
      method: 'stripe',
      intent: 'charge',
      expires: new Date(Date.now() + 60_000).toISOString(),
      request: { amount: '1000', currency: 'usd', recipient: 'merchant' },
    })

    const responses = [
      new Response(null, {
        status: 402,
        headers: { 'www-authenticate': 'Payment id="broken"' },
      }),
      new Response(null, {
        status: 402,
        headers: { 'www-authenticate': Challenge.serialize(expired) },
      }),
      new Response(null, {
        status: 402,
        headers: { 'www-authenticate': Challenge.serialize(wrongMethod) },
      }),
    ]

    for (const response of responses) {
      expect(await parse402WithBody(response)).toBeNull()
    }
  })
})
