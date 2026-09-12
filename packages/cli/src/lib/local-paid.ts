import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { createPublicClient, createWalletClient, http, getAddress, parseEventLogs, parseAbiItem, erc20Abi, formatUnits, decodeFunctionData, type Hex, type Chain } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { tempoTestnet } from 'viem/chains'
import { Abis } from 'viem/tempo'
import { TxEnvelopeTempo } from 'ox/tempo'
import { Challenge, Credential } from 'mppx'
import { tempo } from 'mppx/client'
import { Methods } from 'mppx/tempo'
import { x402Client } from '@x402/core/client'
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader, decodePaymentResponseHeader } from '@x402/core/http'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { authorizationTypes } from '@x402/evm'
import { x402Payment, positiveAtomic, type PaidHttpResponse } from '@agentis-hq/core/operations'
import { paymentHttp } from '@agentis-hq/core/payment-http'
import { solanaUsdc } from '@agentis-hq/core/solana-transfer'
import { loadLocalWallet, localWalletDirectory, privatePath } from './local-wallet'
import { localNetworks, parseChains, type LocalChain } from './local-networks'
import { reserveLocal, signWithPolicy, releaseUnissued, settleLocal, LocalPolicyError } from './local-policy'
import { prepareLocalSvm, localSvmReceipt, type SolanaProof } from './local-paid-solana'
export type LocalFetchInput = { wallet: string; chain: string; url: string; maxAmountAtomic: string; maxFeeAtomic?: string; key: string }
type PaidRecord = { kind: 'paid-fetch'; createdAt: string; request: string; key: string; wallet: string; chain: LocalChain; url: string; status: string; asset: string; amount: string; amountAtomic?: string; to?: string; credential?: string; signed?: string; signature?: string; hash?: string; nonce?: Hex; fromBlock?: string; solana?: SolanaProof; feeAtomic?: string; httpResponse?: PaidHttpResponse; httpError?: string }
const token = (chain: LocalChain) => chain === 'base' ? '0x036cbd53842c5426634e7929541ec2318f3dcf7e' : chain === 'arc' ? '0x3600000000000000000000000000000000000000' : '0x20c0000000000000000000000000000000000001'
const used = parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)')
const rpc = (chain: Exclude<LocalChain, 'solana'>) => createPublicClient({ chain: localNetworks[chain].chain as Chain, transport: http(process.env[localNetworks[chain].rpcEnv] ?? localNetworks[chain].chain.rpcUrls.default.http[0], { timeout: 15000, retryCount: 0 }) })
const roundTempo = (fee: bigint) => ((fee + 999_999_999_999n) / 1_000_000_000_000n) * 1_000_000_000_000n
export async function localPaidFetch(input: LocalFetchInput, confirm: (summary: string) => Promise<void>) {
  const chains = parseChains(input.chain)
  if (chains.length !== 1 || !input.key.trim() || input.key.length > 200) throw Error('A chain and stable --key are required')
  positiveAtomic.parse(input.maxAmountAtomic)
  const chain = chains[0]!, wallet = loadLocalWallet(input.wallet)
  if (!wallet.chains.includes(chain)) throw Error('Chain is not enabled on this local wallet')
  if (input.url.length > 4096) throw Error('URL too long')
  const fee = chain === 'tempo' ? positiveAtomic.parse(input.maxFeeAtomic) : '0'
  const directory = join(localWalletDirectory(), 'transactions')
  mkdirSync(directory, { recursive: true, mode: 0o700 }); privatePath(directory, true)
  const digest = (s: string) => createHash('sha256').update(s).digest('hex')
  const file = join(directory, `${digest(`${wallet.id}:${input.key}`)}.json`), lock = `${file}.lock`
  const request = JSON.stringify({ kind: 'paid-fetch', wallet: wallet.id, chain, url: input.url, maximum: input.maxAmountAtomic, fee })
  const origins = (process.env.AGENTIS_PAID_FETCH_LOCAL_ORIGINS ?? '').split(',').filter(Boolean)
  let record: PaidRecord = { kind: 'paid-fetch', createdAt: new Date().toISOString(), request, key: input.key, wallet: wallet.id, chain, url: input.url, status: 'preparing', asset: chain === 'tempo' ? 'alphaUSD' : 'USDC', amount: '' }
  const save = () => { const tmp = `${file}.${crypto.randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); renameSync(tmp, file) }
  const summary = () => ({ wallet: wallet.name, chainId: localNetworks[chain].chainId, amount: record.amount, asset: record.asset, to: record.to, url: input.url, status: record.status, transactionHash: record.hash, feeAtomic: record.feeAtomic, httpResponse: record.httpResponse, httpError: record.httpError, key: input.key, ...(record.status === 'unknown' ? { note: 'Settlement unknown; budget stays reserved. Reuse this exact command/key to check. Never use a new key blindly.' } : {}) })
  async function reconcile() {
    if (!record.credential && !record.hash && !record.solana) throw new LocalPolicyError('This request has no submitted proof. Inspect its journal before using a new key.')
    try {
      let result: { hash: string; success: boolean; fee: string } | null = null
      if (chain === 'solana') result = await localSvmReceipt(record.solana!, record.amountAtomic!, record.hash)
      else {
        const client = rpc(chain)
        if (await client.getChainId() !== localNetworks[chain].chain.id) throw Error('Wrong RPC network')
        if (!record.hash && record.nonce) {
          const logs = await client.getLogs({ address: token(chain) as Hex, event: used, args: { authorizer: wallet.addresses.evm as Hex, nonce: record.nonce }, fromBlock: BigInt(record.fromBlock!), toBlock: 'latest' })
          if (logs[0]?.transactionHash) { record.hash = logs[0].transactionHash; save() }
        }
        if (record.hash) {
          const receipt = await client.getTransactionReceipt({ hash: record.hash as Hex })
          if (chain !== 'tempo') {
            const authorized = parseEventLogs({ abi: [used], logs: receipt.logs }).some(log => log.address.toLowerCase() === token(chain) && log.args.authorizer.toLowerCase() === wallet.addresses.evm!.toLowerCase() && log.args.nonce === record.nonce)
            const paid = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: 'Transfer' }).some(log => log.address.toLowerCase() === token(chain) && log.args.from.toLowerCase() === wallet.addresses.evm!.toLowerCase() && log.args.to.toLowerCase() === record.to!.toLowerCase() && log.args.value === BigInt(record.amountAtomic!))
            if (receipt.status !== 'success' || !authorized || !paid) throw Error('Wrong payment settlement')
          }
          result = { hash: receipt.transactionHash, success: receipt.status === 'success', fee: chain === 'tempo' ? roundTempo(receipt.gasUsed * receipt.effectiveGasPrice).toString() : '0' }
        }
      }
      if (result) {
        await settleLocal(wallet.id, input.key, result.success, result.fee)
        record.hash = result.hash; record.status = result.success ? 'confirmed' : 'failed'; record.feeAtomic = result.fee
        delete record.credential; delete record.signed; delete record.signature; delete record.solana
        save()
      }
    } catch { /* Lookup failures never authorize a resend or release a reservation. */ }
    return summary()
  }
  if (existsSync(file)) {
    privatePath(file, false); record = JSON.parse(readFileSync(file, 'utf8'))
    if (record.request !== request) throw Error('This key belongs to different payment terms')
    if (record.status === 'confirmed' || record.status === 'failed') return summary()
    return reconcile()
  }
  try { writeFileSync(lock, 'Local paid fetch', { flag: 'wx', mode: 0o600 }) } catch { throw Error('This paid request is already in progress; inspect a crash-stale lock before removing it') }
  try {
    writeFileSync(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
    try {
      if (wallet.policy?.paused) throw new LocalPolicyError('This local wallet is paused')
      const response = await paymentHttp({ url: input.url, method: 'GET', headers: {} }, {}, origins)
      if (response.status !== 402) throw Error('Expected a paid GET challenge (HTTP 402)')
      if (chain === 'tempo') {
        const challenge = Challenge.deserialize(response.headers['www-authenticate']!, { methods: [Methods.charge] })
        const terms = z.object({ amount: positiveAtomic, currency: z.string(), recipient: z.string(), methodDetails: z.object({ chainId: z.literal(42431), feePayer: z.literal(false).optional(), supportedModes: z.array(z.enum(['pull', 'push'])).optional(), memo: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() }).strict() }).strict().parse(challenge.request)
        const deadline = Date.parse(challenge.expires ?? '')
        if (challenge.method !== 'tempo' || challenge.intent !== 'charge' || (challenge.header && challenge.header.toLowerCase() !== 'authorization') || terms.currency.toLowerCase() !== token(chain) || (terms.methodDetails.supportedModes && !terms.methodDetails.supportedModes.includes('pull')) || !Number.isFinite(deadline) || deadline < Date.now() + 30_000 || deadline > Date.now() + 600_000 || BigInt(terms.amount) > BigInt(input.maxAmountAtomic)) throw Error('Unsupported or over-budget MPP challenge')
        record.to = getAddress(terms.recipient); record.amountAtomic = terms.amount; record.amount = formatUnits(BigInt(terms.amount), 6)
        const native = mnemonicToAccount(wallet.mnemonic), client = rpc(chain)
        if (native.address.toLowerCase() !== wallet.addresses.evm?.toLowerCase() || await client.getChainId() !== 42431) throw Error('Wrong signer or network')
        await reserveLocal(wallet.id, input.key, { chain, asset: 'alphaUSD', amountAtomic: terms.amount, maxFeeAtomic: fee })
        await confirm(`Pay ${record.amount} alphaUSD to ${record.to} on Tempo testnet for GET ${input.url}? Maximum fee: ${formatUnits(BigInt(fee), 18)} alphaUSD.`)
        let attempted = false
        const refuse = async (): Promise<never> => { throw Error('Only the approved transaction may be signed') }
        const account: typeof native = { ...native, sign: refuse, signMessage: refuse, signTypedData: refuse, async signTransaction(transaction, options) {
          if (attempted) throw Error('Only one MPP signature allowed'); attempted = true
          const unsigned = await tempoTestnet.serializers.transaction(transaction as never)
          if (!unsigned.startsWith('0x76')) throw Error('Not a Tempo transaction')
          const expected = TxEnvelopeTempo.deserialize(unsigned as `0x76${string}`)
          if (expected.chainId !== 42431 || expected.calls.length !== 1 || String(expected.feeToken).toLowerCase() !== token(chain) || expected.feePayerSignature || expected.accessList?.length || expected.authorizationList?.length || expected.nonceKey !== (1n << 256n) - 1n || !expected.validBefore || expected.validBefore * 1000 > deadline || expected.validBefore * 1000 < Date.now() + 3000 || (expected.validAfter ?? 0) * 1000 > Date.now() || !expected.gas || !expected.maxFeePerGas || roundTempo(expected.gas * expected.maxFeePerGas) > BigInt(fee)) throw Error('MPP transaction exceeds the approved terms')
          const call = expected.calls[0]!, decoded = decodeFunctionData({ abi: Abis.tip20, data: call.data! })
          if (call.to?.toLowerCase() !== token(chain) || (call.value ?? 0n) !== 0n || decoded.functionName !== 'transferWithMemo' || decoded.args[0].toLowerCase() !== record.to!.toLowerCase() || decoded.args[1] !== BigInt(terms.amount) || (terms.methodDetails.memo && decoded.args[2] !== terms.methodDetails.memo)) throw Error('Wrong MPP transfer')
          const signed = await signWithPolicy(wallet.id, input.key, () => native.signTransaction(transaction, options))
          const actual = TxEnvelopeTempo.deserialize(signed as `0x76${string}`)
          if (!actual.signature || TxEnvelopeTempo.getSignPayload(actual) !== TxEnvelopeTempo.getSignPayload(expected)) throw Error('Wrong signed transaction')
          record.signed = signed; record.hash = TxEnvelopeTempo.hash({ ...actual, signature: actual.signature })
          return signed
        } }
        const signingClient = createWalletClient({ account, chain: { ...tempoTestnet, feeToken: token(chain) as Hex }, transport: http(client.transport.url, { timeout: 15000, retryCount: 0 }) })
        const method = tempo.charge({ account, mode: 'pull', autoSwap: false, expectedChainId: 42431, expectedRecipients: [record.to as Hex], getClient: () => signingClient })
        record.credential = await method.createCredential({ challenge, context: {} })
        const proof = Credential.deserialize<{ type: string; signature: string }>(record.credential)
        if (!record.hash || proof.payload.type !== 'transaction' || proof.payload.signature !== record.signed || proof.challenge.id !== challenge.id) throw Error('Wrong MPP credential')
      } else {
        const challenge = decodePaymentRequiredHeader(response.headers['payment-required']!)
        if (challenge.x402Version !== 2) throw Error('Expected x402 v2')
        // As in hosted execution, bind the credential/journal to the actual requested
        // URL. Never follow or substitute the seller's advertised resource URL.
        const requirement = challenge.accepts.find(r => r.network === localNetworks[chain].chainId && r.scheme === 'exact' && (chain === 'solana' ? r.asset === solanaUsdc : r.asset.toLowerCase() === token(chain)) && (chain === 'solana' ? typeof r.extra?.feePayer === 'string' : r.extra?.name === 'USDC' && r.extra?.version === '2' && (!r.extra.assetTransferMethod || r.extra.assetTransferMethod === 'eip3009')))
        if (!requirement) throw Error('No supported x402 offer for this wallet/network')
        const payment = x402Payment.parse({ url: input.url, maxAmountAtomic: input.maxAmountAtomic, requirements: { ...requirement, extra: chain === 'solana' ? { feePayer: requirement.extra!.feePayer, ...(requirement.extra!.memo ? { memo: requirement.extra!.memo } : {}) } : { name: 'USDC', version: '2' } } })
        const requirements = payment.requirements
        if (BigInt(requirements.amount) > BigInt(input.maxAmountAtomic) || (chain === 'solana' && BigInt(requirements.amount) > (1n << 64n) - 1n)) throw Error('Seller price exceeds your maximum amount')
        record.to = chain === 'solana' ? requirements.payTo : getAddress(requirements.payTo); record.amountAtomic = requirements.amount; record.amount = formatUnits(BigInt(requirements.amount), 6)
        await reserveLocal(wallet.id, input.key, { chain, asset: 'USDC', amountAtomic: (BigInt(requirements.amount) * (chain === 'arc' ? 1_000_000_000_000n : 1n)).toString(), maxFeeAtomic: '0' })
        await confirm(`Pay ${record.amount} USDC to ${record.to} on ${localNetworks[chain].name} testnet for GET ${input.url}? Facilitator pays network fees.`)
        let payload
        if (chain === 'solana') {
          const prepared = await prepareLocalSvm(wallet, input.key, input.url, requirements)
          payload = prepared.payload; record.solana = prepared.proof; record.signed = (payload.payload as { transaction: string }).transaction
        } else {
          const native = mnemonicToAccount(wallet.mnemonic), client = rpc(chain)
          if (native.address.toLowerCase() !== wallet.addresses.evm?.toLowerCase() || await client.getChainId() !== localNetworks[chain].chain.id) throw Error('Wrong signer or network')
          record.fromBlock = String(await client.getBlockNumber())
          let attempted = false
          const x402 = new x402Client().register(localNetworks[chain].chainId as `eip155:${number}`, new ExactEvmScheme({ address: native.address, async signTypedData(data) {
            if (attempted) throw Error('Only one x402 signature allowed'); attempted = true
            const d = data.domain, m = data.message
            if (data.primaryType !== 'TransferWithAuthorization' || JSON.stringify(data.types) !== JSON.stringify(authorizationTypes) || d.name !== 'USDC' || d.version !== '2' || Number(d.chainId) !== localNetworks[chain].chain.id || String(d.verifyingContract).toLowerCase() !== token(chain) || String(m.from).toLowerCase() !== native.address.toLowerCase() || String(m.to).toLowerCase() !== record.to!.toLowerCase() || BigInt(String(m.value)) !== BigInt(requirements.amount) || BigInt(String(m.validAfter)) !== 0n || BigInt(String(m.validBefore)) <= BigInt(Math.floor(Date.now() / 1000)) || BigInt(String(m.validBefore)) > BigInt(Math.floor(Date.now() / 1000) + requirements.maxTimeoutSeconds + 5) || !/^0x[0-9a-fA-F]{64}$/.test(String(m.nonce))) throw Error('Wrong EIP-3009 authorization')
            record.nonce = m.nonce as Hex
            const signature = await signWithPolicy(wallet.id, input.key, () => native.signTypedData({ domain: { name: 'USDC', version: '2', chainId: localNetworks[chain].chain.id, verifyingContract: token(chain) as Hex }, types: authorizationTypes, primaryType: 'TransferWithAuthorization', message: { from: native.address, to: record.to as Hex, value: BigInt(requirements.amount), validAfter: 0n, validBefore: BigInt(String(m.validBefore)), nonce: record.nonce! } }))
            record.signature = signature
            return signature
          } }))
          x402.setSpendControls({ allowedAssets: [{ network: localNetworks[chain].chainId, asset: token(chain), maxAmountPerPayment: requirements.amount }] })
          payload = await x402.createPaymentPayload({ x402Version: 2, resource: { url: input.url }, accepts: [requirements] })
        }
        record.credential = encodePaymentSignatureHeader(payload)
      }
      record.status = 'unknown'; save() // Persist signed proof before ANY paid HTTP request.
    } catch (error) {
      await releaseUnissued(wallet.id, input.key)
      record.status = 'preparation_failed'; save()
      if (error instanceof LocalPolicyError) throw error
      throw Error('Paid request preparation failed; no paid HTTP request was submitted. Inspect the journal/limits/terms before trying another key.')
    }
    try {
      const response = await paymentHttp({ url: input.url, method: 'GET', headers: {} }, chain === 'tempo' ? { Authorization: record.credential! } : { 'PAYMENT-SIGNATURE': record.credential! }, origins, async headers => {
        if (chain === 'tempo') return
        const header = headers['payment-response'] ?? headers['x-payment-response']
        if (!header) return
        const settlement = decodePaymentResponseHeader(header)
        if (settlement.network !== localNetworks[chain].chainId || (settlement.payer && (chain === 'solana' ? settlement.payer !== wallet.addresses.solana : settlement.payer.toLowerCase() !== wallet.addresses.evm!.toLowerCase())) || !(chain === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{64,88}$/ : /^0x[0-9a-fA-F]{64}$/).test(settlement.transaction)) throw Error('Invalid settlement header')
        record.hash = settlement.transaction; save()
      })
      const body = Buffer.from(response.bodyBase64, 'base64')
      const secrets = [record.credential, record.signed, record.signature, record.solana?.payerSignature].filter((s): s is string => Boolean(s))
      const reflected = (chain === 'solana' && record.signed ? body.includes(Buffer.from(record.signed, 'base64')) : false) || secrets.some(secret => body.includes(Buffer.from(secret)) || (/^0x[0-9a-f]+$/i.test(secret) && body.includes(Buffer.from(secret.slice(2), 'hex'))))
      record.httpResponse = reflected ? { status: 502, headers: { 'content-type': 'text/plain' }, bodyBase64: Buffer.from('Upstream returned payment credentials; response withheld').toString('base64') } : { ...response, headers: { 'content-type': response.headers['content-type'] ?? 'application/octet-stream' } }
      save()
    } catch { record.httpError = 'HTTP response unavailable. Payment may still settle; no automatic resend.'; save() }
    for (let i = 0; i < 10; i++) { await reconcile(); if (record.status === 'confirmed' || record.status === 'failed') break; await new Promise(resolve => setTimeout(resolve, 2000)) }
    return summary()
  } finally { unlinkSync(lock) }
}
