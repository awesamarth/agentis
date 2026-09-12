import { createPublicClient, erc20Abi, http, multicall3Abi, type Address, type Chain } from 'viem'
import { baseSepolia } from 'viem/chains'
import { Connection, PublicKey } from '@solana/web3.js'
import { walletList } from './wallet-list'
import { sessions } from './session'
import { localNetworks, solanaGenesis } from './local-networks'
import { localQuote } from './local-policy'

type NetworkBalance = { chainId: string; name: string; tokens: { symbol: string; decimals: number; amountAtomic: string | null; usdMicros: string | null }[]; usdMicros: string | null; complete: boolean }
const total = (rows: { usdMicros: string | null }[]) => {
  const known = rows.filter(row => row.usdMicros !== null)
  return known.length || !rows.length ? known.reduce((sum, row) => sum + BigInt(row.usdMicros!), 0n).toString() : null
}
async function localBalance(wallets: { chainId: string; address: string | undefined }[]) {
  const networks: NetworkBalance[] = await Promise.all(wallets.map(async wallet => {
    const key = (Object.keys(localNetworks) as (keyof typeof localNetworks)[]).find(key => localNetworks[key].chainId === wallet.chainId)!
    const network = localNetworks[key]
    const assets = Object.entries(network.assets) as [string, { decimals: number; token: string | null }][]
    const tokens: NetworkBalance['tokens'] = []
    let read: (index: number) => Promise<bigint>
    try {
      if (!wallet.address) throw Error('Missing address')
      if (key === 'solana') {
        const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com', { commitment: 'confirmed', fetch: Object.assign((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }), { preconnect: fetch.preconnect }) })
        if (await connection.getGenesisHash() !== solanaGenesis) throw Error('Wrong network')
        const owner = new PublicKey(wallet.address)
        read = async index => {
          const token = assets[index]![1].token
          if (!token) {
            const value = await connection.getBalance(owner)
            if (typeof value === 'number' && !Number.isSafeInteger(value)) throw Error('Unsafe amount')
            return BigInt(value)
          }
          const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(token) })
          return accounts.value.reduce((sum, account) => sum + BigInt(account.account.data.parsed.info.tokenAmount.amount), 0n)
        }
      } else {
        const evm = localNetworks[key]
        const client = createPublicClient({ chain: evm.chain as Chain, transport: http(process.env[evm.rpcEnv] ?? evm.chain.rpcUrls.default.http[0], { timeout: 15000, retryCount: 0 }) })
        if (await client.getChainId() !== evm.chain.id) throw Error('Wrong network')
        const address = wallet.address as Address
        const balances = key === 'base' ? await client.multicall({ contracts: assets.map(([, asset]) => asset.token
          ? { address: asset.token as Address, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const }
          : { address: baseSepolia.contracts.multicall3.address, abi: multicall3Abi, functionName: 'getEthBalance' as const, args: [address] as const }) }) : null
        read = async index => {
          if (balances) { const value = balances[index]!; if (value.status !== 'success') throw Error('Balance unavailable'); return value.result }
          const asset = assets[index]![1]
          return asset.token ? client.readContract({ address: asset.token as Address, abi: erc20Abi, functionName: 'balanceOf', args: [address] }) : client.getBalance({ address })
        }
      }
    } catch { read = async () => { throw Error('Balance unavailable') } }
    for (const [index, [symbol, asset]] of assets.entries()) {
      let amountAtomic: string | null = null, usdMicros: string | null = null
      try {
        const amount = await read(index)
        if (amount < 0n) throw Error('Invalid balance')
        amountAtomic = amount.toString()
        if (!amount) usdMicros = '0'
        else {
          const quote = await localQuote({ chain: key, asset: symbol, amountAtomic, maxFeeAtomic: '0' })
          usdMicros = (amount * BigInt(quote.amountPrice) / (10n ** BigInt(asset.decimals) * 1_000_000_000_000n)).toString()
        }
      } catch { /* A missing price must not hide a known token amount or invent zero. */ }
      tokens.push({ symbol, decimals: asset.decimals, amountAtomic, usdMicros })
    }
    return { chainId: wallet.chainId, name: network.name, tokens, usdMicros: total(tokens), complete: tokens.every(token => token.usdMicros !== null) }
  }))
  return { networks, usdMicros: total(networks), complete: networks.every(network => network.complete), checkedAt: new Date().toISOString() }
}

export async function walletBalance(local: boolean, hosted: boolean, selector?: string, agent?: string) {
  const groups = (await walletList(local, hosted || Boolean(agent && !local), agent)).filter(group => !selector || group.name === selector || group.agentId === selector || group.wallets.some(wallet => wallet.walletId === selector))
  if (selector && groups.length !== 1) throw Error('Choose one wallet name/ID, using --local or --hosted if ambiguous')
  const linked = groups.some(group => group.custody === 'hosted') ? sessions(agent) : []
  return Promise.all(groups.map(async group => {
    const identity = { wallet: group.name, custody: group.custody }
    if (group.custody === 'local') return { ...identity, ...await localBalance(group.wallets) }
    if (!group.agentId) throw Error('Hosted balances require a named agent')
    const session = linked.find(item => item.agentId === group.agentId) ?? linked[0]!
    return { ...identity, ...await session.client.agents.balance(group.agentId) }
  }))
}
