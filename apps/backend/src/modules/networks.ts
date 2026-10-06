import { createPublicClient, http, type Chain } from 'viem'
import { z } from 'zod'
import { networks, publicNetworks, defaultNetwork, requireNetwork, networkByKey } from '@agentis-hq/core/networks'

export { networks, requireNetwork }
export const networkKey = z.string().refine(key => networks.some(network => network.key === key), 'Unsupported network')
export const networkSelection = z.object({ networks: z.array(networkKey).min(1).max(networks.length).refine(items => new Set(items).size === items.length, 'Duplicate network'), defaultNetwork: networkKey }).strict().refine(value => value.networks.includes(value.defaultNetwork), 'Default network must be enabled')
export const defaultProductChain = defaultNetwork.chainId
// Pinned plugin exports: plugin deployments remain unchanged.
export const sepoliaUsdc = networkByKey('sepolia')!.x402!.token as `0x${string}`
export const baseUsdc = networkByKey('base-sepolia')!.x402!.token as `0x${string}`
export const supportedNetworks = publicNetworks
export const evmChains = networks.flatMap(network => network.chain ? [network.chain] : [])
export function evmClient(chainId: string, retryCount = 0) {
  const network = requireNetwork(chainId)
  if (!network.chain) throw Error('Expected an EVM network')
  return createPublicClient({ chain: network.chain as Chain, transport: http(process.env[network.rpcEnv] ?? network.rpcUrl, { timeout: 15_000, retryCount }) })
}
