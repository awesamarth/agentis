import { Challenge, Credential, Receipt } from 'mppx'
import { tempo } from 'mppx/client'
import { createViemAccount, formatViemTransaction } from '@privy-io/node/viem'
import type { PrivyClient } from '@privy-io/node'
import { createWalletClient, http, getAddress, type Hex } from 'viem'
import { tempo as tempoMainnet } from 'viem/chains'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { paymentRequest, httpFields, paymentTransfers, type FetchRequest, type OperationInput, type PaidHttpResponse } from '@agentis-hq/core/operations'
import type { WalletRow } from '../db/schema'
import { evmClient, requireNetwork } from './networks'
import { roundedTempoFee, selectTempoChallenge, parseTempoChallenge, tempoFeeAsset, tempoAsset, defaultTempoFeeAsset, checkTempoFunds, reconcileTempoPayment, assertTempoPaymentCalls, tempoPaymentMemo, prepareTempoPush, broadcastTempoPush } from '@agentis-hq/core/tempo'
import { paymentHttp } from './payment-http'
import { fail } from '../errors'

function mppNetwork(chainId: string) {
  const network = requireNetwork(chainId)
  if (!network.mpp || !network.feeToken || !network.chain) throw Error('Unsupported MPP network')
  return { ...network, feeToken: network.feeToken, chain: network.chain }
}
const origins = () => (process.env.AGENTIS_PAID_FETCH_LOCAL_ORIGINS ?? '').split(',').filter(Boolean)

export async function discoverMpp(input: FetchRequest, chainId = 'eip155:4217'): Promise<OperationInput> {
  mppNetwork(chainId)
  let selectedFee: string | undefined
  try {
    if (input.asset) tempoAsset(chainId, input.asset)
    if (input.feeAsset) selectedFee = tempoFeeAsset({ chainId, feeAsset: input.feeAsset }).id
  } catch { fail(400, 'unsupported_token', 'Choose an enabled Tempo payment token and an eligible fee token for this network') }
  let response
  try { response = await paymentHttp(paymentRequest(input), {}, origins()) }
  catch { fail(400, 'paid_fetch_unavailable', 'Paid URL was blocked or unavailable; no payment was created') }
  if (response.status !== 402 || !response.headers['www-authenticate']) fail(400, 'mpp_required', 'Expected a Tempo MPP charge challenge')
  let parsed
  try { parsed = selectTempoChallenge(response.headers['www-authenticate'], chainId, input.maxAmountAtomic, input.asset, Date.now(), !input.maxFeeAtomic || input.maxFeeAtomic === '0') } catch { fail(400, 'unsupported_payment', 'No supported Tempo charge within the selected token, network, price and expiry limits') }
  const { challenge, request, asset, mode } = parsed
  const sponsored = request.methodDetails.feePayer === true
  if (!sponsored && (!input.maxFeeAtomic || BigInt(input.maxFeeAtomic) === 0n)) fail(400, 'fee_cap_required', 'This charge requires an agent-paid gas budget')
  if ((!challenge.header || challenge.header.toLowerCase() === 'authorization') && Object.keys(input.headers ?? {}).some(key => key.toLowerCase() === 'authorization')) fail(400, 'authorization_conflict', 'Seller must advertise Payment-Authorization to combine application auth and payment')
  const feeAsset = sponsored ? undefined : selectedFee ?? defaultTempoFeeAsset(chainId, asset.id).id
  if (BigInt(request.amount) > BigInt(input.maxAmountAtomic)) fail(409, 'price_limit', 'Seller price exceeds your payment ceiling')
  const deadline = Date.parse(challenge.expires!)
  if (deadline < Date.now() + 30_000 || deadline > Date.now() + 600_000) fail(400, 'challenge_expiry', 'Expected a challenge expiring within ten minutes, with time left to approve')
  return { walletId: input.walletId, action: 'paid_fetch', chainId, asset: asset.id, feeAsset, to: getAddress(request.recipient), amountAtomic: request.amount, maxFeeAtomic: sponsored ? '0' : input.maxFeeAtomic!, reason: input.reason ?? '', mpp: { ...httpFields(input), mode, ...(request.methodDetails.splits ? { splits: request.methodDetails.splits.map(split => ({ to: getAddress(split.recipient), amountAtomic: split.amount })) } : {}), sponsored, url: input.url, challenge: Challenge.serialize(challenge), expiresAt: challenge.expires!, maxAmountAtomic: input.maxAmountAtomic } }
}
export function validateMpp(wallet: WalletRow, input: OperationInput) {
  const network = input.chainId
  mppNetwork(network)
  tempoFeeAsset(input)
  if (!input.mpp || input.payment || input.action !== 'paid_fetch' || wallet.chainId !== network) throw new Error('Invalid MPP operation')
  const parsed = parseTempoChallenge(input.mpp.challenge, network)
  paymentRequest(input.mpp)
  if ((input.mpp.mode ?? 'pull') !== parsed.mode) throw Error('MPP delivery mode differs from approval')
  if ((!parsed.challenge.header || parsed.challenge.header.toLowerCase() === 'authorization') && Object.keys(input.mpp.headers ?? {}).some(key => key.toLowerCase() === 'authorization')) throw Error('Application authentication conflicts with the payment header')
  if ((parsed.request.methodDetails.feePayer === true) !== !!input.mpp.sponsored || (input.mpp.sponsored ? input.maxFeeAtomic !== '0' : BigInt(input.maxFeeAtomic) <= 0n)) throw Error('Sponsorship differs from approval')
  if (input.asset.toLowerCase() !== parsed.asset.id) throw Error('MPP currency differs from approval')
  const approved = (input.mpp.splits ?? []).map(split => [split.to.toLowerCase(), split.amountAtomic])
  const offered = (parsed.request.methodDetails.splits ?? []).map(split => [split.recipient.toLowerCase(), split.amount])
  if (JSON.stringify(approved) !== JSON.stringify(offered)) throw Error('MPP recipients differ from approval')
  if (parsed.request.recipient.toLowerCase() !== input.to.toLowerCase() || parsed.request.amount !== input.amountAtomic || BigInt(input.amountAtomic) > BigInt(input.mpp.maxAmountAtomic) || parsed.challenge.expires !== input.mpp.expiresAt) throw new Error('MPP terms differ from approval')
  return parsed.challenge
}

type SignedPayment = { input: OperationInput; credential: string; signed: Hex; hash: Hex | null; fromBlock?: string }
export function createPrivyMpp(privy: PrivyClient, authorizationKey: string, inspect: (id: string, owner: string) => Promise<{ address: string; serverAuthorized?: boolean }>) {
  return {
    async prepare(wallet: WalletRow, input: OperationInput, execution: { id: string; expiresAt: Date }) {
      const config = mppNetwork(input.chainId), network = config.chainId
      const tempoFeeToken = (input.mpp?.sponsored ? defaultTempoFeeAsset(network, input.asset) : tempoFeeAsset(input)).id.slice(6) as Hex
      const paymentToken = tempoAsset(network, input.asset).id.slice(6) as Hex
      const challenge = validateMpp(wallet, input)
      const sponsored = !!input.mpp!.sponsored
      const deadline = Math.min(execution.expiresAt.getTime(), Date.parse(challenge.expires!))
      if (Date.now() + 30_000 >= deadline) throw new Error('MPP approval expired or too close to expiry')
      const owned = await inspect(wallet.providerWalletId, wallet.ownerId)
      if (!owned.serverAuthorized || owned.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Wallet ownership changed')
      const rpc = evmClient(network)
      if (await rpc.getChainId() !== config.chain.id) throw new Error('RPC network mismatch')
      const fromBlock = sponsored ? String(await rpc.getBlockNumber()) : undefined
      const native = createViemAccount(privy, { walletId: wallet.providerWalletId, address: wallet.address as Hex, authorizationContext: { authorization_private_keys: [authorizationKey] } })
      let signed: Hex | undefined, hash: Hex | undefined, attempted = false
      const refuse = async (): Promise<never> => { throw new Error('Only the approved Tempo transaction may be signed') }
      const account: typeof native = { ...native, sign: refuse, signMessage: refuse, signTypedData: refuse, signAuthorization: refuse, async signTransaction(transaction, options) {
        if (attempted) throw new Error('Only one MPP signature is allowed')
        attempted = true
        const tx = formatViemTransaction(transaction)
        if (tx.type !== 118 || tx.chain_id !== config.chain.id || (sponsored ? (transaction as { feePayer?: unknown }).feePayer !== true || tx.fee_token !== undefined : tx.fee_token?.toLowerCase() !== tempoFeeToken || !!(transaction as { feePayer?: unknown }).feePayer) || tx.fee_payer_signature || tx.access_list?.length || BigInt(tx.valid_after ?? 0) < 0n || BigInt(tx.valid_after ?? 0) > BigInt(Math.floor(Date.now() / 1000))) throw new Error('Unsupported Tempo transaction')
        assertTempoPaymentCalls(tx.calls, input, [tempoPaymentMemo(challenge), ...(challenge.request.methodDetails.splits ?? []).map(split => split.memo)])
        const expected = TxEnvelopeTempo.from({ chainId: config.chain.id, calls: tx.calls.map(call => ({ to: paymentToken, data: call.data as Hex, value: 0n })), ...(sponsored ? { feePayerSignature: null } : { feeToken: tempoFeeToken }), nonceKey: BigInt(tx.nonce_key!), nonce: BigInt(tx.nonce!), validAfter: Number(BigInt(tx.valid_after ?? 0)), validBefore: Number(BigInt(tx.valid_before!)), gas: BigInt(tx.gas_limit!), maxFeePerGas: BigInt(tx.max_fee_per_gas!), maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas!) })
        if (expected.nonceKey !== (1n << 256n) - 1n || expected.validBefore! * 1000 > deadline || expected.validBefore! * 1000 <= Date.now() + 3000 || (!sponsored && roundedTempoFee(expected.gas! * expected.maxFeePerGas!) > BigInt(input.maxFeeAtomic))) throw new Error('MPP expiry or gas exceeds approval')
        const envelope = transaction as unknown as { authorizationList?: unknown[]; keyAuthorization?: unknown }
        if (envelope.authorizationList?.length || envelope.keyAuthorization) throw Error('Tempo delegation is not supported')
        await checkTempoFunds(rpc, input, wallet.address as Hex, expected.gas! * expected.maxFeePerGas!, sponsored)
        if (expected.validBefore! * 1000 <= Date.now() + 3000) throw Error('MPP signing window expired')
        // Privy's installed transaction formatter drops the sponsorship marker.
        // Sign only this locally constructed, fully validated Tempo payload; never
        // expose the raw-hash signer to the MPP SDK or caller.
        signed = sponsored
          ? TxEnvelopeTempo.serialize(expected, { format: 'feePayer', signature: SignatureEnvelope.from(await native.sign!({ hash: TxEnvelopeTempo.getSignPayload(expected) })) })
          : await native.signTransaction(transaction, options)
        const actual = TxEnvelopeTempo.deserialize(signed as never)
        const payload = TxEnvelopeTempo.getSignPayload(actual)
        if (payload !== TxEnvelopeTempo.getSignPayload(expected) || !actual.signature || SignatureEnvelope.extractAddress({ payload, signature: actual.signature }).toLowerCase() !== wallet.address.toLowerCase() || expected.validBefore! * 1000 <= Date.now()) throw new Error('Privy transaction differs from approval')
        if (!sponsored) hash = TxEnvelopeTempo.hash({ ...actual, signature: actual.signature })
        return signed
      } }
      const client = createWalletClient({ account, chain: { ...config.chain as typeof tempoMainnet, feeToken: tempoFeeToken }, transport: http(rpc.transport.url, { timeout: 15_000, retryCount: 0 }) })
      // Both branches sign only. The common worker persists before any submission.
      const push = input.mpp!.mode === 'push'
      const credential = push ? await prepareTempoPush(client, challenge) : await tempo.charge({ account, mode: 'pull', autoSwap: false, expectedChainId: config.chain.id, expectedRecipients: paymentTransfers(input).map(transfer => transfer.to as Hex), getClient: () => client }).createCredential({ challenge, context: {} })
      const proof = Credential.deserialize<{ type: string; signature?: string; hash?: string }>(credential)
      if (!signed || (!sponsored && !hash) || (push ? proof.payload.type !== 'hash' || proof.payload.hash !== hash : proof.payload.type !== 'transaction' || proof.payload.signature !== signed) || proof.challenge.id !== challenge.id) throw new Error('Unexpected MPP credential')
      const stored: SignedPayment = { input, credential, signed, hash: hash ?? null, fromBlock }
      return { signedTransaction: `mpp:${JSON.stringify(stored)}`, transactionHash: hash ?? null }
    },
    async broadcast(serialized: string, savePaymentHash?: (hash: string) => Promise<void>): Promise<PaidHttpResponse> {
      if (!serialized.startsWith('mpp:')) throw new Error('Expected a persisted MPP credential')
      const stored: SignedPayment = JSON.parse(serialized.slice(4))
      const challenge = parseTempoChallenge(stored.input.mpp!.challenge, stored.input.chainId).challenge
      if (stored.input.mpp!.mode === 'push') {
        if (!stored.hash) throw Error('Missing persisted Tempo push hash')
        await broadcastTempoPush(evmClient(stored.input.chainId), stored.input, stored.signed, stored.hash)
      }
      const response = await paymentHttp(paymentRequest(stored.input.mpp!), { [challenge.header ?? 'Authorization']: stored.credential }, origins(), async headers => {
        if (!headers['payment-receipt']) return
        const receipt = Receipt.deserialize(headers['payment-receipt'])
        if (receipt.method !== 'tempo' || !/^0x[0-9a-fA-F]{64}$/.test(receipt.reference) || (stored.hash && receipt.reference.toLowerCase() !== stored.hash.toLowerCase())) throw Error('Invalid Tempo settlement reference')
        await savePaymentHash?.(receipt.reference)
      })
      const body = Buffer.from(response.bodyBase64, 'base64')
      const reflected = [Buffer.from(stored.credential), Buffer.from(stored.signed), Buffer.from(stored.signed.slice(2), 'hex')].some(value => body.includes(value))
      return { status: reflected ? 502 : response.status, headers: { 'content-type': reflected ? 'text/plain' : response.headers['content-type'] ?? 'application/octet-stream' }, bodyBase64: reflected ? Buffer.from('Upstream returned payment credentials; response withheld').toString('base64') : response.bodyBase64 }
    },
    async receipt(serialized: string, input: OperationInput, hash?: string | null) {
      const stored: SignedPayment = JSON.parse(serialized.slice(4))
      if (JSON.stringify(stored.input) !== JSON.stringify(input)) throw Error('Persisted Tempo payment mismatch')
      return reconcileTempoPayment(evmClient(input.chainId), input, stored.signed, hash ?? stored.hash, stored.fromBlock)
    },
  }
}
