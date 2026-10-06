import { quoteUsd } from './usd-budget'

export const DISPLAY_CACHE_MS = 120_000
// Display-only assumption, keyed by configured asset identity, not arbitrary symbols.
// Remove this entry to use market pricing. Never use it for spending/accounting.
export const DISPLAY_PRICE_OVERRIDES: Readonly<Record<string, bigint>> = {
  'coingecko:usd-coin': 10n ** 18n,
}
const prices = new Map<string, { price: bigint; expiresAt: number }>()
const pending = new Map<string, Promise<bigint>>()
export async function displayPrice(priceId: string, input: { chainId: string; asset: string }) {
  const fixed = DISPLAY_PRICE_OVERRIDES[priceId]
  if (fixed !== undefined) return fixed
  const cached = prices.get(priceId)
  if (cached && cached.expiresAt > Date.now()) return cached.price
  const active = pending.get(priceId)
  if (active) return active
  const request = quoteUsd(input).then(quote => {
    const price = BigInt(quote.assetPrice)
    prices.set(priceId, { price, expiresAt: Date.now() + DISPLAY_CACHE_MS })
    return price
  })
  pending.set(priceId, request)
  try { return await request } finally { pending.delete(priceId) }
}
