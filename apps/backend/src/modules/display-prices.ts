import { quoteUsd } from './usd-budget'

export const DISPLAY_CACHE_MS = 120_000
// Display-only assumption, keyed by configured asset identity, not arbitrary symbols.
// Remove this entry to use market pricing. Never use it for spending/accounting.
export const DISPLAY_PRICE_OVERRIDES: Readonly<Record<string, bigint>> = {
  'coingecko:usd-coin': 10n ** 18n,
}
type PriceInput = { chainId: string; asset: string }
type PriceSource = (input: PriceInput) => Promise<{ assetPrice: string }>

export function createDisplayPriceReader(quote: PriceSource = quoteUsd) {
  const prices = new Map<string, { price: bigint; expiresAt: number }>()
  const pending = new Map<string, Promise<bigint>>()
  return async function displayPrice(priceId: string, input: PriceInput) {
    const fixed = DISPLAY_PRICE_OVERRIDES[priceId]
    if (fixed !== undefined) return fixed
    const cached = prices.get(priceId)
    if (cached && cached.expiresAt > Date.now()) return cached.price
    const active = pending.get(priceId)
    if (active) return active
    const request = quote(input).then(value => {
      const price = BigInt(value.assetPrice)
      prices.set(priceId, { price, expiresAt: Date.now() + DISPLAY_CACHE_MS })
      return price
    })
    pending.set(priceId, request)
    try { return await request } finally { pending.delete(priceId) }
  }
}

export const displayPrice = createDisplayPriceReader()
