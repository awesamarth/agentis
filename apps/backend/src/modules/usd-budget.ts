import type { OperationInput, UsdQuote } from '@agentis-hq/core/operations'
import { readPrice } from '@agentis-hq/core/prices'
import { tempoFeeAsset } from '@agentis-hq/core/tempo'
import { supportedNetworks } from './networks'
export { parsePrice } from '@agentis-hq/core/prices'

const ceil = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor
// USD prices use 18 decimal places; ledger dollars use 6. Never round spending down.
export function usdCost(input: OperationInput, quote: UsdQuote, fee = input.maxFeeAtomic, success = true) {
  const value = (amount: string, price: string, decimals: number) => ceil(BigInt(amount) * BigInt(price), 10n ** BigInt(decimals) * 1_000_000_000_000n)
  return (success && input.action !== 'uniswap_approval' ? value(input.amountAtomic, quote.assetPrice, quote.assetDecimals) : 0n) + value(fee, quote.feePrice, quote.feeDecimals)
}
export async function quoteUsd(input: Pick<OperationInput, 'chainId' | 'asset' | 'feeAsset'>): Promise<UsdQuote> {
  const network = supportedNetworks.find(network => network.chainId === input.chainId)
  const asset = network?.assets.find(asset => input.asset.startsWith('erc20:') ? asset.id.toLowerCase() === input.asset.toLowerCase() : asset.id === input.asset)
  if (!network || !asset) throw Error('Asset has no configured USD price source')
  const feeId = network.family === 'tempo' ? tempoFeeAsset(input).priceId : network.priceId
  const get = async (id: string) => {
    if (id !== 'test-usd') return readPrice(id)
    if (!network.testnet) throw Error('Test valuation is forbidden on mainnet')
    return { value: '1000000000000000000', expiresAt: Date.now() + 30_000 }
  }
  const [assetPrice, feePrice] = await Promise.all([get(asset.priceId), get(feeId)])
  if (Math.min(assetPrice.expiresAt, feePrice.expiresAt) <= Date.now()) throw Error('USD quote expired')
  return { assetPrice: assetPrice.value, feePrice: feePrice.value, assetDecimals: asset.decimals, feeDecimals: network.decimals, expiresAt: Math.min(assetPrice.expiresAt, feePrice.expiresAt) }
}
