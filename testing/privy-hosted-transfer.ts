// Explicit live TESTNET proof. Never imported by the regular test suite.
// bun --env-file=.env --env-file=apps/backend/.env testing/privy-hosted-transfer.ts --execute base|arc
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { PrivyClient } from '@privy-io/node'
import { createWalletClient, http, parseUnits, keccak256, erc20Abi, encodeFunctionData, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { eq, and } from 'drizzle-orm'
import { evmClient } from '../apps/backend/src/modules/networks'
import { createPrivyExecutor } from '../apps/backend/src/providers/privy-executor'
import { connectDatabase } from '../apps/backend/src/db'
import { wallets } from '../apps/backend/src/db/schema'
import { OperationService } from '../apps/backend/src/operations'
import { pluginConfig } from '../apps/backend/src/plugins'

assert(process.argv[2] === '--execute', 'Explicit --execute required; this moves small testnet amounts')
const network = process.argv[3]
assert(network === 'base' || network === 'arc' || network === 'tempo', 'Only configured testnets')
const tokenTest = process.argv[4] === 'usdc' || network === 'tempo'
assert(!tokenTest || network !== 'arc', 'Token fixture is Base USDC or Tempo alphaUSD')
const usdc = network === 'tempo' ? '0x20c0000000000000000000000000000000000001' as const : '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
const chainId = network === 'base' ? 'eip155:84532' : network === 'arc' ? 'eip155:5042002' : 'eip155:42431'
const publicClient = evmClient(chainId)
assert.equal(await publicClient.getChainId(), publicClient.chain.id)
const state = JSON.parse(readFileSync(new URL('../.agentis-test-keys/privy-authorization-probe.json', import.meta.url), 'utf8')) as { walletId: string; address: Address; publicKey: string; privateKey: string }
assert(process.env.DEV_WALLET_PRIVATE_KEY && process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET, 'Private test environment required')
const key = process.env.DEV_WALLET_PRIVATE_KEY
const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex)
const privy = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET })
const inspect = async (id: string) => {
  assert.equal(id, state.walletId)
  const wallet = await privy.wallets().get(id)
  assert(wallet.owner_id)
  const quorum = await privy.keyQuorums().get(wallet.owner_id)
  assert.equal(quorum.authorization_threshold, 1)
  assert(quorum.authorization_keys.some(key => key.public_key === state.publicKey))
  assert.equal(wallet.address.toLowerCase(), state.address.toLowerCase())
  return { address: wallet.address, serverAuthorized: true }
}
await inspect(state.walletId)
const connection = connectDatabase('postgres://agentis:agentis-local-only@127.0.0.1:55432/agentis_dev')
try {
  const ownerId = 'isolated-privy-provider-proof'
  await connection.db.update(wallets).set({ provider: 'privy-probe' }).where(eq(wallets.ownerId, ownerId))
  const policy = { mode: 'ask' as const, maxPerOperationAtomic: parseUnits('1', 18).toString(), maxDailyAtomic: parseUnits('1', 18).toString(), maxLifetimeAtomic: parseUnits('1', 18).toString(), allowedRecipients: [account.address] }
  await connection.db.insert(wallets).values({ ownerId, provider: 'privy-probe', providerWalletId: state.walletId, chainId, address: state.address, policy }).onConflictDoNothing()
  const [wallet] = await connection.db.select().from(wallets).where(and(eq(wallets.ownerId, ownerId), eq(wallets.chainId, chainId)))
  assert(wallet)
  const service = new OperationService(connection.db, { ...createPrivyExecutor(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET, inspect, state.privateKey), id: 'privy-probe' }, pluginConfig.parse({}), 'http://localhost:3000')
  const principal = { kind: 'owner' as const, ownerId }
  if (tokenTest) {
    await service.setPolicy(principal, wallet.id, { ...policy, tokenLimits: { [`erc20:${usdc}`]: { perOperation: '10000', daily: '100000', lifetime: '100000' } } })
    if (await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [state.address] }) < 1000n) {
      assert(network === 'base', 'Fund Tempo test wallet with the native testnet faucet first')
      const record = new URL('../.agentis-test-keys/funding-base-usdc-proof.json', import.meta.url)
      let funding: Hex
      if (existsSync(record)) funding = JSON.parse(readFileSync(record, 'utf8')).transactionHash
      else {
        const signer = createWalletClient({ account, chain: publicClient.chain, transport: http(publicClient.transport.url) })
        const request = await signer.prepareTransactionRequest({ to: usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [state.address, 10000n] }), type: 'eip1559' })
        assert(request.gas * request.maxFeePerGas < parseUnits('0.00005', 18), 'Funding fee above test ceiling')
        const serializedTransaction = await signer.signTransaction(request)
        funding = keccak256(serializedTransaction)
        writeFileSync(record, JSON.stringify({ transactionHash: funding, serializedTransaction }), { flag: 'wx', mode: 0o600 })
        await publicClient.sendRawTransaction({ serializedTransaction })
      }
      assert.equal((await publicClient.waitForTransactionReceipt({ hash: funding, timeout: 90_000 })).status, 'success')
      console.log(JSON.stringify({ step: 'test USDC funding', transactionHash: funding }))
    }
  }
  const operation = await service.create(principal, { walletId: wallet.id, action: 'transfer', chainId, asset: tokenTest ? `erc20:${usdc}` : 'native', to: account.address, amountAtomic: tokenTest ? '1000' : parseUnits(network === 'base' ? '0.000001' : '0.001', 18).toString(), maxFeeAtomic: parseUnits(network === 'base' ? '0.00005' : '0.05', 18).toString(), reason: 'Real Privy provider authorization test; return test funds to development wallet' }, `hosted-${network}-${tokenTest ? 'usdc-' : ''}proof-${process.argv.includes('--sdk-rpc') ? 'sdk-rpc-v1' : network === 'tempo' ? 'v3' : 'v1'}`)
  if (operation.status === 'pending_approval') {
    const targetBalance = parseUnits(network === 'base' ? '0.0001' : '0.1', 18)
    if (network !== 'tempo' && await publicClient.getBalance({ address: state.address }) < targetBalance) {
      const signer = createWalletClient({ account, chain: publicClient.chain, transport: http(publicClient.transport.url) })
      const record = new URL(`../.agentis-test-keys/funding-${network}-proof.json`, import.meta.url)
      let funding: Hex
      if (existsSync(record)) funding = JSON.parse(readFileSync(record, 'utf8')).transactionHash
      else {
        const request = await signer.prepareTransactionRequest({ to: state.address, value: targetBalance, type: 'eip1559' })
        assert(request.gas * request.maxFeePerGas < parseUnits(network === 'base' ? '0.00005' : '0.05', 18), 'Funding fee is above test ceiling')
        const serializedTransaction = await signer.signTransaction(request)
        funding = keccak256(serializedTransaction)
        writeFileSync(record, JSON.stringify({ transactionHash: funding, serializedTransaction }), { flag: 'wx', mode: 0o600 })
        await publicClient.sendRawTransaction({ serializedTransaction })
      }
      console.log(JSON.stringify({ step: 'test-wallet funding', network, transactionHash: funding }))
      const funded = await publicClient.waitForTransactionReceipt({ hash: funding, timeout: 90_000 })
      assert.equal(funded.status, 'success', 'Funding failed; inspect before any new transfer')
    }
    await service.decide(principal, operation.id, operation.operationHash, true)
  }
  for (let i = 0; i < 30; i++) {
    await service.tick()
    const result = await service.get(principal, operation.id)
    if (result.status === 'confirmed') { console.log(JSON.stringify({ step: 'hosted transfer confirmed', network, operationId: result.id, receipt: result.receipt, browserUserFlow: 'not exercised by this authorization-key-owned test' })); break }
    if (['failed', 'denied', 'expired', 'rejected'].includes(result.status)) throw new Error(`Operation ${result.id}: ${result.status}; ${result.error}`)
    if (i === 29) throw new Error(`Operation ${result.id}: ${result.status}; inspect persisted operation, do not resend`)
    await Bun.sleep(2000)
  }
} finally { await connection.close() }
