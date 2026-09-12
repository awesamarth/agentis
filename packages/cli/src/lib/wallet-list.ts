import { sessions } from './session'
import { listLocalWallets } from './local-wallet'

export async function walletList(localOnly: boolean, hostedOnly: boolean, agent?: string) {
  type Group = { name: string; custody: 'local' | 'hosted'; agentId?: string | null; wallets: { walletId: string; chainId: string; address: string | undefined }[] }
  const local: Group[] = hostedOnly ? [] : listLocalWallets().map(wallet => ({
    name: wallet.name, custody: 'local',
    wallets: wallet.networks.map(network => ({ walletId: wallet.id, chainId: network.chainId, address: network.address })),
  }))
  if (localOnly) return local
  const linked = sessions(agent, !hostedOnly)
  if (!linked.length) console.error('Hosted wallets not listed: run agentis login to connect them.')
  const groups = new Map<string, Group>()
  const results = await Promise.all(linked.map(item => item.client.wallets.list()))
  for (const [index, wallets] of results.entries()) {
    const session = linked[index]!
    for (const wallet of wallets.filter(wallet => wallet.enabled)) {
      const key = wallet.agentId ?? wallet.id
      let group = groups.get(key)
      if (!group) {
        group = { name: wallet.agentName ?? (wallet.agentId && session.agentId === wallet.agentId ? session.agentName : 'Unnamed wallet'), custody: 'hosted', agentId: wallet.agentId, wallets: [] }
        groups.set(key, group)
      }
      if (!group.wallets.some(item => item.walletId === wallet.id)) group.wallets.push({ walletId: wallet.id, chainId: wallet.chainId, address: wallet.address })
    }
  }
  return [...groups.values(), ...local]
}
