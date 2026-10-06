import type { AgentisWallet } from '@agentis-hq/sdk'

type Wallet = Pick<AgentisWallet, 'agentId' | 'address' | 'chainId' | 'enabled'>
export type AddressNetwork = { chainId: string; name: string; testnet?: boolean }
export type WalletAddressGroup = { key: string; label: string; address: string; networks: AddressNetwork[] }

export function groupWalletAddresses(wallets: readonly Wallet[], networks: readonly AddressNetwork[]): WalletAddressGroup[] {
  const metadata = new Map(networks.map(network => [network.chainId, network]))
  const groups = new Map<string, WalletAddressGroup>()
  for (const wallet of wallets) {
    if (!wallet.enabled) continue
    const evm = wallet.chainId.startsWith('eip155:')
    const family = evm ? 'EVM' : wallet.chainId.startsWith('solana:') ? 'Solana' : wallet.chainId
    const key = JSON.stringify([wallet.agentId, family, evm ? wallet.address.toLowerCase() : wallet.address])
    let group = groups.get(key)
    if (!group) {
      group = { key, label: family, address: wallet.address, networks: [] }
      groups.set(key, group)
    }
    if (!group.networks.some(network => network.chainId === wallet.chainId)) {
      group.networks.push(metadata.get(wallet.chainId) ?? { chainId: wallet.chainId, name: wallet.chainId })
    }
  }
  return [...groups.values()]
}
