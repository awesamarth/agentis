import { erc20Abi, multicall3Abi, type Address } from 'viem'
import { PublicKey } from '@solana/web3.js'
import { z } from 'zod'
import type { WalletRow } from '../db/schema'
import { networks as supportedNetworks, evmClient } from './networks'
import { solanaConnection } from './solana'
import { displayPrice, DISPLAY_CACHE_MS } from './display-prices'

const portfolioResponse = z.object({
  data: z.object({
    tokens: z.array(z.object({ address: z.string(), network: z.string(), tokenAddress: z.string().nullable(), tokenBalance: z.string() })),
    pageKey: z.string().nullable().optional(),
  }),
  error: z.object({ partialErrors: z.array(z.object({ network: z.string(), message: z.string() })) }).optional(),
})
type BalanceResult = {
  networks: { chainId: string; name: string; testnet: boolean; tokens: { asset: string; symbol: string; decimals: number; amountAtomic: string | null; usdMicros: string | null }[]; usdMicros: string | null; complete: boolean }[]
  usdMicros: string | null
  complete: boolean
  checkedAt: string
}
type PortfolioSnapshot = { balances: Map<string, bigint>; complete: Set<string> }
const cache = new Map<string, { value: BalanceResult; expiresAt: number }>()
const pending = new Map<string, Promise<BalanceResult>>()
let portfolioQueue: Promise<void> = Promise.resolve()
const pairKey = (address: string, network: string) => `${address.toLowerCase()}:${network}`
const tokenKey = (address: string, network: string, token: string | null) => `${pairKey(address, network)}:${token?.toLowerCase() ?? 'native'}`
const cacheKey = (wallets: WalletRow[]) => JSON.stringify(wallets.map(wallet => [wallet.id, wallet.chainId, wallet.address]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
async function retryRead<T>(read: () => Promise<T>) {
  let failure: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await read() } catch (error) { failure = error; if (attempt < 2) await delay(250 * (attempt + 1)) }
  }
  throw failure
}

async function portfolioRequest(body: Record<string, unknown>) {
  const key = process.env.ALCHEMY_API_KEY
  if (!key) throw new Error('Alchemy Portfolio API is not configured')
  const run = portfolioQueue.then(async () => {
    const response = await fetch(`https://api.g.alchemy.com/data/v1/${key}/assets/tokens/balances/by-address`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error('Alchemy Portfolio API unavailable')
    return portfolioResponse.parse(await response.json())
  })
  portfolioQueue = run.then(() => delay(1_000), () => delay(1_000))
  return run
}

async function portfolioSnapshot(wallets: WalletRow[]): Promise<PortfolioSnapshot> {
  const grouped = new Map<string, Set<string>>()
  for (const wallet of wallets) {
    const network = supportedNetworks.find(network => network.chainId === wallet.chainId)
    const slug = network?.portfolio
    if (!slug) continue
    const networks = grouped.get(wallet.address.toLowerCase()) ?? new Set<string>()
    networks.add(slug); grouped.set(wallet.address.toLowerCase(), networks)
  }
  const entries = [...grouped].map(([address, networks]) => ({ address, networks: [...networks] }))
  const snapshot: PortfolioSnapshot = { balances: new Map(), complete: new Set() }
  for (let offset = 0; offset < entries.length; offset += 3) {
    const addresses = entries.slice(offset, offset + 3)
    try {
      let pageKey: string | undefined
      const tokens: z.infer<typeof portfolioResponse>['data']['tokens'] = []
      const failed = new Set<string>()
      for (let page = 0; page < 20; page++) {
        const response = await portfolioRequest({ addresses, includeNativeTokens: true, includeErc20Tokens: true, ...(pageKey ? { pageKey } : {}) })
        tokens.push(...response.data.tokens)
        for (const error of response.error?.partialErrors ?? []) failed.add(error.network)
        pageKey = response.data.pageKey ?? undefined
        if (!pageKey) break
        if (page === 19) throw new Error('Alchemy Portfolio pagination limit exceeded')
      }
      for (const token of tokens) snapshot.balances.set(tokenKey(token.address, token.network, token.tokenAddress), BigInt(token.tokenBalance))
      for (const entry of addresses) for (const network of entry.networks) if (!failed.has(network)) snapshot.complete.add(pairKey(entry.address, network))
    } catch { /* Direct RPC fallback handles this chunk. */ }
  }
  return snapshot
}

async function readBalance(wallets: WalletRow[], portfolio: PortfolioSnapshot): Promise<BalanceResult> {
  const networks = await Promise.all(wallets.map(async wallet => {
    const network = supportedNetworks.find(network => network.chainId === wallet.chainId)
    if (!network) return { chainId: wallet.chainId, name: wallet.chainId, testnet: false, tokens: [], usdMicros: null, complete: false }
    const slug = network.portfolio
    const portfolioComplete = !!slug && portfolio.complete.has(pairKey(wallet.address, slug))
    const client = network.chainType === 'ethereum' ? evmClient(wallet.chainId, 2) : undefined
    const connection = network.chainType === 'solana' ? solanaConnection(wallet.chainId) : undefined
    let multicall: Promise<{ status: string; result?: bigint }[] | null> | undefined
    let solanaRead = Promise.resolve()
    const direct = async (asset: typeof network.assets[number], index: number) => {
      if (connection) {
        const read = solanaRead.then(async () => {
          const owner = new PublicKey(wallet.address)
          if (asset.id === 'native') {
            const balance = await retryRead(() => connection.getBalance(owner))
            if (typeof balance === 'number' && !Number.isSafeInteger(balance)) throw new Error('Unsafe balance precision')
            return BigInt(balance)
          }
          const accounts = await retryRead(() => connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(asset.id.slice(4)) }))
          return accounts.value.reduce((sum, account) => sum + BigInt(account.account.data.parsed.info.tokenAmount.amount), 0n)
        })
        solanaRead = read.then(() => undefined, () => undefined)
        return read
      }
      if (!client) throw new Error('Unsupported balance network')
      if (network.chain?.contracts?.multicall3) {
        multicall ??= client.multicall({ contracts: network.assets.map(item => item.id === 'native'
          ? { address: network.chain!.contracts!.multicall3!.address, abi: multicall3Abi, functionName: 'getEthBalance' as const, args: [wallet.address as Address] as const }
          : { address: item.id.slice(6) as Address, abi: erc20Abi, functionName: 'balanceOf' as const, args: [wallet.address as Address] as const }) }).catch(() => null)
        const balance = (await multicall)?.[index]
        if (balance?.status !== 'success' || typeof balance.result !== 'bigint') throw new Error('Balance read failed')
        return balance.result
      }
      return asset.id === 'native'
        ? client.getBalance({ address: wallet.address as Address })
        : client.readContract({ address: asset.id.slice(6) as Address, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address as Address] })
    }
    const tokens = await Promise.all(network.assets.map(async (asset, index) => {
      let amountAtomic: string | null = null, usdMicros: string | null = null
      try {
        const amount = portfolioComplete
          ? portfolio.balances.get(tokenKey(wallet.address, slug!, asset.id === 'native' ? null : asset.id.slice(asset.id.indexOf(':') + 1))) ?? 0n
          : await direct(asset, index)
        if (amount < 0n) throw new Error('Invalid balance')
        amountAtomic = amount.toString()
        // Testnet displays need token quantities, not price requests.
        if (!network.testnet) {
          if (amount === 0n) usdMicros = '0'
          else {
            const price = await displayPrice(asset.priceId, { chainId: wallet.chainId, asset: asset.id })
            usdMicros = (amount * price / (10n ** BigInt(asset.decimals) * 1_000_000_000_000n)).toString()
          }
        }
      } catch { /* Keep known token amounts even when their prices are unavailable. */ }
      return { asset: asset.id, symbol: asset.symbol, decimals: asset.decimals, amountAtomic, usdMicros }
    }))
    const known = tokens.filter(token => token.usdMicros !== null)
    return { chainId: network.chainId, name: network.name, testnet: network.testnet, tokens, usdMicros: known.length ? known.reduce((sum, token) => sum + BigInt(token.usdMicros!), 0n).toString() : null, complete: network.testnet ? tokens.every(token => token.amountAtomic !== null) : known.length === tokens.length }
  }))
  const mainnets = networks.filter(network => !network.testnet)
  const known = mainnets.filter(network => network.usdMicros !== null)
  return { networks, usdMicros: known.length || !mainnets.length ? known.reduce((sum, network) => sum + BigInt(network.usdMicros!), 0n).toString() : null, complete: mainnets.every(network => network.complete), checkedAt: new Date().toISOString() }
}

export async function agentBalances(entries: { id: string; wallets: WalletRow[] }[]) {
  const now = Date.now()
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key)

  const missing: WalletRow[][] = []
  let snapshot: Promise<PortfolioSnapshot> | undefined
  const results = entries.map(entry => {
    const wallets = entry.wallets.filter(wallet => wallet.enabled)
    const key = cacheKey(wallets)
    const cached = cache.get(key)
    if (cached) return Promise.resolve([entry.id, cached.value] as const)

    let task = pending.get(key)
    if (!task) {
      missing.push(wallets)
      // Register every wallet-set promise before any I/O. Owner-wide and
      // single-agent requests then share work, even during Portfolio discovery.
      snapshot ??= Promise.resolve().then(() => portfolioSnapshot(missing.flat()))
      task = snapshot.then(portfolio => readBalance(wallets, portfolio)).then(value => {
        cache.set(key, { value, expiresAt: Date.now() + DISPLAY_CACHE_MS })
        return value
      }).finally(() => pending.delete(key))
      pending.set(key, task)
    }
    return task.then(value => [entry.id, value] as const)
  })
  return Object.fromEntries(await Promise.all(results))
}

export async function agentBalance(wallets: WalletRow[]) {
  return (await agentBalances([{ id: 'balance', wallets }])).balance
}
