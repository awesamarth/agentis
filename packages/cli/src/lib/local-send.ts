import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, getAddress, http, keccak256, parseUnits, type Hex, type Chain } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { TxEnvelopeTempo } from 'ox/tempo'
import { tempoTestnet, baseSepolia } from 'viem/chains'
import { estimateL1Fee } from 'viem/op-stack'
import { Connection, PublicKey } from '@solana/web3.js'
import { getBase58Decoder } from '@solana/kit'
import { buildSolanaTransfer, solanaDevnet, solanaUsdc } from '@agentis-hq/core/solana-transfer'
import { localNetworks, solanaGenesis, parseChains, type LocalChain } from './local-networks'
import { deriveSolanaKey, loadLocalWallet, localWalletDirectory, privatePath } from './local-wallet'

export type LocalSendInput = { wallet: string; chain: string; to: string; amount: string; asset?: string; maxFee?: string; key: string }
type RecordData = { request: string; wallet: string; chain: LocalChain; to: string; asset: string; amount: string; maxFee: string; status: string; hash?: string; signed?: string; feeAtomic?: string; failure?: { stage: string; code: string } }
const tempoFee = (amount: bigint) => ((amount + 999_999_999_999n) / 1_000_000_000_000n) * 1_000_000_000_000n
const defaults = { base: { asset: 'ETH', fee: '0.0001' }, arc: { asset: 'USDC', fee: '0.01' }, tempo: { asset: 'alphaUSD', fee: '0.01' }, solana: { asset: 'SOL', fee: '0.005' } }
export function exactAmount(value: string, decimals: number) {
  if (!/^\d+(\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > decimals) throw Error(`Use a positive decimal amount with at most ${decimals} decimal places`)
  const amount = parseUnits(value, decimals)
  if (amount <= 0n) throw Error('Amount must be positive')
  return amount
}
export function localSendTerms(input: LocalSendInput) {
  if (!input.key?.trim() || input.key.length > 200) throw Error('--key is required (1–200 characters); reuse it to check an uncertain send, never choose a new key blindly')
  const chains = parseChains(input.chain)
  if (chains.length !== 1) throw Error('Choose exactly one --chain for a send')
  const chain = chains[0]!
  const wallet = loadLocalWallet(input.wallet)
  if (!wallet.chains.includes(chain)) throw Error('That chain is not enabled on this local wallet')
  const assets = localNetworks[chain].assets as Record<string, { decimals: number; token: string | null }>
  const symbol = Object.keys(assets).find(key => key.toLowerCase() === (input.asset ?? defaults[chain].asset).toLowerCase())
  if (!symbol) throw Error(`Supported assets on ${chain}: ${Object.keys(assets).join(', ')}`)
  const asset = assets[symbol]!
  const amountAtomic = exactAmount(input.amount, asset.decimals)
  const maxFee = input.maxFee ?? defaults[chain].fee
  // EVM gas (including Tempo) is denominated in 18-decimal protocol units.
  const maxFeeAtomic = exactAmount(maxFee, chain === 'solana' ? 9 : 18)
  let to: string
  try { to = chain === 'solana' ? new PublicKey(input.to).toBase58() : getAddress(input.to) } catch { throw Error('Invalid recipient address for this chain') }
  return { chain, wallet, symbol, asset, amountAtomic, maxFee, maxFeeAtomic, to }
}
export async function sendLocalTransfer(input: LocalSendInput) {
  const { chain, wallet, symbol, asset, amountAtomic, maxFee, maxFeeAtomic, to } = localSendTerms(input)
  const directory = join(localWalletDirectory(), 'transactions')
  mkdirSync(directory, { recursive: true, mode: 0o700 }); privatePath(directory, true)
  const request = JSON.stringify({ wallet: wallet.id, chain, to, asset: symbol, amount: amountAtomic.toString(), maxFee: maxFeeAtomic.toString() })
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const file = join(directory, `${hash(`${wallet.id}:${input.key}`)}.json`)
  const lock = join(directory, `${hash(`${wallet.id}:${chain}`)}.lock`)
  let record: RecordData = { request, wallet: wallet.id, chain, to, asset: symbol, amount: input.amount, maxFee, status: 'preparing' }
  const summary = () => ({ wallet: wallet.name, chainId: localNetworks[chain].chainId, to, amount: record.amount, asset: symbol, status: record.status, transactionHash: record.hash, feeAtomic: record.feeAtomic, key: input.key, ...(record.status === 'unknown' || record.status === 'submitted' ? { note: 'Not settled yet. Run the identical command with the same --key to check; do not send again with a new key.' } : {}) })
  const save = () => {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); renameSync(temporary, file)
  }
  const transportFor = (network: Exclude<LocalChain, 'solana'>) => http(process.env[localNetworks[network].rpcEnv] ?? localNetworks[network].chain.rpcUrls.default.http[0], { timeout: 15_000, retryCount: 0 })
  const solana = () => new Connection(process.env.SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com', { commitment: 'confirmed', fetch: ((url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => fetch(url, { ...options, signal: AbortSignal.timeout(15_000) })) as typeof fetch })
  async function receipt() {
    if (!record.hash) throw Error('This request has no submitted transaction. Inspect its local journal before using a new key.')
    try {
      if (chain === 'solana') {
        const client = solana()
        if (await client.getGenesisHash() !== solanaGenesis) throw Error('Wrong network')
        const result = await client.getTransaction(record.hash, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
        if (result?.meta) { record.status = result.meta.err ? 'failed' : 'confirmed'; record.feeAtomic = String(result.meta.fee) }
      } else {
        const client = createPublicClient({ chain: localNetworks[chain].chain as Chain, transport: transportFor(chain) })
        if (await client.getChainId() !== localNetworks[chain].chain.id) throw Error('Wrong network')
        const result = await client.getTransactionReceipt({ hash: record.hash as Hex })
        record.status = result.status === 'success' ? 'confirmed' : 'failed'
        const fee = result.gasUsed * result.effectiveGasPrice + BigInt((result as unknown as { l1Fee?: bigint }).l1Fee ?? 0n)
        record.feeAtomic = String(chain === 'tempo' ? tempoFee(fee) : fee)
      }
      if (record.status === 'confirmed' || record.status === 'failed') delete record.signed
      save()
    } catch { /* Unknown submission is not permission to sign or broadcast again. */ }
    return summary()
  }
  if (existsSync(file)) {
    privatePath(file, false)
    record = JSON.parse(readFileSync(file, 'utf8'))
    if (record.request !== request) throw Error('This --key belongs to different payment terms')
    if (record.status === 'confirmed' || record.status === 'failed') return summary()
    return receipt()
  }
  try { writeFileSync(lock, JSON.stringify({ requestFile: file }), { flag: 'wx', mode: 0o600 }) } catch { throw Error('Another send on this wallet/network is in progress. If a process crashed, inspect the local transaction journal before removing its lock.') }
  try {
    writeFileSync(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
    let stage = 'network-and-wallet-validation'
    try {
      if (chain === 'solana') {
        const signer = await deriveSolanaKey(wallet.mnemonic)
        if (signer.publicKey.toBase58() !== wallet.addresses.solana) throw Error('Address mismatch')
        const client = solana()
        if (await client.getGenesisHash() !== solanaGenesis) throw Error('Wrong network')
        stage = 'solana-transaction-preparation'
        const latest = await client.getLatestBlockhash()
        const transaction = await buildSolanaTransfer(signer.publicKey.toBase58(), { walletId: wallet.id, action: 'transfer', chainId: solanaDevnet, asset: asset.token ? `spl:${solanaUsdc}` : 'native', to, amountAtomic: amountAtomic.toString(), maxFeeAtomic: maxFeeAtomic.toString() }, latest.blockhash)
        const fee = (await client.getFeeForMessage(transaction.compileMessage())).value
        const rent = asset.token ? BigInt(await client.getMinimumBalanceForRentExemption(165)) : 0n
        if (fee === null || BigInt(fee) + rent > maxFeeAtomic || BigInt(await client.getBalance(signer.publicKey)) < BigInt(fee) + rent + (asset.token ? 0n : amountAtomic)) throw Error('Insufficient balance or fee cap')
        stage = 'solana-signing'
        await transaction.sign(signer)
        const bytes = await transaction.serialize()
        record.hash = getBase58Decoder().decode(transaction.signature!)
        record.signed = Buffer.from(bytes).toString('base64'); record.status = 'unknown'; save()
        try { await client.sendRawTransaction(bytes, { skipPreflight: false, maxRetries: 0n }); record.status = 'submitted'; save() } catch { return summary() }
      } else {
        const account = mnemonicToAccount(wallet.mnemonic)
        if (account.address.toLowerCase() !== wallet.addresses.evm?.toLowerCase()) throw Error('Address mismatch')
        const publicClient = createPublicClient({ chain: localNetworks[chain].chain as Chain, transport: transportFor(chain) })
        if (await publicClient.getChainId() !== localNetworks[chain].chain.id) throw Error('Wrong network')
        const call = asset.token ? { to: asset.token as Hex, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to as Hex, amountAtomic] }) } : { to: to as Hex, value: amountAtomic, data: '0x' as Hex }
        let signed: Hex
        stage = 'evm-transaction-preparation'
        if (chain === 'tempo') {
          const client = createWalletClient({ account, chain: tempoTestnet, transport: transportFor(chain) })
          const prepared = await client.prepareTransactionRequest({ account, nonce: await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' }), type: 'tempo', calls: [call], feeToken: asset.token as Hex, nonceKey: 0n, validBefore: Math.floor(Date.now() / 1000) + 120 })
          if (tempoFee(prepared.gas * prepared.maxFeePerGas) > maxFeeAtomic) throw Error('Fee cap exceeded')
          stage = 'tempo-signing'
          signed = await client.signTransaction(prepared)
        } else {
          const client = createWalletClient({ account, chain: localNetworks[chain].chain as Chain, transport: transportFor(chain) })
          const prepared = await client.prepareTransactionRequest({ ...call, account, nonce: await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' }) })
          const executionFee = prepared.gas * (prepared.maxFeePerGas ?? prepared.gasPrice ?? 0n)
          stage = 'l1-fee-estimation'
          const l1Fee = chain === 'base' ? await estimateL1Fee(createPublicClient({ chain: baseSepolia, transport: transportFor(chain) }), { ...call, account }) : 0n
          stage = 'fee-budget-check'
          if (executionFee + l1Fee * 2n > maxFeeAtomic) throw Error('Fee estimate exceeds cap')
          stage = 'evm-signing'
          signed = await client.signTransaction(prepared)
        }
        if (chain === 'tempo') {
          const envelope = TxEnvelopeTempo.deserialize(signed as `0x76${string}`)
          if (!envelope.signature) throw Error('Missing Tempo signature')
          record.hash = TxEnvelopeTempo.hash({ ...envelope, signature: envelope.signature })
        } else record.hash = keccak256(signed)
        record.signed = signed; record.status = 'unknown'; save()
        try { await publicClient.sendRawTransaction({ serializedTransaction: signed }); record.status = 'submitted'; save() } catch { return summary() }
      }
    } catch (error) {
      if (!record.hash) {
        const name = error instanceof Error ? error.name : 'UnknownError'
        record.failure = { stage, code: /^[A-Za-z]+$/.test(name) ? name : 'UnknownError' }
        record.status = 'preparation_failed'; save()
        throw Error(`Local send preparation failed at ${stage} (${record.failure.code}). Check balance, RPC and fee cap; no transaction was submitted. Journal retained.`)
      }
      // A hash may already be published. Never replace it with another transaction.
      throw Error('Local send could not finish. Inspect the journal and check the same --key; do not create another payment.')
    }
    for (let i = 0; i < 15; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      await receipt()
      if (record.status === 'confirmed' || record.status === 'failed') break
    }
    return summary()
  } finally { unlinkSync(lock) }
}
