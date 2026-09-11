// Explicit small testnet round trips using existing development wallets.
// Secrets remain in environment/memory. Funding proofs live only in ignored 0600 journals.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, keccak256, parseUnits, type Hex, type Chain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { TxEnvelopeTempo } from 'ox/tempo'
import { tempoTestnet } from 'viem/chains'
import { Keypair, Connection } from '@solana/web3.js'
import { getBase58Encoder, getBase58Decoder } from '@solana/kit'
import { buildSolanaTransfer, solanaDevnet, solanaUsdc } from '@agentis-hq/core/solana-transfer'
import { createLocalWallet, listLocalWallets } from '../packages/cli/src/lib/local-wallet'
import { localNetworks, solanaGenesis, type LocalChain } from '../packages/cli/src/lib/local-networks'
assert(process.argv.includes('--execute'), 'Use --execute for actual testnet funds')
const root = resolve('.agentis-test-keys/local-multichain')
mkdirSync(root, { recursive: true, mode: 0o700 })
const name = 'local-multichain-check'
const wallet = listLocalWallets().find(wallet => wallet.name === name) ?? await createLocalWallet(name, undefined, ['base', 'arc', 'tempo', 'solana'])
const key = process.env.DEV_WALLET_PRIVATE_KEY!
assert(key, 'Development EVM key required')
const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex)
assert.equal(account.address.toLowerCase(), '0xcdf770392f1e5e61725cc9522c80070134d50ec7', 'Unexpected development address')
const solKey = process.env.SOLANA_DEV_WALLET_KEY!
assert(solKey, 'Development Solana key required')
const bytes = solKey.trim().startsWith('[') ? Uint8Array.from(JSON.parse(solKey)) : new Uint8Array(getBase58Encoder().encode(solKey))
const solSigner = bytes.length === 64 ? await Keypair.fromSecretKey(bytes) : await Keypair.fromSeed(bytes)
assert.equal(solSigner.publicKey.toBase58(), '5yDpyuSofQARocCtzkrHaEeRjSBTuYTPPna1aeZjqUB6')
const sol = new Connection(process.env.SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com', { commitment: 'confirmed' })
assert.equal(await sol.getGenesisHash(), solanaGenesis)
const transport = (chain: Exclude<LocalChain, 'solana'>) => http(process.env[localNetworks[chain].rpcEnv] ?? localNetworks[chain].chain.rpcUrls.default.http[0], { timeout: 15000, retryCount: 0 })
const evmDestination = wallet.networks.find(network => network.name === 'Base')!.address! as Hex
const solDestination = wallet.networks.find(network => network.name === 'Solana')!.address!
async function fund(chain: LocalChain, asset: string) {
  const file = join(root, `${chain}-${asset}.json`)
  if (existsSync(file)) {
    const prior = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(prior.destination, chain === 'solana' ? solDestination : evmDestination)
    assert.equal(prior.status, 'confirmed', 'Funding attempt unresolved; inspect its hash, never resend blindly')
    return
  }
  let data: Record<string, unknown> = { status: 'preparing', destination: chain === 'solana' ? solDestination : evmDestination, chain, asset }
  const save = () => { const temp = `${file}.tmp`; writeFileSync(temp, JSON.stringify(data), { mode: 0o600 }); renameSync(temp, file) }
  writeFileSync(file, JSON.stringify(data), { mode: 0o600, flag: 'wx' })
  if (chain === 'solana') {
    const latest = await sol.getLatestBlockhash()
    const tx = await buildSolanaTransfer(solSigner.publicKey.toBase58(), { walletId: crypto.randomUUID(), action: 'transfer', chainId: solanaDevnet, asset: asset === 'SOL' ? 'native' : `spl:${solanaUsdc}`, to: solDestination, amountAtomic: asset === 'SOL' ? '4000000' : '10000', maxFeeAtomic: '5000000' }, latest.blockhash)
    await tx.sign(solSigner)
    const signed = await tx.serialize()
    const signature = getBase58Decoder().decode(tx.signature!)
    data = { ...data, status: 'unknown', hash: signature, signed: Buffer.from(signed).toString('base64') }; save()
    await sol.sendRawTransaction(signed, { skipPreflight: false, maxRetries: 0n })
    await sol.confirmTransaction({ signature, ...latest }, 'confirmed')
    const receipt = await sol.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    assert(receipt?.meta && !receipt.meta.err, 'Funding not confirmed')
  } else {
    const publicClient = createPublicClient({ chain: localNetworks[chain].chain as Chain, transport: transport(chain) })
    assert.equal(await publicClient.getChainId(), localNetworks[chain].chain.id)
    const token = chain === 'tempo' ? '0x20c0000000000000000000000000000000000001' : asset === 'USDC' && chain === 'base' ? '0x036cbd53842c5426634e7929541ec2318f3dcf7e' : null
    const amount = chain === 'base' ? asset === 'ETH' ? parseUnits('0.00003', 18) : 10000n : chain === 'arc' ? parseUnits('0.03', 18) : 20000n
    const call = token ? { to: token as Hex, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [evmDestination, amount] }) } : { to: evmDestination, value: amount, data: '0x' as Hex }
    let signed: Hex
    if (chain === 'tempo') {
      const client = createWalletClient({ account, chain: tempoTestnet, transport: transport(chain) })
      const tx = await client.prepareTransactionRequest({ account, nonce: await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' }), type: 'tempo', calls: [call], feeToken: token as Hex, nonceKey: 0n, validBefore: Math.floor(Date.now() / 1000) + 120 })
      assert(tx.gas * tx.maxFeePerGas <= parseUnits('0.01', 18))
      signed = await client.signTransaction(tx)
    } else {
      const client = createWalletClient({ account, chain: localNetworks[chain].chain as Chain, transport: transport(chain) })
      const tx = await client.prepareTransactionRequest({ ...call, account, nonce: await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' }) })
      assert(tx.gas * (tx.maxFeePerGas ?? tx.gasPrice ?? 0n) <= parseUnits(chain === 'base' ? '0.0001' : '0.01', 18))
      signed = await client.signTransaction(tx)
    }
    const hash = chain === 'tempo' ? TxEnvelopeTempo.hash(TxEnvelopeTempo.deserialize(signed as `0x76${string}`)) : keccak256(signed)
    data = { ...data, status: 'unknown', hash, signed }; save()
    await publicClient.sendRawTransaction({ serializedTransaction: signed })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60000 })
    assert.equal(receipt.status, 'success')
  }
  delete data.signed; data.status = 'confirmed'; save()
  console.log(JSON.stringify({ funding: chain, asset, hash: data.hash }))
}
const results = []
for (const [chain, asset, amount] of [['base', 'ETH', '0.000001'], ['arc', 'USDC', '0.01'], ['tempo', 'alphaUSD', '0.005'], ['solana', 'SOL', '0.0001'], ['base', 'USDC', '0.005'], ['solana', 'USDC', '0.005']] as const) {
  try {
    await fund(chain, asset)
    const args = ['bun', resolve('packages/cli/src/index.ts'), 'wallet', 'send', '--local', '--wallet', wallet.id, '--chain', chain, '--asset', asset, '--amount', amount, '--to', chain === 'solana' ? solSigner.publicKey.toBase58() : account.address, '--key', `live-${chain}-${asset}-${chain === 'base' && asset === 'USDC' ? '2' : '1'}`, '--yes', '--json']
    const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    if (code) { console.log(JSON.stringify({ send: chain, asset, error: err.trim() })); continue }
    const result = JSON.parse(out)
    results.push(result); console.log(JSON.stringify(result))
    if (result.status === 'confirmed') {
      const retry = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
      const repeated = JSON.parse(await new Response(retry.stdout).text())
      assert.equal(await retry.exited, 0)
      assert.equal(repeated.transactionHash, result.transactionHash)
    }
  } catch { console.log(JSON.stringify({ chain, asset, status: 'blocked; inspect funding journal before retrying' })) }
}
writeFileSync(join(root, 'results.json'), JSON.stringify({ wallet, results }), { mode: 0o600 })
console.log('Live check finished. Journals retained; no wallets or remaining funds removed.')
