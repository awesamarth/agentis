import { expect, test } from 'bun:test'
import { createDisplayPriceReader, DISPLAY_CACHE_MS } from '../apps/backend/src/modules/display-prices'

// Inject only the display quote source; never replace the spending-pricing module.
function fixture() {
  let calls = 0
  const displayPrice = createDisplayPriceReader(async input => {
    calls++
    if (input.asset === 'failed') throw Error('Price unavailable')
    return { assetPrice: '2000000000000000000000' }
  })
  return { displayPrice, calls: () => calls }
}

test('display cache is 120 seconds; USDC override does not call market pricing', async () => {
  const { displayPrice, calls } = fixture()
  expect(DISPLAY_CACHE_MS).toBe(120_000)
  expect(await displayPrice('coingecko:usd-coin', { chainId: 'eip155:84532', asset: 'usdc' })).toBe(10n ** 18n)
  expect(calls()).toBe(0)
})

test('same asset shares cached price across networks and concurrent requests', async () => {
  const { displayPrice, calls } = fixture()
  const [a, b] = await Promise.all([
    displayPrice('coingecko:ethereum', { chainId: 'eip155:84532', asset: 'native' }),
    displayPrice('coingecko:ethereum', { chainId: 'eip155:11155111', asset: 'native' }),
  ])
  expect(a).toBe(b)
  await displayPrice('coingecko:ethereum', { chainId: 'eip155:1', asset: 'native' })
  expect(calls()).toBe(1)
})

test('price failure stays unavailable and does not poison subsequent retries', async () => {
  const { displayPrice, calls } = fixture()
  await expect(displayPrice('test-failure', { chainId: 'eip155:1', asset: 'failed' })).rejects.toThrow('Price unavailable')
  expect(await displayPrice('test-failure', { chainId: 'eip155:1', asset: 'native' })).toBe(2000n * 10n ** 18n)
  expect(calls()).toBe(2)
})
