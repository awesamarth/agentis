import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, unlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseUnits, formatUnits } from 'viem'
import { z } from 'zod'
import { paymentHttp } from '@agentis-hq/core/payment-http'
import { localNetworks, type LocalChain } from './local-networks'
import { loadLocalWallet, localWalletDirectory, privatePath } from './local-wallet'
import { defaultRules, localRules, usdMicros, type LocalRules } from './local-rules'

export class LocalPolicyError extends Error { constructor(message: string) { super(message); this.name = 'LocalPolicyError' } }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d
export type SpendTerms = { chain: LocalChain; asset: string; amountAtomic: string; maxFeeAtomic: string }
const quoteSchema = z.object({ amountPrice: z.string().regex(/^\d+$/), feePrice: z.string().regex(/^\d+$/), amountDecimals: z.number().int(), feeDecimals: z.number().int(), expiresAt: z.number() })
type Quote = z.infer<typeof quoteSchema>
const entrySchema = z.object({ key: z.string(), terms: z.object({ chain: z.enum(['base', 'arc', 'tempo', 'solana']), asset: z.string(), amountAtomic: z.string().regex(/^\d+$/), maxFeeAtomic: z.string().regex(/^\d+$/) }), createdAt: z.number(), signedAt: z.number().optional(), settledAt: z.number().optional(), status: z.enum(['reserved', 'signing', 'confirmed', 'failed', 'released']), reservedUsd: z.string().regex(/^\d+$/), settledUsd: z.string().regex(/^\d+$/).optional(), quote: quoteSchema })
type Entry = z.infer<typeof entrySchema>
const ledgerSchema = z.object({ version: z.literal(1), startedAt: z.number(), entries: z.array(entrySchema) })
export const costUsd = (terms: SpendTerms, quote: Quote, fee = terms.maxFeeAtomic, success = true) => (success ? ceil(BigInt(terms.amountAtomic) * BigInt(quote.amountPrice), 10n ** BigInt(quote.amountDecimals) * 1_000_000_000_000n) : 0n) + ceil(BigInt(fee) * BigInt(quote.feePrice), 10n ** BigInt(quote.feeDecimals) * 1_000_000_000_000n)
const prices = new Map<string, { price: string; expiresAt: number }>()
export async function localQuote(terms: SpendTerms): Promise<Quote> {
  const assets = localNetworks[terms.chain].assets as Record<string, { decimals: number }>
  const asset = assets[terms.asset]
  if (!asset) throw new LocalPolicyError('No USD price mapping for this asset')
  const amountId = terms.asset === 'ETH' ? 'coingecko:ethereum' : terms.asset === 'SOL' ? 'coingecko:solana' : terms.asset === 'alphaUSD' ? 'test-usd' : 'coingecko:usd-coin'
  const feeId = terms.chain === 'base' ? 'coingecko:ethereum' : terms.chain === 'solana' ? 'coingecko:solana' : terms.chain === 'tempo' ? 'test-usd' : 'coingecko:usd-coin'
  const ids = [...new Set([amountId, ...(BigInt(terms.maxFeeAtomic) ? [feeId] : [])])].filter(id => id !== 'test-usd')
  const missing = ids.filter(id => (prices.get(id)?.expiresAt ?? 0) <= Date.now())
  try {
    if (missing.length) {
      const response = await paymentHttp({ url: `https://coins.llama.fi/prices/current/${missing.map(encodeURIComponent).join(',')}`, method: 'GET', headers: {} })
      if (response.status !== 200) throw Error()
      const coins = JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString()).coins
      for (const id of missing) {
        const p = z.object({ price: z.number().positive().finite(), timestamp: z.number().int().positive(), confidence: z.number().min(0.95).max(1) }).parse(coins[id])
        const now = Date.now(), text = String(p.price)
        if (p.timestamp * 1000 < now - 300_000 || p.timestamp * 1000 > now + 30_000 || !/^\d+(\.\d{1,18})?$/.test(text)) throw Error()
        prices.set(id, { price: parseUnits(text, 18).toString(), expiresAt: Math.min(now + 30_000, p.timestamp * 1000 + 300_000) })
      }
    }
    const get = (id: string) => id === 'test-usd' ? { price: '1000000000000000000', expiresAt: Date.now() + 30_000 } : prices.get(id)!
    const amount = get(amountId), fee = BigInt(terms.maxFeeAtomic) ? get(feeId) : { price: '0', expiresAt: amount.expiresAt }
    if (!amount || !fee || Math.min(amount.expiresAt, fee.expiresAt) <= Date.now()) throw Error()
    return { amountPrice: amount.price, feePrice: fee.price, amountDecimals: asset.decimals, feeDecimals: terms.chain === 'solana' ? 9 : 18, expiresAt: Math.min(amount.expiresAt, fee.expiresAt) }
  } catch { throw new LocalPolicyError('Fresh USD prices are unavailable; no new payment can be signed. Try again later.') }
}
function paths(wallet: string) {
  const directory = join(localWalletDirectory(), 'policies')
  mkdirSync(directory, { recursive: true, mode: 0o700 }); privatePath(directory, true)
  const base = join(directory, digest(wallet))
  return { file: `${base}.json`, lock: `${base}.lock` }
}
function atomic(file: string, value: unknown) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`
  writeFileSync(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); renameSync(tmp, file)
}
async function locked<T>(wallet: string, fn: (ledger: z.infer<typeof ledgerSchema>, save: () => void) => Promise<T> | T): Promise<T> {
  const { file, lock } = paths(wallet)
  try { writeFileSync(lock, 'Local wallet policy lock', { flag: 'wx', mode: 0o600 }) } catch { throw new LocalPolicyError('Wallet policy is busy. Retry shortly; inspect crash-stale policy locks before removing them.') }
  try {
    let ledger: z.infer<typeof ledgerSchema>
    if (existsSync(file)) { privatePath(file, false); ledger = ledgerSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) }
    else ledger = { version: 1, startedAt: Date.now(), entries: [] }
    return await fn(ledger, () => atomic(file, ledger))
  } finally { unlinkSync(lock) }
}
function check(rules: LocalRules, entries: Entry[], amount: bigint, exclude?: string, now = Date.now()) {
  if (rules.paused) throw new LocalPolicyError('This local wallet is paused')
  if (rules.perTransaction !== null && amount > usdMicros(rules.perTransaction)) throw new LocalPolicyError('Payment exceeds the per-transaction USD limit (including fees)')
  for (const [field, window] of [['hourly', 3_600_000], ['daily', 86_400_000], ['total', Infinity]] as const) {
    if (rules[field] === null) continue
    const spent = entries.reduce((sum, entry) => {
      if (entry.key === exclude || entry.status === 'released') return sum
      const pending = entry.status === 'reserved' || entry.status === 'signing'
      return sum + (pending ? BigInt(entry.reservedUsd) : (entry.signedAt ?? entry.createdAt) > now - window ? BigInt(entry.settledUsd!) : 0n)
    }, 0n)
    if (spent + amount > usdMicros(rules[field]!)) throw new LocalPolicyError(`Payment exceeds the ${field} USD limit (including pending payments and fees)`)
  }
}
export async function reserveLocal(walletId: string, key: string, terms: SpendTerms) {
  if (loadLocalWallet(walletId).policy?.paused) throw new LocalPolicyError('This local wallet is paused')
  const quote = await localQuote(terms), reservedUsd = costUsd(terms, quote).toString()
  await locked(walletId, (ledger, save) => {
    const id = digest(key), previous = ledger.entries.find(entry => entry.key === id)
    if (previous) throw new LocalPolicyError('This request key already has a policy record; inspect history and reuse its original command to reconcile')
    check(loadLocalWallet(walletId).policy ?? defaultRules, ledger.entries, BigInt(reservedUsd))
    ledger.entries.push({ key: id, terms, createdAt: Date.now(), status: 'reserved', reservedUsd, quote }); save()
  })
}
export async function signWithPolicy<T>(walletId: string, key: string, sign: () => Promise<T>): Promise<T> {
  // Refresh before acquiring the short wallet-wide signing lock, then recheck rules.
  const quoteTerms = await locked(walletId, ledger => ledger.entries.find(entry => entry.key === digest(key))?.terms)
  if (!quoteTerms) throw new LocalPolicyError('Missing policy reservation')
  const quote = await localQuote(quoteTerms)
  return locked(walletId, async (ledger, save) => {
    const entry = ledger.entries.find(entry => entry.key === digest(key))!
    if (entry.status !== 'reserved' || quote.expiresAt <= Date.now()) throw new LocalPolicyError('Payment was already authorized or its quote expired')
    const amount = costUsd(entry.terms, quote)
    check(loadLocalWallet(walletId).policy ?? defaultRules, ledger.entries, amount, entry.key)
    entry.quote = quote; entry.reservedUsd = amount.toString(); entry.status = 'signing'; entry.signedAt = Date.now(); save()
    return sign()
  })
}
export async function releaseUnissued(walletId: string, key: string) {
  await locked(walletId, (ledger, save) => { const entry = ledger.entries.find(entry => entry.key === digest(key)); if (entry?.status === 'reserved') { entry.status = 'released'; save() } })
}
export async function settleLocal(walletId: string, key: string, success: boolean, fee: string) {
  await locked(walletId, (ledger, save) => {
    const entry = ledger.entries.find(entry => entry.key === digest(key))
    if (!entry || entry.status === 'confirmed' || entry.status === 'failed') return // Pre-policy journals remain history only.
    if (entry.status !== 'signing') throw new LocalPolicyError('Cannot settle an unsigned reservation')
    entry.settledUsd = costUsd(entry.terms, entry.quote, fee, success).toString(); entry.status = success ? 'confirmed' : 'failed'; entry.settledAt = Date.now(); save()
  })
}
export async function showLocalPolicy(selector: string) {
  const wallet = loadLocalWallet(selector)
  return locked(wallet.id, (ledger, save) => {
    save()
    const spent = ledger.entries.reduce((sum, entry) => sum + BigInt(entry.settledUsd ?? '0'), 0n)
    const pending = ledger.entries.filter(entry => entry.status === 'reserved' || entry.status === 'signing').reduce((sum, entry) => sum + BigInt(entry.reservedUsd), 0n)
    return { wallet: wallet.name, status: wallet.policy?.paused ? 'Paused' : 'Active', ...Object.fromEntries(Object.entries(wallet.policy ?? defaultRules).filter(([key]) => key !== 'paused').map(([key, value]) => [key, value === null ? 'No cap' : `$${value}`])), spent: `$${formatUnits(spent, 6)}`, reserved: `$${formatUnits(pending, 6)}`, trackingSince: new Date(ledger.startedAt).toISOString(), note: 'Combined across all networks. Pre-policy transactions are history only. CLI safeguards—not tamper-proof enforcement.' }
  })
}
export async function setLocalPolicy(selector: string, changes: Partial<LocalRules>) {
  const wallet = loadLocalWallet(selector)
  await locked(wallet.id, (_ledger, save) => {
    const current = loadLocalWallet(wallet.id)
    const policy = localRules.parse({ ...defaultRules, ...current.policy, ...changes })
    const directory = localWalletDirectory()
    const file = readdirSync(directory).filter(name => name.endsWith('.json')).map(name => join(directory, name)).find(path => { privatePath(path, false); return JSON.parse(readFileSync(path, 'utf8')).id === current.id })
    if (!file) throw new LocalPolicyError('Wallet file missing')
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    atomic(file, { ...raw, policy }); save() // Preserve legacy keys and file version.
  })
  return showLocalPolicy(wallet.id)
}
