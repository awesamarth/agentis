import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadLocalWallet, localWalletDirectory, privatePath } from './local-wallet'
import { localNetworks, type LocalChain } from './local-networks'
export function localHistory(selector: string, limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw Error('--limit must be between 1 and 200')
  const wallet = loadLocalWallet(selector), directory = join(localWalletDirectory(), 'transactions')
  if (!existsSync(directory)) return { wallet: wallet.name, transactions: [] }
  privatePath(directory, true)
  const transactions = readdirSync(directory).filter(file => file.endsWith('.json')).flatMap(file => {
    const path = join(directory, file); privatePath(path, false)
    const record = JSON.parse(readFileSync(path, 'utf8'))
    if (record.wallet !== wallet.id) return []
    const chain = record.chain as LocalChain
    if (!Object.hasOwn(localNetworks, chain)) throw Error('Invalid history network')
    const explorer = chain === 'solana' ? 'https://explorer.solana.com' : localNetworks[chain].chain.blockExplorers.default.url
    // Whitelist public fields. Never expose signed bytes, credentials or raw requests.
    return [{ id: file.slice(0, -5), date: record.createdAt ?? null, chain: localNetworks[chain].name, amount: record.amount || '—', asset: record.asset, status: record.status, to: record.to, url: record.url, key: record.key, transaction: record.hash ? `${explorer}/tx/${encodeURIComponent(record.hash)}${chain === 'solana' ? '?cluster=devnet' : ''}` : undefined, httpStatus: record.httpResponse?.status, failureStage: record.failure?.stage }]
  }).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))).slice(0, limit)
  return { wallet: wallet.name, transactions }
}
