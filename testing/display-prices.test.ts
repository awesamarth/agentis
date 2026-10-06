import { afterAll, expect, mock, test } from 'bun:test'

let calls = 0
mock.module('../apps/backend/src/modules/usd-budget', () => ({
  quoteUsd: async (input: { asset: string }) => {
    calls++
    if (input.asset === 'failed') throw Error('Price unavailable')
    return { assetPrice: '2000000000000000000000' }
  },
}))
const { displayPrice, DISPLAY_CACHE_MS } = await import('../apps/backend/src/modules/display-prices')
afterAll(() => mock.restore())

test('display cache is 120 seconds; USDC override does not call market pricing', async () => {
  expect(DISPLAY_CACHE_MS).toBe(120_000)
  expect(await displayPrice('coingecko:usd-coin', { chainId: 'eip155:84532', asset: 'usdc' })).toBe(10n ** 18n)
  expect(calls).toBe(0)
})
test('same asset shares cached price across networks and concurrent requests', async () => {
  const before = calls
  const [a, b] = await Promise.all([
    displayPrice('coingecko:ethereum', { chainId: 'eip155:84532', asset: 'native' }),
    displayPrice('coingecko:ethereum', { chainId: 'eip155:11155111', asset: 'native' }),
  ])
  expect(a).toBe(b)
  await displayPrice('coingecko:ethereum', { chainId: 'eip155:1', asset: 'native' })
  expect(calls - before).toBe(1)
})
test('price failure stays unavailable and does not poison subsequent retries', async () => {
  const before = calls
  await expect(displayPrice('test-failure', { chainId: 'eip155:1', asset: 'failed' })).rejects.toThrow('Price unavailable')
  expect(await displayPrice('test-failure', { chainId: 'eip155:1', asset: 'native' })).toBe(2000n * 10n ** 18n)
  expect(calls - before).toBe(2)
})
