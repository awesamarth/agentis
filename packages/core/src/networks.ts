import { base, baseSepolia, mainnet, sepolia, tempo, tempoTestnet, arcTestnet } from 'viem/chains'
import type { Chain } from 'viem'

export type NetworkDefinition = {
  key: string; name: string; family: 'ethereum' | 'base' | 'arc' | 'tempo' | 'solana'
  chainId: string; chainType: 'ethereum' | 'solana'; testnet: boolean; enabled?: boolean
  currency: string; decimals: number; priceId: string; rpcEnv: string; rpcUrl: string; explorer: string
  defaultAsset: string; defaultFee: string; chain?: Chain; genesisHash?: string; portfolio?: string
  feeToken?: `0x${string}`
  assets: readonly { id: string; symbol: string; decimals: number; priceId: string; feeEligible?: boolean }[]
  x402?: { token: string; asset: string; scale: bigint; domainName?: string; domainVersion?: string }
  mpp?: boolean
}
const eth = { id: 'native', symbol: 'ETH', decimals: 18, priceId: 'coingecko:ethereum' }
const usdc = (token: string) => ({ id: `erc20:${token.toLowerCase()}`, symbol: 'USDC', decimals: 6, priceId: 'coingecko:usd-coin' })
const evm = (key: string, name: string, family: NetworkDefinition['family'], chain: Chain, rpcEnv: string, token: string, domainName: string, portfolio?: string): NetworkDefinition => ({
  key, name, family, chain, chainId: `eip155:${chain.id}`, chainType: 'ethereum', testnet: !!chain.testnet,
  currency: 'ETH', decimals: 18, priceId: eth.priceId, rpcEnv, rpcUrl: chain.rpcUrls.default.http[0], explorer: chain.blockExplorers!.default.url,
  defaultAsset: 'ETH', defaultFee: '0.0001', assets: [eth, usdc(token)], portfolio,
  x402: { token: token.toLowerCase(), asset: usdc(token).id, scale: 1n, domainName, domainVersion: '2' },
})
export const tempoTokens = {
  OUSD: '0x20c0000000000000000000006a37da5c996874be',
  pathUSD: '0x20c0000000000000000000000000000000000000',
  alphaUSD: '0x20c0000000000000000000000000000000000001',
  usdcMainnet: '0x20c000000000000000000000b9537d11c60e8b50',
  usdcTestnet: '0x20c0000000000000000000009e8d7eb59b783726',
} as const
const tempoNetwork = (key: string, chain: typeof tempo | typeof tempoTestnet, token: `0x${string}`, priceId: string, rpcEnv: string): NetworkDefinition => ({
  key, name: chain.testnet ? 'Tempo Testnet' : 'Tempo', family: 'tempo', chain, chainId: `eip155:${chain.id}`, chainType: 'ethereum', testnet: !!chain.testnet,
  currency: 'USD', decimals: 18, priceId, rpcEnv, rpcUrl: chain.rpcUrls.default.http[0], explorer: chain.blockExplorers!.default.url,
  // feeToken preserves the meaning of older persisted operations without feeAsset.
  // New operations persist an explicit feeAsset; new UI selections default to OUSD.
  defaultAsset: 'OUSD', defaultFee: '0.01', feeToken: token, mpp: true,
  assets: [
    { id: `erc20:${tempoTokens.OUSD}`, symbol: 'OUSD', decimals: 6, priceId: chain.testnet ? 'test-usd' : 'coingecko:open-usd' },
    { id: `erc20:${chain.testnet ? tempoTokens.usdcTestnet : tempoTokens.usdcMainnet}`, symbol: 'USDC.e', decimals: 6, feeEligible: !chain.testnet, priceId: chain.testnet ? 'test-usd' : 'redstone:USDC' },
    { id: `erc20:${tempoTokens.pathUSD}`, symbol: 'pathUSD', decimals: 6, priceId: chain.testnet ? 'test-usd' : 'redstone:pathUSD' },
    ...(chain.testnet ? [{ id: `erc20:${tempoTokens.alphaUSD}`, symbol: 'alphaUSD', decimals: 6, priceId: 'test-usd' }] : []),
  ],
})
const solana = (key: string, testnet: boolean, genesisHash: string, mint: string, rpcEnv: string, rpcUrl: string): NetworkDefinition => ({
  key, name: testnet ? 'Solana Devnet' : 'Solana', family: 'solana', chainId: `solana:${genesisHash.slice(0, 32)}`, chainType: 'solana', testnet,
  currency: 'SOL', decimals: 9, priceId: 'coingecko:solana', rpcEnv, rpcUrl, genesisHash, explorer: 'https://explorer.solana.com', defaultAsset: 'SOL', defaultFee: '0.005',
  assets: [{ id: 'native', symbol: 'SOL', decimals: 9, priceId: 'coingecko:solana' }, { id: `spl:${mint}`, symbol: 'USDC', decimals: 6, priceId: 'coingecko:usd-coin' }],
  x402: { token: mint, asset: `spl:${mint}`, scale: 1n }, mpp: true,
})
// Developer-owned catalog. Add networks here only when their family adapter and
// token/rail contracts are supported. Never infer execution support from a name.
export const networkCatalog: readonly NetworkDefinition[] = [
  evm('base', 'Base', 'base', base, 'BASE_RPC_URL', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USD Coin', 'base-mainnet'),
  evm('ethereum', 'Ethereum', 'ethereum', mainnet, 'ETHEREUM_RPC_URL', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USD Coin', 'eth-mainnet'),
  tempoNetwork('tempo', tempo, tempoTokens.pathUSD, 'redstone:pathUSD', 'TEMPO_RPC_URL'),
  solana('solana', false, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
  evm('base-sepolia', 'Base Sepolia', 'base', baseSepolia, 'BASE_SEPOLIA_RPC_URL', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 'USDC', 'base-sepolia'),
  evm('sepolia', 'Ethereum Sepolia', 'ethereum', sepolia, 'SEPOLIA_RPC_URL', '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238', 'USDC', 'eth-sepolia'),
  { key: 'arc', name: 'Arc Testnet', family: 'arc', chain: arcTestnet, chainId: `eip155:${arcTestnet.id}`, chainType: 'ethereum', testnet: true, currency: 'USDC', decimals: 18, priceId: 'coingecko:usd-coin', rpcEnv: 'ARC_TESTNET_RPC_URL', rpcUrl: arcTestnet.rpcUrls.default.http[0], explorer: arcTestnet.blockExplorers.default.url, defaultAsset: 'USDC', defaultFee: '0.01', portfolio: 'arc-testnet', assets: [{ id: 'native', symbol: 'USDC', decimals: 18, priceId: 'coingecko:usd-coin' }], x402: { token: '0x3600000000000000000000000000000000000000', asset: 'native', scale: 1_000_000_000_000n, domainName: 'USDC', domainVersion: '2' } },
  tempoNetwork('tempo-testnet', tempoTestnet, tempoTokens.alphaUSD, 'test-usd', 'TEMPO_TESTNET_RPC_URL'),
  solana('solana-devnet', true, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 'SOLANA_DEVNET_RPC_URL', 'https://api.devnet.solana.com'),
]
// Retire with enabled:false instead of deleting historical network identity.
export const networks: readonly NetworkDefinition[] = networkCatalog.filter(network => network.enabled !== false)
export const findNetwork = (chainId: string) => networkCatalog.find(network => network.chainId === chainId)
export function requireNetwork(chainId: string) {
  const network = findNetwork(chainId)
  if (!network) throw Error('Unsupported network')
  return network
}
export const networkByKey = (key: string) => networkCatalog.find(network => network.key === key)
// Display ordering or retirement must never silently switch the payment default.
export const defaultNetwork = requireNetwork(`eip155:${base.id}`)
if (defaultNetwork.enabled === false) throw Error('The default network must be enabled')
export const sameEnvironment = (a: string, b: string) => a === b || requireNetwork(a).testnet === requireNetwork(b).testnet
// JSON-safe public metadata; implementation details and bigint rail scales stay internal.
export const publicNetworks = networks.map(({ chain, genesisHash, rpcEnv, rpcUrl, x402, feeToken, portfolio, ...network }) => ({ ...network, x402: !!x402, mpp: !!network.mpp }))
