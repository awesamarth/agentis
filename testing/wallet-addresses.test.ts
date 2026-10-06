import { expect, test } from 'bun:test'
import { groupWalletAddresses } from '../apps/next-app/lib/wallet-addresses'

const networks = [
  { chainId: 'eip155:8453', name: 'Base', testnet: false },
  { chainId: 'eip155:4217', name: 'Tempo', testnet: false },
  { chainId: 'eip155:84532', name: 'Base Sepolia', testnet: true },
  { chainId: 'solana:mainnet', name: 'Solana', testnet: false },
  { chainId: 'solana:devnet', name: 'Solana Devnet', testnet: true },
]
const wallet = (chainId: string, address = '0xAbC', enabled = true, agentId = 'agent-a') => ({ chainId, address, enabled, agentId })

test('disabled wallets and their network badges are omitted', () => {
  const groups = groupWalletAddresses([wallet('eip155:84532', '0xAbC', false), wallet('eip155:8453')], networks)
  expect(groups).toHaveLength(1)
  expect(groups[0]!.networks).toEqual([networks[0]!])
  expect(groupWalletAddresses([wallet('eip155:8453', '0xAbC', false)], networks)).toEqual([])
})

test('shared EVM addresses merge case-insensitively; Solana gets its own card', () => {
  const groups = groupWalletAddresses([wallet('eip155:8453'), wallet('eip155:4217', '0xabc'), wallet('solana:mainnet', 'SolAddress'), wallet('solana:devnet', 'SolAddress')], networks)
  expect(groups.map(group => group.label)).toEqual(['EVM', 'Solana'])
  expect(groups[0]!.address).toBe('0xAbC')
  expect(groups[0]!.networks.map(network => network.name)).toEqual(['Base', 'Tempo'])
  expect(groups[1]!.networks.map(network => network.testnet)).toEqual([false, true])
})

test('different addresses, agents and Solana casing never merge', () => {
  expect(groupWalletAddresses([wallet('eip155:8453'), wallet('eip155:4217', '0xDef'), wallet('eip155:8453', '0xAbC', true, 'agent-b')], networks)).toHaveLength(3)
  expect(groupWalletAddresses([wallet('solana:mainnet', 'SolAddress'), wallet('solana:devnet', 'solAddress')], networks)).toHaveLength(2)
})

test('network badges deduplicate and retain environment metadata', () => {
  const groups = groupWalletAddresses([wallet('eip155:8453'), wallet('eip155:8453'), wallet('eip155:84532')], networks)
  expect(groups[0]!.networks).toEqual([networks[0]!, networks[2]!])
})

test('missing metadata preserves the chain ID without guessing its environment', () => {
  const groups = groupWalletAddresses([wallet('eip155:999')], networks)
  expect(groups[0]!.networks).toEqual([{ chainId: 'eip155:999', name: 'eip155:999' }])
})
