import { z } from 'zod'
import { Challenge, Credential } from 'mppx'
import { tempo } from 'mppx/client'
import { Methods } from 'mppx/tempo'
import { createViemAccount, formatViemTransaction } from '@privy-io/node/viem'
import type { PrivyClient } from '@privy-io/node'
import { createWalletClient, http, decodeFunctionData, getAddress, type Hex } from 'viem'
import { tempoTestnet } from 'viem/chains'
import { Abis } from 'viem/tempo'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { positiveAtomic, type FetchRequest, type OperationInput, type PaidHttpResponse } from '@agentis-hq/core/operations'
import type { WalletRow } from '../db/schema'
import { evmClient } from './networks'
import { roundedTempoFee, tempoFeeToken } from './tempo'
import { paymentHttp } from './payment-http'
import { fail } from '../errors'

const network = 'eip155:42431'
const origins = () => (process.env.AGENTIS_PAID_FETCH_LOCAL_ORIGINS ?? '').split(',').filter(Boolean)
const terms = z.object({ amount: positiveAtomic, currency: z.string(), recipient: z.string(), methodDetails: z.object({
  chainId: z.literal(42431), feePayer: z.literal(false).optional(), supportedModes: z.array(z.enum(['pull', 'push'])).optional(), memo: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
}).strict() }).strict()
function parseChallenge(header: string) {
  const challenge = Challenge.deserialize(header, { methods: [Methods.charge] })
  const request = terms.parse(challenge.request)
  if (challenge.method !== 'tempo' || challenge.intent !== 'charge' || (challenge.header && challenge.header.toLowerCase() !== 'authorization') || request.currency.toLowerCase() !== tempoFeeToken || (request.methodDetails.supportedModes && !request.methodDetails.supportedModes.includes('pull')) || !challenge.expires || !Number.isFinite(Date.parse(challenge.expires))) throw new Error('Unsupported Tempo charge')
  return { challenge, request }
}
export async function discoverMpp(input: FetchRequest): Promise<OperationInput> {
  if (!input.maxFeeAtomic) fail(400, 'fee_cap_required', 'Tempo requires --max-fee-atomic (18-decimal protocol USD fee units)')
  let response
  try { response = await paymentHttp({ url: input.url, method: 'GET', headers: {} }, {}, origins()) }
  catch { fail(400, 'paid_fetch_unavailable', 'Paid URL was blocked or unavailable; no payment was created') }
  if (response.status !== 402 || !response.headers['www-authenticate']) fail(400, 'mpp_required', 'Expected a Tempo MPP charge challenge')
  let parsed
  try { parsed = parseChallenge(response.headers['www-authenticate']) } catch { fail(400, 'unsupported_payment', 'Only unsponsored Tempo testnet alphaUSD MPP charges are enabled') }
  const { challenge, request } = parsed
  if (BigInt(request.amount) > BigInt(input.maxAmountAtomic)) fail(409, 'price_limit', 'Seller price exceeds your payment ceiling')
  const deadline = Date.parse(challenge.expires!)
  if (deadline < Date.now() + 30_000 || deadline > Date.now() + 600_000) fail(400, 'challenge_expiry', 'Expected a challenge expiring within ten minutes, with time left to approve')
  return { walletId: input.walletId, action: 'paid_fetch', chainId: network, asset: `erc20:${tempoFeeToken}`, to: getAddress(request.recipient), amountAtomic: request.amount, maxFeeAtomic: input.maxFeeAtomic, reason: input.reason ?? '', mpp: { url: input.url, challenge: response.headers['www-authenticate'], expiresAt: challenge.expires!, maxAmountAtomic: input.maxAmountAtomic } }
}
export function validateMpp(wallet: WalletRow, input: OperationInput) {
  if (!input.mpp || input.payment || input.action !== 'paid_fetch' || wallet.chainId !== network || input.chainId !== network || input.asset.toLowerCase() !== `erc20:${tempoFeeToken}` || BigInt(input.maxFeeAtomic) <= 0n) throw new Error('Invalid MPP operation')
  const parsed = parseChallenge(input.mpp.challenge)
  if (parsed.request.recipient.toLowerCase() !== input.to.toLowerCase() || parsed.request.amount !== input.amountAtomic || BigInt(input.amountAtomic) > BigInt(input.mpp.maxAmountAtomic) || parsed.challenge.expires !== input.mpp.expiresAt) throw new Error('MPP terms differ from approval')
  return parsed.challenge
}

type SignedPayment = { input: OperationInput; credential: string; signed: Hex; hash: Hex }
export function createPrivyMpp(privy: PrivyClient, authorizationKey: string, inspect: (id: string, owner: string) => Promise<{ address: string; serverAuthorized?: boolean }>) {
  return {
    async prepare(wallet: WalletRow, input: OperationInput, execution: { id: string; expiresAt: Date }) {
      const challenge = validateMpp(wallet, input)
      const deadline = Math.min(execution.expiresAt.getTime(), Date.parse(challenge.expires!))
      if (Date.now() + 30_000 >= deadline) throw new Error('MPP approval expired or too close to expiry')
      const owned = await inspect(wallet.providerWalletId, wallet.ownerId)
      if (!owned.serverAuthorized || owned.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Wallet ownership changed')
      const rpc = evmClient(network)
      if (await rpc.getChainId() !== 42431) throw new Error('RPC network mismatch')
      const native = createViemAccount(privy, { walletId: wallet.providerWalletId, address: wallet.address as Hex, authorizationContext: { authorization_private_keys: [authorizationKey] } })
      let signed: Hex | undefined, hash: Hex | undefined, attempted = false
      const refuse = async (): Promise<never> => { throw new Error('Only the approved Tempo transaction may be signed') }
      const account: typeof native = { ...native, sign: refuse, signMessage: refuse, signTypedData: refuse, async signTransaction(transaction, options) {
        if (attempted) throw new Error('Only one MPP signature is allowed')
        attempted = true
        const tx = formatViemTransaction(transaction)
        if (tx.type !== 118 || tx.chain_id !== 42431 || tx.calls.length !== 1 || tx.fee_token?.toLowerCase() !== tempoFeeToken || tx.fee_payer_signature || tx.access_list?.length || BigInt(tx.valid_after ?? 0) < 0n || BigInt(tx.valid_after ?? 0) > BigInt(Math.floor(Date.now() / 1000))) throw new Error('Unsupported Tempo transaction')
        const call = tx.calls[0]!
        const decoded = decodeFunctionData({ abi: Abis.tip20, data: call.data as Hex })
        if (call.to.toLowerCase() !== tempoFeeToken || BigInt(call.value ?? 0) !== 0n || decoded.functionName !== 'transferWithMemo' || decoded.args[0].toLowerCase() !== input.to.toLowerCase() || decoded.args[1] !== BigInt(input.amountAtomic)) throw new Error('MPP call differs from approved recipient or amount')
        const expected = TxEnvelopeTempo.from({ chainId: 42431, calls: [{ to: tempoFeeToken, data: call.data as Hex, value: 0n }], feeToken: tempoFeeToken, nonceKey: BigInt(tx.nonce_key!), nonce: BigInt(tx.nonce!), validAfter: Number(BigInt(tx.valid_after ?? 0)), validBefore: Number(BigInt(tx.valid_before!)), gas: BigInt(tx.gas_limit!), maxFeePerGas: BigInt(tx.max_fee_per_gas!), maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas!) })
        if (expected.nonceKey !== (1n << 256n) - 1n || expected.validBefore! * 1000 > deadline || expected.validBefore! * 1000 <= Date.now() + 3000 || roundedTempoFee(expected.gas! * expected.maxFeePerGas!) > BigInt(input.maxFeeAtomic)) throw new Error('MPP expiry or gas exceeds approval')
        signed = await native.signTransaction(transaction, options)
        const actual = TxEnvelopeTempo.deserialize(signed as `0x76${string}`)
        const payload = TxEnvelopeTempo.getSignPayload(actual)
        if (payload !== TxEnvelopeTempo.getSignPayload(expected) || !actual.signature || SignatureEnvelope.extractAddress({ payload, signature: actual.signature }).toLowerCase() !== wallet.address.toLowerCase() || expected.validBefore! * 1000 <= Date.now()) throw new Error('Privy transaction differs from approval')
        hash = TxEnvelopeTempo.hash({ ...actual, signature: actual.signature })
        return signed
      } }
      const client = createWalletClient({ account, chain: { ...tempoTestnet, feeToken: tempoFeeToken }, transport: http(rpc.transport.url, { timeout: 15_000, retryCount: 0 }) })
      // Pull mode signs only. The common worker persists the proof before sending it.
      const method = tempo.charge({ account, mode: 'pull', autoSwap: false, expectedChainId: 42431, expectedRecipients: [input.to as Hex], getClient: () => client })
      const credential = await method.createCredential({ challenge, context: {} })
      const proof = Credential.deserialize<{ type: string; signature: string }>(credential)
      if (!signed || !hash || proof.payload.type !== 'transaction' || proof.payload.signature !== signed || proof.challenge.id !== challenge.id) throw new Error('Unexpected MPP credential')
      const stored: SignedPayment = { input, credential, signed, hash }
      return { signedTransaction: `mpp:${JSON.stringify(stored)}`, transactionHash: hash }
    },
    async broadcast(serialized: string): Promise<PaidHttpResponse> {
      if (!serialized.startsWith('mpp:')) throw new Error('Expected a persisted MPP credential')
      const stored: SignedPayment = JSON.parse(serialized.slice(4))
      const response = await paymentHttp({ url: stored.input.mpp!.url, method: 'GET', headers: {} }, { Authorization: stored.credential }, origins())
      const body = Buffer.from(response.bodyBase64, 'base64')
      const reflected = [Buffer.from(stored.credential), Buffer.from(stored.signed), Buffer.from(stored.signed.slice(2), 'hex')].some(value => body.includes(value))
      return { status: reflected ? 502 : response.status, headers: { 'content-type': reflected ? 'text/plain' : response.headers['content-type'] ?? 'application/octet-stream' }, bodyBase64: reflected ? Buffer.from('Upstream returned payment credentials; response withheld').toString('base64') : response.bodyBase64 }
    },
  }
}
