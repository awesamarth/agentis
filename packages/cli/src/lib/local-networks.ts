import { networkCatalog } from '@agentis-hq/core/networks'

// Request construction and local signing share the same developer-owned catalog.
export const localNetworks = Object.fromEntries(networkCatalog.map(network => [network.key, {
  ...network,
  assets: Object.fromEntries(network.assets.map(asset => [asset.symbol, {
    ...asset, token: asset.id === 'native' ? null : asset.id.split(':')[1]!,
  }])),
}]))
export type LocalChain = string
export function parseChains(input: string): LocalChain[] {
  const chains = input.split(',').map(item => item.trim().toLowerCase())
  if (!chains.length || chains.some(chain => !Object.hasOwn(localNetworks, chain)) || new Set(chains).size !== chains.length) throw Error(`Choose unique networks: ${Object.keys(localNetworks).join(', ')}`)
  return chains
}
