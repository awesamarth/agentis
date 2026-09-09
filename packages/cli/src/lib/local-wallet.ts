import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from 'micro-ed25519-hdkey'
import { Keypair } from '@solana/web3.js'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export async function deriveLocalAddress(mnemonic: string) {
  const key = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive("m/44'/501'/0'/0'").privateKey
  return (await Keypair.fromSeed(key)).publicKey.toBase58()
}
export async function createLocalWallet(name: string, directory = join(homedir(), '.agentis', 'wallets-v2')) {
  if (!name.trim()) throw new Error('Wallet name required')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const mnemonic = generateMnemonic(wordlist, 128)
  const wallet = { version: 2, id: crypto.randomUUID(), name: name.trim(), chain: 'solana', address: await deriveLocalAddress(mnemonic), mnemonic, createdAt: new Date().toISOString() }
  writeFileSync(join(directory, `${wallet.id}.json`), JSON.stringify(wallet), { flag: 'wx', mode: 0o600 })
  // Never send the mnemonic to stdout/agent transcripts. File access IS the security boundary.
  return { id: wallet.id, name: wallet.name, address: wallet.address, directory }
}
export function listLocalWallets(directory = join(homedir(), '.agentis', 'wallets-v2')) {
  let names: string[]
  try { names = readdirSync(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  return names.filter(name => name.endsWith('.json')).map(name => {
    const wallet = JSON.parse(readFileSync(join(directory, name), 'utf8'))
    return { id: wallet.id, name: wallet.name, address: wallet.address }
  })
}
