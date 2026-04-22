const SOL_MINT = 'So11111111111111111111111111111111111111112'

// Stablecoins — always $1, skip Jupiter API
const STABLECOIN_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mainnet
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT mainnet
  '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH', // USDG mainnet
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC devnet
])

let cachedPrice: { usd: number; fetchedAt: number } | null = null
const CACHE_TTL_MS = 60_000 // 60s

export async function getTokenPriceUsd(mint: string): Promise<number> {
  if (STABLECOIN_MINTS.has(mint)) return 1

  // SOL — use cache
  if (mint === SOL_MINT) {
    const now = Date.now()
    if (cachedPrice && now - cachedPrice.fetchedAt < CACHE_TTL_MS) {
      return cachedPrice.usd
    }
    const res = await fetch(`https://api.jup.ag/price/v3?ids=${SOL_MINT}`)
    const data = await res.json() as any
    const price = data[SOL_MINT]?.usdPrice ?? 0
    cachedPrice = { usd: price, fetchedAt: now }
    return price
  }

  // Any other token — fetch from Jupiter (no cache)
  const res = await fetch(`https://api.jup.ag/price/v3?ids=${mint}`)
  const data = await res.json() as any
  return data[mint]?.usdPrice ?? 0
}

export async function solToUsd(sol: number): Promise<number> {
  const price = await getTokenPriceUsd(SOL_MINT)
  return sol * price
}
