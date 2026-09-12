import { formatUnits } from 'viem'
import { sessions } from './session'
import { localNetworks } from './local-networks'
import { namedChain } from './output'

export async function hostedPolicy(agent?: string, walletId?: string) {
  const results = []
  const seen = new Set<string>()
  for (const session of sessions(agent)) {
    const wallets = (await session.client.wallets.list()).filter(wallet => wallet.enabled && (!walletId || wallet.id === walletId))
    for (const wallet of wallets) {
      if (seen.has(wallet.agentId ?? wallet.id)) continue
      const policy = await session.client.wallets.policy(wallet.id)
      seen.add(policy.agentId)
      const dollars = (amount: string | null) => amount === null ? 'No cap' : `$${formatUnits(BigInt(amount), 6)}`
      results.push({ name: policy.name, custody: 'Hosted', mode: policy.mode, ...Object.fromEntries((['perTransaction', 'hourly', 'daily', 'total'] as const).map(key => [key, dollars(policy.limits[key])])), spent: dollars(policy.spentMicros), reserved: dollars(policy.reservedMicros), allowedRecipients: policy.allowedRecipients.length ? policy.allowedRecipients : 'Any recipient', ...(policy.walletPolicy.budgetMode !== 'usd' ? { additionalWalletRules: policy.walletPolicy } : {}), note: 'Shared USD budget across all agent networks and credentials, fees included. Read-only; edit hosted rules in the dashboard.' })
    }
  }
  if (!results.length) throw Error('No accessible enabled wallet found')
  return results
}

export async function hostedHistory(agent?: string, walletId?: string, limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('Hosted --limit must be between 1 and 100')
  const transactions = []
  const seen = new Set<string>()
  for (const session of sessions(agent)) {
    const wallets = await session.client.wallets.list()
    for (const operation of await session.client.history()) {
      if ((walletId && operation.walletId !== walletId) || seen.has(operation.id)) continue
      seen.add(operation.id)
      const input = operation
      const network = Object.values(localNetworks).find(network => network.chainId === input.chainId)
      const asset = network && Object.entries(network.assets).find(([, asset]) => input.asset === 'native' ? asset.token === null : input.asset.startsWith('spl:') ? input.asset.slice(4) === asset.token : input.asset.slice(7).toLowerCase() === asset.token?.toLowerCase())
      const hash = operation.transactionHash ?? operation.receipt?.transactionHash
      const explorer = network && ('chain' in network ? network.chain.blockExplorers.default.url : 'https://explorer.solana.com')
      const wallet = wallets.find(wallet => wallet.id === operation.walletId)
      transactions.push({ id: operation.id, date: operation.createdAt, wallet: wallet?.agentName ?? session.agentName, chain: namedChain(input.chainId).name, amount: asset ? formatUnits(BigInt(input.amountAtomic), asset[1].decimals) : input.amountAtomic, asset: asset ? asset[0] : `${input.asset} (atomic units)`, status: operation.status, to: input.to, transaction: hash && explorer ? `${explorer}/tx/${encodeURIComponent(hash)}${input.chainId.startsWith('solana:') ? '?cluster=devnet' : ''}` : undefined, spentUsd: operation.usdSettledMicros == null ? null : formatUnits(BigInt(operation.usdSettledMicros), 6) })
    }
  }
  return { wallet: agent ?? 'Hosted wallets', transactions: transactions.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit).reverse(), note: 'Latest history within your credential scope (up to 100 records per key). Other keys’ operations are not included; changing wallets or logging in again does not transfer old-key history.' }
}
