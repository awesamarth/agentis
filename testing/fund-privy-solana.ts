// Explicit, fixed-size devnet funding. Never imports the development key into Privy.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Keypair } from '@solana/web3.js'
import { getBase58Encoder } from '@solana/kit'

assert(process.argv[2] === '--execute', 'Explicit --execute required')
const destination = '4Wo6hbyPVLXniTH7ZiU8yg56MgbbqWUisjtJ8T5G3NS5'
const env = { PATH: process.env.PATH!, HOME: process.env.HOME! }
async function cli(command: string[]) {
  const child = Bun.spawn(command, { env, stdout: 'pipe', stderr: 'pipe' })
  const [out, err, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (status) throw new Error(`CLI failed (${status}); inspect funding record before retrying. ${err.slice(0, 500)}`)
  return out.trim()
}
assert((await cli(['solana', 'genesis-hash', '--url', 'devnet'])).startsWith('EtWTRABZaYq6iMfeYKouRu166VU2xqa1'))
let wallet: Keypair
try {
  const key = process.env.SOLANA_DEV_WALLET_KEY!.trim()
  const bytes = key.startsWith('[') ? Uint8Array.from(JSON.parse(key)) : new Uint8Array(getBase58Encoder().encode(key))
  assert(bytes.length === 32 || bytes.length === 64)
  wallet = bytes.length === 64 ? await Keypair.fromSecretKey(bytes) : await Keypair.fromSeed(bytes)
} catch { throw new Error('Cannot decode development key; contents suppressed') }
assert(wallet.publicKey.toBase58() === '5yDpyuSofQARocCtzkrHaEeRjSBTuYTPPna1aeZjqUB6', 'Unexpected funding wallet')
const directory = mkdtempSync(join(tmpdir(), 'agentis-solana-funding-'))
try {
  const keyFile = join(directory, 'keypair.json')
  writeFileSync(keyFile, JSON.stringify(Array.from(wallet.secretKey)), { mode: 0o600 })
  const commands = {
    sol: ['solana', 'transfer', destination, '0.01', '--allow-unfunded-recipient', '--keypair', keyFile, '--url', 'devnet'],
    usdc: ['spl-token', 'transfer', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', '1', destination, '--fund-recipient', '--owner', keyFile, '--fee-payer', keyFile, '--url', 'devnet'],
  }
  for (const [asset, command] of Object.entries(commands)) {
    const record = new URL(`../.agentis-test-keys/funding-solana-cli-${asset}.json`, import.meta.url)
    if (existsSync(record)) { assert(JSON.parse(readFileSync(record, 'utf8')).status === 'confirmed', 'Unknown funding attempt; reconcile, do not resend'); continue }
    writeFileSync(record, JSON.stringify({ status: 'started', destination, asset }), { flag: 'wx', mode: 0o600 })
    const output = await cli(command)
    writeFileSync(record, JSON.stringify({ status: 'confirmed', destination, asset, output }), { mode: 0o600 })
    console.log(output)
  }
} finally { rmSync(directory, { recursive: true, force: true }) }
console.log(await cli(['solana', 'balance', destination, '--url', 'devnet']))
console.log(await cli(['spl-token', 'accounts', '--owner', destination, '--url', 'devnet']))
