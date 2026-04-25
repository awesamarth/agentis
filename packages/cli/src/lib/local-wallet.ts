import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from '@scure/bip32'
import { scrypt } from '@noble/hashes/scrypt.js'
import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { v4 as uuidv4 } from 'uuid'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, existsSync } from 'fs'
import { createKeyPairSignerFromPrivateKeyBytes, type KeyPairSigner } from '@solana/kit'
import type { Policy, SpendRecord } from '@agentis/core'

const VAULT_DIR = join(homedir(), '.agentis', 'wallets')

export const DEFAULT_LOCAL_POLICY: Policy = {
  hourlyLimit: null,
  dailyLimit: null,
  monthlyLimit: null,
  maxBudget: null,
  maxPerTx: null,
  allowedDomains: [],
  killSwitch: false,
}

export type LocalWallet = {
  id: string
  name: string
  createdAt: string
  solanaAddress: string
  policy: Policy
  spendHistory: SpendRecord[]
  crypto: {
    cipher: 'aes-256-gcm'
    ciphertext: string
    cipherparams: { iv: string }
    auth_tag: string
    kdf: 'scrypt'
    kdfparams: { dklen: number; n: number; r: number; p: number; salt: string }
  }
}

function ensureVaultDir() {
  mkdirSync(VAULT_DIR, { recursive: true })
  chmodSync(join(homedir(), '.agentis'), 0o700)
  chmodSync(VAULT_DIR, 0o700)
}

function deriveSolanaAddress(mnemonic: string): string {
  const privateKey = deriveSolanaPrivateKeyBytes(mnemonic)
  const pubkey = ed25519.getPublicKey(privateKey)
  return encodeBase58(pubkey)
}

function deriveSolanaPrivateKeyBytes(mnemonic: string): Uint8Array {
  const seed = mnemonicToSeedSync(mnemonic)
  const root = HDKey.fromMasterSeed(seed)
  const child = root.derive("m/44'/501'/0'/0'")
  if (!child.privateKey) {
    throw new Error('Failed to derive Solana private key')
  }
  return child.privateKey
}

function encodeBase58(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let num = BigInt('0x' + Buffer.from(bytes).toString('hex'))
  let result = ''
  while (num > 0n) {
    result = ALPHABET[Number(num % 58n)] + result
    num = num / 58n
  }
  for (const byte of bytes) {
    if (byte === 0) result = '1' + result
    else break
  }
  return result
}

function encryptMnemonic(mnemonic: string, passphrase: string = ''): LocalWallet['crypto'] {
  const salt = randomBytes(32)
  const iv = randomBytes(12)

  const key = scrypt(passphrase, salt, { N: 65536, r: 8, p: 1, dkLen: 32 })
  const cipher = gcm(key, iv)
  const data = new TextEncoder().encode(mnemonic)
  const encrypted = cipher.encrypt(data)

  // gcm appends 16-byte auth tag at the end
  const ciphertext = encrypted.slice(0, encrypted.length - 16)
  const authTag = encrypted.slice(encrypted.length - 16)

  return {
    cipher: 'aes-256-gcm',
    ciphertext: Buffer.from(ciphertext).toString('hex'),
    cipherparams: { iv: Buffer.from(iv).toString('hex') },
    auth_tag: Buffer.from(authTag).toString('hex'),
    kdf: 'scrypt',
    kdfparams: { dklen: 32, n: 65536, r: 8, p: 1, salt: Buffer.from(salt).toString('hex') },
  }
}

export function decryptMnemonic(wallet: LocalWallet, passphrase: string = ''): string {
  const { kdfparams, cipherparams, ciphertext, auth_tag } = wallet.crypto
  const salt = Buffer.from(kdfparams.salt, 'hex')
  const iv = Buffer.from(cipherparams.iv, 'hex')
  const key = scrypt(passphrase, salt, { N: kdfparams.n, r: kdfparams.r, p: kdfparams.p, dkLen: kdfparams.dklen })
  const cipher = gcm(key, iv)
  const encrypted = Buffer.concat([Buffer.from(ciphertext, 'hex'), Buffer.from(auth_tag, 'hex')])
  const decrypted = cipher.decrypt(encrypted)
  return new TextDecoder().decode(decrypted)
}

export function createLocalWallet(name: string): { wallet: LocalWallet; mnemonic: string } {
  ensureVaultDir()

  const mnemonic = generateMnemonic(englishWordlist, 128) // 12 words
  const solanaAddress = deriveSolanaAddress(mnemonic)
  const crypto = encryptMnemonic(mnemonic)

  const wallet: LocalWallet = {
    id: uuidv4(),
    name,
    createdAt: new Date().toISOString(),
    solanaAddress,
    policy: { ...DEFAULT_LOCAL_POLICY },
    spendHistory: [],
    crypto,
  }

  const path = join(VAULT_DIR, `${wallet.id}.json`)
  writeFileSync(path, JSON.stringify(wallet, null, 2))
  chmodSync(path, 0o600)

  return { wallet, mnemonic }
}

function walletPath(id: string): string {
  return join(VAULT_DIR, `${id}.json`)
}

function normalizeLocalWallet(wallet: LocalWallet): LocalWallet {
  return {
    ...wallet,
    policy: { ...DEFAULT_LOCAL_POLICY, ...(wallet.policy ?? {}) },
    spendHistory: wallet.spendHistory ?? [],
  }
}

export function saveLocalWallet(wallet: LocalWallet): void {
  ensureVaultDir()
  const normalized = normalizeLocalWallet(wallet)
  const path = walletPath(normalized.id)
  writeFileSync(path, JSON.stringify(normalized, null, 2))
  chmodSync(path, 0o600)
}

export function listLocalWallets(): LocalWallet[] {
  ensureVaultDir()
  if (!existsSync(VAULT_DIR)) return []
  return readdirSync(VAULT_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => normalizeLocalWallet(JSON.parse(readFileSync(join(VAULT_DIR, f), 'utf8')) as LocalWallet))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function loadLocalWalletByNameOrId(nameOrId: string): LocalWallet | null {
  const wallets = listLocalWallets()
  return wallets.find(w => w.id === nameOrId || w.name === nameOrId) ?? null
}

export async function getLocalWalletSigner(wallet: LocalWallet, passphrase: string = ''): Promise<KeyPairSigner> {
  const mnemonic = decryptMnemonic(wallet, passphrase)
  const signer = await createKeyPairSignerFromPrivateKeyBytes(deriveSolanaPrivateKeyBytes(mnemonic))
  if (signer.address !== wallet.solanaAddress) {
    throw new Error(`Local wallet key derivation mismatch: expected ${wallet.solanaAddress}, got ${signer.address}`)
  }
  return signer
}

export function recordLocalSpend(wallet: LocalWallet, spend: SpendRecord): LocalWallet {
  const updated = normalizeLocalWallet({
    ...wallet,
    spendHistory: [...(wallet.spendHistory ?? []), spend],
  })
  saveLocalWallet(updated)
  return updated
}
