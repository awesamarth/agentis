import { z } from 'zod'
import { bytesToBigInt, parseUnits } from 'viem'
import { SignedDataPackage } from '@redstone-finance/protocol'
import { paymentHttp, redstoneHttp, redstoneSnapshotUrl } from './payment-http'

export type Price = { value: string; expiresAt: number }
const priceSchema = z.object({ price: z.number().positive().finite(), timestamp: z.number().int().positive(), confidence: z.number().min(0.95).max(1) })
export function parsePrice(raw: unknown, now = Date.now()): Price {
  const price = priceSchema.parse(raw)
  return parseNumericPrice(price.price, price.timestamp, now)
}
function parseNumericPrice(value: number, timestamp: number, now = Date.now()): Price {
  const price = z.object({ price: z.number().positive().finite(), timestamp: z.number().int().positive() }).parse({ price: value, timestamp })
  if (price.timestamp * 1000 > now + 30_000 || price.timestamp * 1000 < now - 300_000) throw Error('Price is stale or future-dated')
  if (!/^\d+(\.\d{1,18})?$/.test(String(price.price))) throw Error('Unsupported price precision')
  return { value: parseUnits(String(price.price), 18).toString(), expiresAt: Math.min(now + 30_000, price.timestamp * 1000 + 300_000) }
}
// RedStone primary production registry, pinned rather than trusted from HTTP data.
// Source: @redstone-finance/sdk 1.0.0 getSignersForDataServiceId('redstone-primary-prod').
export const redstoneSigners: readonly string[] = [
  '0x8BB8F32Df04c8b654987DAaeD53D6B6091e3B774', '0xdEB22f54738d54976C4c0fe5ce6d408E40d88499',
  '0x51Ce04Be4b3E32572C4Ec9135221d0691Ba7d202', '0xDD682daEC5A90dD295d14DA4b0bec9281017b5bE',
  '0x9c5AE89C4Af6aA32cE58588DBaF90d18a855B6de',
]
const packageSchema = z.object({
  timestampMilliseconds: z.number().int().positive(), dataPackageId: z.string().max(64), signature: z.string().max(256),
  dataPoints: z.array(z.object({ dataFeedId: z.string().max(64), value: z.number().positive().finite(), decimals: z.literal(8).optional(), valueByteSize: z.literal(32).optional() })).length(1),
})
export function verifyRedstonePrice(raw: unknown, feed: string, now = Date.now(), trusted: readonly string[] = redstoneSigners): Price {
  if (!Array.isArray(raw) || raw.length > 16) throw Error('Invalid oracle packages')
  const allowed = new Set(trusted.map(address => address.toLowerCase()))
  const values = new Map<string, { price: bigint; timestamp: number }>()
  for (const item of raw) {
    try {
      const parsed = packageSchema.parse(item)
      if (parsed.dataPackageId !== feed || parsed.dataPoints[0]!.dataFeedId !== feed || parsed.timestampMilliseconds < now - 60_000 || parsed.timestampMilliseconds > now + 5_000) continue
      const signed = SignedDataPackage.fromObj(parsed)
      const signer = signed.recoverSignerAddress().toLowerCase()
      if (!allowed.has(signer) || values.has(signer)) continue
      // Read the exact signed integer (8 decimals), not a floating-point JSON price.
      const price = bytesToBigInt(signed.dataPackage.dataPoints[0]!.value) * 10n ** 10n
      if (price <= 0n) continue
      values.set(signer, { price, timestamp: parsed.timestampMilliseconds })
    } catch { /* A bad signature/data point contributes nothing to the quorum. */ }
  }
  if (values.size < 3) throw Error('Fresh oracle signer quorum unavailable')
  const quotes = [...values.values()].sort((a, b) => a.price < b.price ? -1 : a.price > b.price ? 1 : 0)
  const median = quotes[Math.floor(quotes.length / 2)]!.price
  if (quotes.some(quote => (quote.price > median ? quote.price - median : median - quote.price) * 100n > median)) throw Error('Oracle signers disagree')
  return { value: median.toString(), expiresAt: Math.min(now + 30_000, ...quotes.map(quote => quote.timestamp + 60_000)) }
}

export function createPriceReader(http: typeof paymentHttp = input => input.url === redstoneSnapshotUrl ? redstoneHttp() : paymentHttp(input)) {
  const cache = new Map<string, Price>()
  const pending = new Map<string, Promise<Price>>()
  let snapshot: Promise<Record<string, unknown>> | undefined
  const redstone = () => {
    snapshot ??= http({ url: redstoneSnapshotUrl, method: 'GET', headers: {} }).then(response => {
      if (response.status !== 200) throw Error('Oracle unavailable')
      return JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString()) as Record<string, unknown>
    }).finally(() => { snapshot = undefined })
    return snapshot
  }
  return async function readPrice(id: string): Promise<Price> {
    const cached = cache.get(id)
    if (cached && cached.expiresAt > Date.now()) return cached
    const active = pending.get(id)
    if (active) return active
    const task = (async () => {
      let price: Price
      if (id.startsWith('redstone:')) {
        const feed = id.slice(9)
        if (!['pathUSD', 'USDC'].includes(feed)) throw Error('Unconfigured oracle feed')
        const data = await redstone()
        price = verifyRedstonePrice(data[feed], feed)
      } else if (id === 'coingecko:open-usd') {
        // Llama's OUSD mirror can lag; use CoinGecko's original observation time.
        const response = await http({ url: 'https://api.coingecko.com/api/v3/simple/price?ids=open-usd&vs_currencies=usd&include_last_updated_at=true', method: 'GET', headers: { accept: 'application/json' } })
        if (response.status !== 200) throw Error('OUSD price source unavailable')
        const data = JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString())['open-usd']
        price = parseNumericPrice(data?.usd, data?.last_updated_at)
      } else {
        if (!/^coingecko:[a-z0-9-]+$/.test(id)) throw Error('Unconfigured price source')
        const url = `https://coins.llama.fi/prices/current/${encodeURIComponent(id)}`
        let result: Price | undefined
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await http({ url: attempt ? `${url}?_refresh=${Math.floor(Date.now() / 30_000)}` : url, method: 'GET', headers: { accept: 'application/json' } })
          if (response.status !== 200) throw Error('USD price service unavailable')
          const data = JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString())
          try { result = parsePrice(data.coins?.[id]); break }
          catch (error) { if (attempt || !(error instanceof Error) || error.message !== 'Price is stale or future-dated') throw error }
        }
        if (!result) throw Error('Fresh price unavailable')
        price = result
      }
      cache.set(id, price)
      return price
    })()
    pending.set(id, task)
    try { return await task } finally { pending.delete(id) }
  }
}
export const readPrice = createPriceReader()
