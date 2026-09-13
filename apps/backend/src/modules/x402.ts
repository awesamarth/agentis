import { x402Client } from '@x402/core/client'
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http'
import type { PaymentPayload } from '@x402/core/types'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { authorizationTypes } from '@x402/evm'
import { getAddress, parseAbi, parseAbiItem, parseEventLogs, erc20Abi, recoverTypedDataAddress, type Hex } from 'viem'
import { PrivyClient } from '@privy-io/node'
import type { FetchRequest, OperationInput, Operation, PaidHttpResponse } from '@agentis-hq/core/operations'
import { x402Payment } from '@agentis-hq/core/operations'
import type { WalletRow } from '../db/schema'
import { baseUsdc, sepoliaUsdc, evmClient } from './networks'
import { paymentHttp } from './payment-http'
import { settlementHeaders, type SavePaymentHash } from './x402-settlement'
import { fail } from '../errors'

function evmRail(network: string): { network: `eip155:${number}`; chainId: number; token: Hex; asset: string; scale: bigint } {
  if (network === 'eip155:11155111') return { network, chainId: 11155111, token: sepoliaUsdc as Hex, asset: `erc20:${sepoliaUsdc}`, scale: 1n }
  if (network === 'eip155:84532') return { network, chainId: 84532, token: baseUsdc as Hex, asset: `erc20:${baseUsdc}`, scale: 1n }
  // Arc exposes the same USDC balance as native 18-decimal units and ERC-20 6-decimal units.
  if (network === 'eip155:5042002') return { network, chainId: 5042002, token: '0x3600000000000000000000000000000000000000' as Hex, asset: 'native', scale: 1_000_000_000_000n }
  throw new Error('Unsupported EVM x402 network')
}
const origins = () => (process.env.AGENTIS_PAID_FETCH_LOCAL_ORIGINS ?? '').split(',').filter(Boolean)
const usedEvent = parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)')

export async function discoverX402(input: FetchRequest, network = 'eip155:84532'): Promise<OperationInput> {
  const rail = evmRail(network)
  let response
  try { response = await paymentHttp({ url: input.url, method: 'GET', headers: {} }, {}, origins()) }
  catch { fail(400, 'paid_fetch_unavailable', 'Paid URL was blocked or unavailable; no payment was created') }
  if (response.status !== 402 || !response.headers['payment-required']) fail(400, 'x402_required', 'Expected an x402 v2 payment challenge; only paid GET requests are enabled')
  let challenge
  try { challenge = decodePaymentRequiredHeader(response.headers['payment-required']) } catch { fail(400, 'invalid_challenge', 'Invalid x402 challenge') }
  if (challenge.x402Version !== 2 || !Array.isArray(challenge.accepts)) fail(400, 'invalid_challenge', 'Expected x402 v2')
  const selected = challenge.accepts.find(r => r.network === network && r.scheme === 'exact' && r.asset.toLowerCase() === rail.token && r.extra?.name === 'USDC' && r.extra?.version === '2' && (!r.extra.assetTransferMethod || r.extra.assetTransferMethod === 'eip3009'))
  if (!selected) fail(400, 'unsupported_payment', 'Expected USDC exact EIP-3009 on the selected Base or Arc testnet wallet' )
  const payment = x402Payment.parse({ url: input.url, maxAmountAtomic: input.maxAmountAtomic, requirements: { ...selected, extra: { name: 'USDC', version: '2' } } })
  if (BigInt(payment.requirements.amount) > BigInt(input.maxAmountAtomic)) fail(409, 'price_limit', 'Seller price exceeds your payment ceiling')
  return { walletId: input.walletId, action: 'paid_fetch', chainId: network, asset: rail.asset, to: getAddress(selected.payTo), amountAtomic: (BigInt(selected.amount) * rail.scale).toString(), maxFeeAtomic: '0', reason: input.reason ?? '', payment }
}

export function validateX402(wallet: WalletRow, input: OperationInput) {
  const p = input.payment
  const rail = evmRail(input.chainId), network = rail.network
  if (input.action !== 'paid_fetch' || wallet.chainId !== network || input.chainId !== network || input.asset.toLowerCase() !== rail.asset || !p || p.requirements.network !== network || p.requirements.scheme !== 'exact' || p.requirements.asset.toLowerCase() !== rail.token || p.requirements.payTo.toLowerCase() !== input.to.toLowerCase() || BigInt(p.requirements.amount) * rail.scale !== BigInt(input.amountAtomic) || BigInt(p.requirements.amount) > BigInt(p.maxAmountAtomic) || input.maxFeeAtomic !== '0') throw new Error('Payment terms do not match the operation')
}

type SignedPayment = { input: OperationInput; payer: Hex; fromBlock: string; payload: PaymentPayload; nonce: Hex }
function unpack(serialized: string): SignedPayment {
  if (!serialized.startsWith('x402:')) throw new Error('Expected a persisted x402 authorization')
  return JSON.parse(serialized.slice(5))
}

export function createPrivyX402(privy: PrivyClient, authorizationKey: string, inspect: (id: string, owner: string) => Promise<{ address: string; serverAuthorized?: boolean }>) {
  return {
    async prepare(wallet: WalletRow, input: OperationInput, execution: { id: string; expiresAt: Date }) {
      validateX402(wallet, input)
      const rail = evmRail(input.chainId), network = rail.network
      const owned = await inspect(wallet.providerWalletId, wallet.ownerId)
      if (!owned.serverAuthorized || owned.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Wallet ownership changed')
      const rpc = evmClient(network)
      if (await rpc.getChainId() !== rail.chainId) throw new Error('RPC network mismatch')
      const fromBlock = (await rpc.getBlockNumber()).toString()
      const requirements = input.payment!.requirements
      if (Date.now() + (requirements.maxTimeoutSeconds + 5) * 1000 >= execution.expiresAt.getTime()) throw new Error('Not enough authorization time remains; request a fresh payment')
      let nonce: Hex | undefined
      const client = new x402Client().register(network, new ExactEvmScheme({
        address: wallet.address as Hex,
        async signTypedData(data) {
          // The SDK chooses the nonce, but cannot ask our signer for arbitrary permissions.
          if (nonce) throw new Error('Only one signature is allowed')
          const d = data.domain, m = data.message
          if (data.primaryType !== 'TransferWithAuthorization' || JSON.stringify(data.types) !== JSON.stringify(authorizationTypes) || d.name !== 'USDC' || d.version !== '2' || Number(d.chainId) !== rail.chainId || String(d.verifyingContract).toLowerCase() !== rail.token || String(m.from).toLowerCase() !== wallet.address.toLowerCase() || String(m.to).toLowerCase() !== input.to.toLowerCase() || BigInt(String(m.value)) !== BigInt(requirements.amount) || BigInt(String(m.validAfter)) !== 0n || BigInt(String(m.validBefore)) * 1000n > BigInt(execution.expiresAt.getTime()) || BigInt(String(m.validBefore)) <= BigInt(Math.floor(Date.now() / 1000)) || !/^0x[0-9a-fA-F]{64}$/.test(String(m.nonce))) throw new Error('Unexpected typed-data authorization')
          nonce = m.nonce as Hex
          const message = { from: getAddress(wallet.address), to: getAddress(input.to), value: BigInt(requirements.amount), validAfter: 0n, validBefore: BigInt(String(m.validBefore)), nonce }
          const result = await privy.wallets().ethereum().signTypedData(wallet.providerWalletId, {
            params: { typed_data: { domain: { name: 'USDC', version: '2', chainId: rail.chainId, verifyingContract: rail.token }, types: { TransferWithAuthorization: [...authorizationTypes.TransferWithAuthorization] }, primary_type: 'TransferWithAuthorization', message: Object.fromEntries(Object.entries(message).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value])) } },
            authorization_context: { authorization_private_keys: [authorizationKey] },
            idempotency_key: execution.id, request_expiry: Math.min(execution.expiresAt.getTime(), Date.now() + 60_000),
          })
          const signature = result.signature as Hex
          if ((await recoverTypedDataAddress({ domain: { name: 'USDC', version: '2', chainId: rail.chainId, verifyingContract: rail.token }, types: authorizationTypes, primaryType: 'TransferWithAuthorization', message, signature })).toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Privy signature does not match the wallet')
          return signature
        },
      }))
      client.setSpendControls({ allowedAssets: [{ network, asset: rail.token, maxAmountPerPayment: requirements.amount }] })
      const payload = await client.createPaymentPayload({ x402Version: 2, resource: { url: input.payment!.url }, accepts: [requirements] })
      if (!nonce) throw new Error('Missing payment authorization')
      const signed: SignedPayment = { input, payer: wallet.address as Hex, fromBlock, payload, nonce }
      return { signedTransaction: `x402:${JSON.stringify(signed)}`, transactionHash: null }
    },
    async broadcast(serialized: string, savePaymentHash?: SavePaymentHash): Promise<PaidHttpResponse> {
      const signed = unpack(serialized)
      const response = await paymentHttp({ url: signed.input.payment!.url, method: 'GET', headers: {} }, { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(signed.payload) }, origins(), settlementHeaders(signed.input.chainId, signed.payer, savePaymentHash))
      // Do not expose payment credentials echoed by an upstream. Keep binary responses otherwise.
      const signature = (signed.payload.payload as { signature: string }).signature
      const body = Buffer.from(response.bodyBase64, 'base64')
      const reflected = [Buffer.from(signature), Buffer.from(signature.slice(2), 'hex'), Buffer.from(encodePaymentSignatureHeader(signed.payload))].some(value => body.includes(value))
      return { status: reflected ? 502 : response.status, headers: { 'content-type': reflected ? 'text/plain' : response.headers['content-type'] ?? 'application/octet-stream' }, bodyBase64: reflected ? Buffer.from('Upstream returned payment credentials; response withheld').toString('base64') : response.bodyBase64 }
    },
    async receipt(serialized: string, input: OperationInput, transactionHash?: string | null): Promise<Operation['receipt'] | { expiredUnused: true }> {
      const signed = unpack(serialized)
      const rail = evmRail(input.chainId), network = rail.network
      if (JSON.stringify(input) !== JSON.stringify(signed.input)) throw new Error('Persisted payment mismatch')
      const rpc = evmClient(network)
      if (await rpc.getChainId() !== rail.chainId) throw new Error('RPC network mismatch')
      let hash = transactionHash as Hex | null | undefined
      // Normal path is a direct receipt lookup. Only missing-response recovery scans logs.
      if (!hash) {
        const logs = await rpc.getLogs({ address: rail.token, event: usedEvent, args: { authorizer: signed.payer, nonce: signed.nonce }, fromBlock: BigInt(signed.fromBlock), toBlock: 'latest' })
        hash = logs[0]?.transactionHash
      }
      if (!hash) {
        const finalized = await rpc.getBlock({ blockTag: 'finalized' })
        const deadline = BigInt((signed.payload.payload as { authorization: { validBefore: string } }).authorization.validBefore)
        if (finalized.timestamp > deadline && !await rpc.readContract({ address: rail.token, abi: parseAbi(['function authorizationState(address authorizer, bytes32 nonce) view returns (bool)']), functionName: 'authorizationState', args: [signed.payer, signed.nonce], blockNumber: finalized.number })) return { expiredUnused: true }
        return null
      }
      let receipt
      try { receipt = await rpc.getTransactionReceipt({ hash }) }
      catch (error) {
        if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') return null
        throw error
      }
      // An unrelated successful transfer must not satisfy this operation.
      const authorized = parseEventLogs({ abi: [usedEvent], logs: receipt.logs }).some(log => log.address.toLowerCase() === rail.token && log.args.authorizer.toLowerCase() === signed.payer.toLowerCase() && log.args.nonce === signed.nonce)
      const transferred = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: 'Transfer' }).some(log => log.address.toLowerCase() === rail.token && log.args.from.toLowerCase() === signed.payer.toLowerCase() && log.args.to.toLowerCase() === input.to.toLowerCase() && log.args.value === BigInt(input.payment!.requirements.amount))
      if (receipt.status !== 'success' || !authorized || !transferred) throw new Error('Payment settlement differs from authorization')
      return { transactionHash: receipt.transactionHash, chainId: network, blockNumber: receipt.blockNumber.toString(), feeAtomic: '0', success: true, feePayment: { asset: 'native', amountAtomic: '0', decimals: 18 } }
    },
  }
}
