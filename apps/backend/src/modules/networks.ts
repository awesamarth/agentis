import { baseSepolia, arcTestnet, tempoTestnet, sepolia } from 'viem/chains'
import { createPublicClient, http, type Chain } from 'viem'
import { z } from 'zod'

// Network implementation is internal. Plugins are optional user-added integrations.
export const networkKey = z.enum(['base', 'arc', 'tempo', 'solana', 'sepolia'])
export const networkSelection = z.object({ networks: z.array(networkKey).min(1).max(5).refine(items => new Set(items).size === items.length, 'Duplicate network'), defaultNetwork: networkKey }).strict().refine(value => value.networks.includes(value.defaultNetwork), 'Default network must be enabled')
export const defaultProductChain = `eip155:${baseSepolia.id}`
export const baseUsdc = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
export const evmChains = [baseSepolia, arcTestnet, tempoTestnet, sepolia] as const
export const supportedNetworks = [
  { key: 'base', name: 'Base', chainId: `eip155:${baseSepolia.id}`, chainType: 'ethereum', testnet: true, currency: 'ETH', decimals: 18, priceId: 'coingecko:ethereum', assets: [{ id: 'native', symbol: 'ETH', decimals: 18, priceId: 'coingecko:ethereum' }, { id: `erc20:${baseUsdc}`, symbol: 'USDC', decimals: 6, priceId: 'coingecko:usd-coin' }], explorer: baseSepolia.blockExplorers.default.url },
  { key: 'arc', name: 'Arc', chainId: `eip155:${arcTestnet.id}`, chainType: 'ethereum', testnet: true, currency: 'USDC', decimals: 18, priceId: 'coingecko:usd-coin', assets: [{ id: 'native', symbol: 'USDC', decimals: 18, priceId: 'coingecko:usd-coin' }], explorer: arcTestnet.blockExplorers.default.url },
  { key: 'tempo', name: 'Tempo', chainId: `eip155:${tempoTestnet.id}`, chainType: 'ethereum', testnet: true, currency: 'USD (fees paid in alphaUSD)', decimals: 18, priceId: 'test-usd', assets: [{ id: 'erc20:0x20c0000000000000000000000000000000000001', symbol: 'alphaUSD', decimals: 6, priceId: 'test-usd' }], explorer: tempoTestnet.blockExplorers.default.url },
  { key: 'solana', name: 'Solana', chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', chainType: 'solana', testnet: true, currency: 'SOL', decimals: 9, priceId: 'coingecko:solana', assets: [{ id: 'native', symbol: 'SOL', decimals: 9, priceId: 'coingecko:solana' }, { id: 'spl:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', symbol: 'USDC', decimals: 6, priceId: 'coingecko:usd-coin' }], explorer: 'https://explorer.solana.com' },
  { key: 'sepolia', name: 'Ethereum Sepolia', chainId: 'eip155:11155111', chainType: 'ethereum', testnet: true, currency: 'ETH', decimals: 18, priceId: 'coingecko:ethereum', assets: [{ id: 'native', symbol: 'ETH', decimals: 18, priceId: 'coingecko:ethereum' }], explorer: sepolia.blockExplorers.default.url },
] as const

export function evmClient(chainId: string) {
  const chain = evmChains.find(chain => `eip155:${chain.id}` === chainId)
  if (!chain) throw new Error('Only configured testnets are permitted')
  const envKey = chain.id === sepolia.id ? 'SEPOLIA_RPC_URL' : chain.id === baseSepolia.id ? 'BASE_SEPOLIA_RPC_URL' : chain.id === arcTestnet.id ? 'ARC_TESTNET_RPC_URL' : 'TEMPO_TESTNET_RPC_URL'
  return createPublicClient({ chain: chain as Chain, transport: http(process.env[envKey] ?? chain.rpcUrls.default.http[0], { timeout: 15_000, retryCount: 0 }) })
}
