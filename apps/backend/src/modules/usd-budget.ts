import { z } from 'zod'
import { parseUnits } from 'viem'
import type { OperationInput, UsdQuote } from '@agentis-hq/core/operations'
import { supportedNetworks } from './networks'
import { paymentHttp } from './payment-http'

const priceSchema = z.object({ price: z.number().positive().finite(), timestamp: z.number().int().positive(), confidence: z.number().min(0.95).max(1) })
const cache = new Map<string, { value: string; expiresAt: number }>()
const ceil = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor
// USD prices use 18 decimal places; ledger dollars use 6. Never round spending down.
export function usdCost(input: OperationInput, quote: UsdQuote, fee = input.maxFeeAtomic, success = true) {
  const value = (amount: string, price: string, decimals: number) => ceil(BigInt(amount) * BigInt(price), 10n ** BigInt(decimals) * 1_000_000_000_000n)
  return (success ? value(input.amountAtomic, quote.assetPrice, quote.assetDecimals) : 0n) + value(fee, quote.feePrice, quote.feeDecimals)
}
export function parsePrice(raw: unknown, now = Date.now()) {
  const price = priceSchema.parse(raw)
  if (price.timestamp * 1000 > now + 30_000 || price.timestamp * 1000 < now - 300_000) throw new Error('Price is stale or future-dated')
  const text = String(price.price)
  if (!/^\d+(\.\d{1,18})?$/.test(text)) throw new Error('Unsupported price precision')
  return { value: parseUnits(text, 18).toString(), expiresAt: Math.min(now + 30_000, price.timestamp * 1000 + 300_000) }
}
export async function quoteUsd(input: OperationInput): Promise<UsdQuote> {
  const network = supportedNetworks.find(network => network.chainId === input.chainId)
  const asset = network?.assets.find(asset => input.asset.startsWith('erc20:') ? asset.id.toLowerCase() === input.asset.toLowerCase() : asset.id === input.asset)
  if (!network || !asset) throw new Error('Asset has no configured USD price source')
  const ids = [...new Set([asset.priceId, network.priceId])]
  const missing = ids.filter(id => id !== 'test-usd' && (!cache.has(id) || cache.get(id)!.expiresAt <= Date.now()))
  if (missing.length) {
    const response = await paymentHttp({ url: `https://coins.llama.fi/prices/current/${missing.map(encodeURIComponent).join(',')}`, method: 'GET', headers: { accept: 'application/json' } })
    if (response.status !== 200) throw new Error('USD price service unavailable')
    const data = z.object({ coins: z.record(z.string(), z.unknown()) }).parse(JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8')))
    for (const id of missing) cache.set(id, parsePrice(data.coins[id]))
  }
  const get = (id: string) => {
    // Explicit test-token reference only. Never assume that a mainnet stablecoin equals $1.
    if (id === 'test-usd') {
      if (!network.testnet) throw new Error('Test valuation is forbidden on mainnet')
      return { value: '1000000000000000000', expiresAt: Date.now() + 30_000 }
    }
    const price = cache.get(id)
    if (!price || price.expiresAt <= Date.now()) throw new Error('USD quote expired')
    return price
  }
  const assetPrice = get(asset.priceId), feePrice = get(network.priceId)
  return { assetPrice: assetPrice.value, feePrice: feePrice.value, assetDecimals: asset.decimals, feeDecimals: network.decimals, expiresAt: Math.min(assetPrice.expiresAt, feePrice.expiresAt) }
}
