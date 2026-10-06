import { formatUnits } from 'viem'
import { findNetwork } from '@agentis-hq/core/networks'
import { sessions } from './session'
import { localNetworks } from './local-networks'
import { namedChain } from './output'

export async function hostedPolicy(agent?: string, walletId?: string) {
  const results = []
  const seen = new Set<string>()
  for (const session of sessions(agent)) {
    const wallets = (await session.client.wallets.list()).filter(wallet => wallet.enabled && (!walletId || wallet.id === walletId))
    for (const wallet of wallets) {
      const scope = `${wallet.agentId ?? wallet.id}:${findNetwork(wallet.chainId)?.testnet}`
      if (seen.has(scope)) continue
      const policy = await session.client.wallets.policy(wallet.id)
      seen.add(scope)
      const dollars = (amount: string | null) => amount === null ? 'No cap' : `$${formatUnits(BigInt(amount), 6)}`
      results.push({ name: policy.name, custody: 'Hosted', environment: policy.environment, mode: policy.mode, ...Object.fromEntries((['perTransaction', 'hourly', 'daily', 'total'] as const).map(key => [key, dollars(policy.limits[key])])), spent: dollars(policy.spentMicros), reserved: dollars(policy.reservedMicros), allowedRecipients: policy.allowedRecipients.length ? policy.allowedRecipients : 'Any recipient', ...(policy.walletPolicy.budgetMode !== 'usd' ? { additionalWalletRules: policy.walletPolicy } : {}), note: 'Shared allowance per environment, fees included. Edit rules in the dashboard.' })
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
      const asset = network && Object.entries(network.assets).find(([, asset]) => input.asset === 'native' ? asset.token === null : input.asset.startsWith('spl:') ? input.asset.slice(4) === asset.token : input.asset.slice(6).toLowerCase() === asset.token?.toLowerCase())
      const hash = operation.transactionHash ?? operation.receipt?.transactionHash
      const explorer = network?.explorer
      const wallet = wallets.find(wallet => wallet.id === operation.walletId)
      transactions.push({ id: operation.id, date: operation.createdAt, wallet: wallet?.agentName ?? session.agentName, chain: namedChain(input.chainId).name, environment: network?.testnet ? 'testnet' : 'mainnet', amount: asset ? formatUnits(BigInt(input.amountAtomic), asset[1].decimals) : input.amountAtomic, asset: asset ? asset[0] : `${input.asset} (atomic units)`, status: operation.status, to: input.to, transaction: hash && explorer ? `${explorer}/tx/${encodeURIComponent(hash)}${network?.family === 'solana' && network.testnet ? '?cluster=devnet' : ''}` : undefined, spentUsd: operation.usdSettledMicros == null ? null : formatUnits(BigInt(operation.usdSettledMicros), 6) })
    }
  }
  return { wallet: agent ?? 'Hosted wallets', transactions: transactions.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit).reverse(), note: 'History includes payments made by any key within your authorized wallets/networks. Up to 100 recent records per scope; read-only.' }
}
