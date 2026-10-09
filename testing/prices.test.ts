import { expect, test } from 'bun:test'
import { DataPackage, NumericDataPoint } from '@redstone-finance/protocol'
import { privateKeyToAccount } from 'viem/accounts'
import { createPriceReader, parsePrice, verifyRedstonePrice } from '../packages/core/src/prices'

// Disposable synthetic oracle keys; never wallet/provider credentials.
const keys = [1, 2, 3, 4, 5].map(i => `0x${String(i).padStart(64, '0')}` as `0x${string}`)
const trusted = keys.map(key => privateKeyToAccount(key).address)
const now = Date.now()
const packages = (timestamp = now, prices = [1, 1, 1, 1, 1], feed = 'pathUSD') => keys.map((key, i) => new DataPackage([new NumericDataPoint({ dataFeedId: feed, value: prices[i]! })], timestamp, feed).sign(key).toObj())
const response = (data: unknown) => ({ status: 200, headers: {}, bodyBase64: Buffer.from(JSON.stringify(data)).toString('base64') })

test('oracle prices require cryptographically recovered, distinct trusted signer quorum', () => {
  expect(verifyRedstonePrice(packages(), 'pathUSD', now, trusted).value).toBe('1000000000000000000')
  expect(() => verifyRedstonePrice(packages(), 'pathUSD', now)).toThrow('quorum')
  expect(() => verifyRedstonePrice(packages().slice(0, 2), 'pathUSD', now, trusted)).toThrow('quorum')
  expect(() => verifyRedstonePrice(Array(5).fill(packages()[0]), 'pathUSD', now, trusted)).toThrow('quorum')
  const forged = packages().map(p => ({ ...p, signerAddress: trusted[0], dataPoints: [{ dataFeedId: 'pathUSD', value: 0.5 }] }))
  expect(() => verifyRedstonePrice(forged, 'pathUSD', now, trusted)).toThrow('quorum')
})

test('oracle rejects stale/future packages, feed substitution and excessive price disagreement', () => {
  for (const data of [packages(now - 60_001), packages(now + 5001), packages(now, undefined, 'USDC')]) expect(() => verifyRedstonePrice(data, 'pathUSD', now, trusted)).toThrow()
  expect(() => verifyRedstonePrice(packages(now, [1, 1, 1, 1, 1.1]), 'pathUSD', now, trusted)).toThrow('disagree')
  const quote = verifyRedstonePrice(packages(now - 55_000), 'pathUSD', now, trusted)
  expect(quote.expiresAt).toBe(now + 5000)
})

test('oracle conversion uses signed fixed-point integers, including depegged values', () => {
  expect(verifyRedstonePrice(packages(now, [0.97, 0.97, 0.97, 0.97, 0.97]), 'pathUSD', now, trusted).value).toBe('970000000000000000')
})

test('CoinGecko direct OUSD preserves its observation timestamp; no synthetic fresh timestamp', async () => {
  const requests: string[] = []
  const read = createPriceReader(async input => { requests.push(input.url); return response({ 'open-usd': { usd: 0.9987, last_updated_at: Math.floor(Date.now() / 1000) } }) })
  const [a, b] = await Promise.all([read('coingecko:open-usd'), read('coingecko:open-usd')])
  expect(a.value).toBe('998700000000000000')
  expect(b).toEqual(a)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toContain('include_last_updated_at=true')
  const stale = createPriceReader(async () => response({ 'open-usd': { usd: 1, last_updated_at: Math.floor(Date.now() / 1000) - 301 } }))
  await expect(stale('coingecko:open-usd')).rejects.toThrow('stale')
})

test('pricing failures stay closed and pending failures do not poison retries', async () => {
  let calls = 0
  const read = createPriceReader(async () => {
    if (++calls === 1) throw Error('offline')
    return response({ ethereum: { usd: 2500, last_updated_at: Math.floor(Date.now() / 1000) } })
  })
  await expect(read('coingecko:ethereum')).rejects.toThrow('offline')
  expect((await read('coingecko:ethereum')).value).toBe('2500000000000000000000')
  await expect(read('test-usd')).rejects.toThrow('Unconfigured')
  await expect(read('redstone:untrusted')).rejects.toThrow('Unconfigured')
  expect(() => parsePrice({ price: 1, timestamp: Math.floor(now / 1000), confidence: 0.5 })).toThrow()
})
