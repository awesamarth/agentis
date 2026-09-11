// Manual, local/testnet-only preflight. No usable payment authorization is created.
// From apps/backend: bun --env-file=../../../x402-aqi/.env.local --env-file=.env ../../testing/privy-x402-preflight.ts --wallet <id> [--fund]
import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { readFileSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { PrivyClient } from '@privy-io/node'
import { authorizationTypes } from '@x402/evm'
import { createPublicClient, createWalletClient, http, erc20Abi, encodeFunctionData, keccak256, recoverTypedDataAddress, type Hex } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { connectDatabase } from '../apps/backend/src/db'
import { wallets } from '../apps/backend/src/db/schema'
import { privyIdentity } from '../apps/backend/src/providers/privy'
import { discoverX402, validateX402 } from '../apps/backend/src/modules/x402'
import { baseUsdc } from '../apps/backend/src/modules/networks'
import { paymentHttp } from '../apps/backend/src/modules/payment-http'

async function main() {
  const { values } = parseArgs({ options: { wallet: { type: 'string' }, fund: { type: 'boolean' } } })
  assert(values.wallet, '--wallet required; no new wallets are created')
  const env = Bun.YAML.parse(readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8')).services.postgres.environment
  assert.equal(env.POSTGRES_DB, 'agentis_dev')
  const url = new URL('postgres://127.0.0.1:55432/agentis_dev'); url.username = env.POSTGRES_USER; url.password = env.POSTGRES_PASSWORD
  const connection = connectDatabase(url.href)
  try {
    const [wallet] = await connection.db.select().from(wallets).where(eq(wallets.id, values.wallet))
    assert(wallet?.agentId && wallet.enabled && wallet.serverAuthorized && wallet.provider === 'privy' && wallet.chainId === 'eip155:84532', 'Expected an enabled hosted agent Base wallet')
    process.env.AGENTIS_PAID_FETCH_LOCAL_ORIGINS = 'http://127.0.0.1:3010'
    const input = await discoverX402({ walletId: wallet.id, url: 'http://127.0.0.1:3010/api/aqi?city=delhi&rail=base', maxAmountAtomic: '10000' })
    validateX402(wallet, input)
    for (const change of [{ amountAtomic: '10001' }, { maxFeeAtomic: '1' }, { chainId: 'eip155:8453' }, { to: wallet.address }]) assert.throws(() => validateX402(wallet, { ...input, ...change }))
    await assert.rejects(() => discoverX402({ walletId: wallet.id, url: input.payment!.url, maxAmountAtomic: '1' }))
    await assert.rejects(() => paymentHttp({ url: 'http://169.254.169.254/latest/meta-data', method: 'GET', headers: {} }))
    console.log({ checks: 'price ceiling, recipient/amount/network/fee binding and private URL rejection passed' })

    const keyPath = process.env.PRIVY_AUTHORIZATION_KEY_FILE!
    assert.equal(statSync(keyPath).mode & 0o077, 0)
    const key = readFileSync(keyPath, 'utf8').trim()
    const appId = process.env.PRIVY_APP_ID!, appSecret = process.env.PRIVY_APP_SECRET!
    assert(appId && appSecret)
    const identity = privyIdentity(appId, appSecret, key)
    const owned = await identity.inspectWallet(wallet.providerWalletId, wallet.ownerId)
    assert(owned.serverAuthorized && owned.address.toLowerCase() === wallet.address.toLowerCase())
    const privy = new PrivyClient({ appId, appSecret, timeout: 20_000, maxRetries: 0 })
    const domain = { name: 'USDC', version: '2', chainId: 84532, verifyingContract: baseUsdc } as const
    // Permanently expired and zero-value: proves the SDK/quorum signing interface without authorizing spending.
    const message = { from: wallet.address as Hex, to: wallet.address as Hex, value: 0n, validAfter: 0n, validBefore: 1n, nonce: `0x${'00'.repeat(32)}` as Hex }
    const result = await privy.wallets().ethereum().signTypedData(wallet.providerWalletId, {
      params: { typed_data: { domain, types: { TransferWithAuthorization: [...authorizationTypes.TransferWithAuthorization] }, primary_type: 'TransferWithAuthorization', message: Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])) } },
      authorization_context: { authorization_private_keys: [key] }, idempotency_key: crypto.randomUUID(), request_expiry: Date.now() + 60_000,
    })
    assert.equal((await recoverTypedDataAddress({ domain, types: authorizationTypes, primaryType: 'TransferWithAuthorization', message, signature: result.signature as Hex })).toLowerCase(), wallet.address.toLowerCase())
    console.log({ privyServerQuorumTypedData: 'verified', walletId: wallet.id, spendAuthorized: false })

    const rpc = createPublicClient({ chain: baseSepolia, transport: http(undefined, { timeout: 15_000, retryCount: 0 }) })
    assert.equal(await rpc.getChainId(), 84532)
    const balance = await rpc.readContract({ address: baseUsdc, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address as Hex] })
    console.log({ usdcAtomicBefore: balance.toString() })
    if (values.fund && balance < 50_000n) {
      const record = new URL('../.agentis-test-keys/funding-research-x402.json', import.meta.url)
      assert(!existsSync(record), 'Funding already attempted. Inspect saved transaction; never blindly resend')
      const raw = process.env.DEV_PRIVATE_KEY!
      assert(raw, 'Existing development payer key required')
      const account = privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as Hex)
      assert.equal(account.address.toLowerCase(), '0xcdf770392f1e5e61725cc9522c80070134d50ec7')
      const signer = createWalletClient({ account, chain: baseSepolia, transport: http(undefined, { retryCount: 0, timeout: 15_000 }) })
      const tx = await signer.prepareTransactionRequest({ to: baseUsdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [wallet.address as Hex, 50_000n - balance] }), type: 'eip1559' })
      assert(tx.gas * tx.maxFeePerGas < 50_000_000_000_000n, 'Funding gas exceeds test ceiling')
      const serializedTransaction = await signer.signTransaction(tx)
      const transactionHash = keccak256(serializedTransaction)
      writeFileSync(record, JSON.stringify({ transactionHash, serializedTransaction, walletId: wallet.id }), { flag: 'wx', mode: 0o600 })
      await rpc.sendRawTransaction({ serializedTransaction })
      const receipt = await rpc.waitForTransactionReceipt({ hash: transactionHash, timeout: 90_000 })
      assert.equal(receipt.status, 'success')
      assert.equal(await rpc.readContract({ address: baseUsdc, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address as Hex], blockNumber: receipt.blockNumber }), 50_000n)
      console.log({ funded: '0.05 USDC target balance', transactionHash })
    }
  } finally { await connection.close() }
}
main().catch(() => { console.error('Preflight failed. No raw provider diagnostics printed. Inspect persisted funding state before retrying.'); process.exitCode = 1 })
