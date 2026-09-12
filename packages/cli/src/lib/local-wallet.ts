import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from 'micro-ed25519-hdkey'
import { Keypair } from '@solana/web3.js'
import { mnemonicToAccount } from 'viem/accounts'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { localNetworks, parseChains, type LocalChain } from './local-networks'
import { localRules, defaultRules, type LocalRules } from './local-rules'

export const localWalletDirectory = () => join(homedir(), '.agentis', 'wallets-v2')
export type LocalWallet = { version: 3; id: string; name: string; chains: LocalChain[]; addresses: { evm?: string; solana?: string }; mnemonic: string; createdAt: string; policy?: LocalRules }
export function privatePath(path: string, directory: boolean) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw Error('Unsafe local wallet permissions; use owner-only directories (0700) and files (0600), not symlinks')
}
export async function deriveSolanaKey(mnemonic: string) {
  const key = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive("m/44'/501'/0'/0'").privateKey
  return Keypair.fromSeed(key)
}
export async function deriveLocalAddress(mnemonic: string) {
  return (await deriveSolanaKey(mnemonic)).publicKey.toBase58()
}
export function localWalletSummary(wallet: LocalWallet) {
  return { id: wallet.id, name: wallet.name, custody: 'local', networks: wallet.chains.map(chain => ({ name: localNetworks[chain].name, chainId: localNetworks[chain].chainId, address: chain === 'solana' ? wallet.addresses.solana : wallet.addresses.evm })) }
}
function readWallets(directory: string): LocalWallet[] {
  let names: string[]
  try { privatePath(directory, true); names = readdirSync(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  return names.filter(name => name.endsWith('.json')).map(name => {
    const path = join(directory, name)
    privatePath(path, false)
    let wallet: LocalWallet
    try {
      const stored = JSON.parse(readFileSync(path, 'utf8'))
      // Read legacy v2 files in place. Never rewrite their mnemonic or address.
      wallet = stored.version === 2 && stored.chain === 'solana' ? { ...stored, version: 3, chains: ['solana'], addresses: { solana: stored.address } } : stored
      if (wallet.version !== 3 || typeof wallet.id !== 'string' || typeof wallet.name !== 'string' || !Array.isArray(wallet.chains) || !wallet.addresses || !validateMnemonic(wallet.mnemonic, wordlist)) throw Error()
      parseChains(wallet.chains.join(','))
      if (wallet.policy !== undefined) localRules.parse(wallet.policy)
      if (wallet.chains.some(chain => typeof (chain === 'solana' ? wallet.addresses.solana : wallet.addresses.evm) !== 'string')) throw Error()
    } catch { throw Error('Invalid local wallet file; contents suppressed. Existing files were not changed.') }
    return wallet
  })
}
export async function createLocalWallet(name: string, directory = localWalletDirectory(), chains: LocalChain[] = ['base'], policy: LocalRules = defaultRules) {
  name = name.trim()
  if (!name || name.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) throw Error('Use a wallet name of 1–64 characters without control characters')
  chains = parseChains(chains.join(','))
  policy = localRules.parse(policy)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  privatePath(directory, true)
  if (readWallets(directory).some(wallet => wallet.name.toLowerCase() === name.toLowerCase())) throw Error('A local wallet with that name already exists')
  const mnemonic = generateMnemonic(wordlist, 128)
  const addresses = {
    ...(chains.some(chain => chain !== 'solana') ? { evm: mnemonicToAccount(mnemonic).address } : {}),
    ...(chains.includes('solana') ? { solana: await deriveLocalAddress(mnemonic) } : {}),
  }
  const wallet: LocalWallet = { version: 3, id: crypto.randomUUID(), name, chains, addresses, mnemonic, createdAt: new Date().toISOString(), policy }
  writeFileSync(join(directory, `${wallet.id}.json`), JSON.stringify(wallet), { flag: 'wx', mode: 0o600 })
  return localWalletSummary(wallet)
}
export function listLocalWallets(directory = localWalletDirectory()) {
  return readWallets(directory).map(localWalletSummary)
}
export function loadLocalWallet(selector: string, directory = localWalletDirectory()) {
  const wallets = readWallets(directory)
  const matches = wallets.filter(wallet => wallet.id === selector || wallet.name.toLowerCase() === selector.toLowerCase())
  if (matches.length !== 1) throw Error('Choose a unique local wallet name or ID; see wallet list --local')
  return matches[0]!
}
