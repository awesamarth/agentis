import { baseSepolia, arcTestnet, tempoTestnet } from 'viem/chains'
import { solanaDevnet, solanaUsdc } from '@agentis-hq/core/solana-transfer'

export const solanaGenesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
export const localNetworks = {
  base: { name: 'Base', chainId: `eip155:${baseSepolia.id}`, chain: baseSepolia, rpcEnv: 'BASE_SEPOLIA_RPC_URL', assets: { ETH: { decimals: 18, token: null }, USDC: { decimals: 6, token: '0x036cbd53842c5426634e7929541ec2318f3dcf7e' } } },
  arc: { name: 'Arc', chainId: `eip155:${arcTestnet.id}`, chain: arcTestnet, rpcEnv: 'ARC_TESTNET_RPC_URL', assets: { USDC: { decimals: 18, token: null } } },
  tempo: { name: 'Tempo', chainId: `eip155:${tempoTestnet.id}`, chain: tempoTestnet, rpcEnv: 'TEMPO_TESTNET_RPC_URL', assets: { alphaUSD: { decimals: 6, token: '0x20c0000000000000000000000000000000000001' } } },
  solana: { name: 'Solana', chainId: solanaDevnet, assets: { SOL: { decimals: 9, token: null }, USDC: { decimals: 6, token: solanaUsdc } } },
} as const
export type LocalChain = keyof typeof localNetworks
export function parseChains(input: string): LocalChain[] {
  const chains = input.split(',').map(item => item.trim().toLowerCase())
  if (!chains.length || chains.some(chain => !Object.hasOwn(localNetworks, chain)) || new Set(chains).size !== chains.length) throw Error('Choose unique chains: base, arc, tempo, solana')
  return chains as LocalChain[]
}
