import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, statSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveLocalAddress, createLocalWallet, listLocalWallets } from './lib/local-wallet'

test('SLIP-0010 Solana recovery, private file modes and sanitized output', async () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  expect(String(await deriveLocalAddress(mnemonic))).toBe('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk')
  const directory = mkdtempSync(join(tmpdir(), 'agentis-wallet-test-'))
  try {
    const result = await createLocalWallet('test', directory)
    const path = join(directory, readdirSync(directory)[0]!)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(directory).mode & 0o777).toBe(0o700)
    expect(result).not.toHaveProperty('mnemonic')
    expect(listLocalWallets(directory)[0]).not.toHaveProperty('mnemonic')
    const wallet = JSON.parse(readFileSync(path, 'utf8'))
    expect(await deriveLocalAddress(wallet.mnemonic)).toBe(result.address)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
