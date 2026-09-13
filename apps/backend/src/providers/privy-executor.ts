import { createWalletClient, http, encodeFunctionData, erc20Abi, getAddress, keccak256, parseTransaction, parseEventLogs, recoverTransactionAddress, toHex, type Address, type Hex, type TransactionSerialized } from 'viem'
import { identityCall, identityReceipt, validateIdentityChain } from '../plugins/ens/execution'
import { PrivyClient } from '@privy-io/node'
import { createPrivyX402, validateX402 } from '../modules/x402'
import { createPrivyMpp, validateMpp } from '../modules/mpp'
import { createPrivySvm, validateSvm } from '../modules/x402-solana'
import type { WalletRpcParams } from '@privy-io/node/resources'
import type { AuthorizationRequest, OperationInput } from '@agentis-hq/core/operations'
import { evmClient } from '../modules/networks'
import { fail } from '../errors'
import type { WalletRow } from '../db/schema'
import type { Executor } from './types'
import { prepareTempoTransfer, verifyTempoTransfer, roundedTempoFee, tempoFeeScale, tempoFeeToken } from '../modules/tempo'
import { TxEnvelopeTempo } from 'ox/tempo'
import { prepareSolanaTransfer, verifySolanaTransfer, broadcastSolanaTransfer, solanaReceipt, solanaDevnet, solanaUsdc } from '../modules/solana'

import { uniswapCall, validateSwapPool, uniswap, poolSwapAbi } from '../modules/uniswap'

export function transferCall(input: OperationInput) {
  if (input.identity) return identityCall(input)
  if (input.swap) return uniswapCall(input, input.to)
  return input.asset === 'native'
    ? { to: getAddress(input.to), value: BigInt(input.amountAtomic), data: '0x' as Hex }
    : { to: getAddress(input.asset.slice(6)), value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [getAddress(input.to), BigInt(input.amountAtomic)] }) }
}

export function createPrivyExecutor(appId: string, appSecret: string, inspectWallet: (id: string, ownerId: string) => Promise<{ address: string; serverAuthorized?: boolean }>, authorizationKey: string): Executor {
  const privy = new PrivyClient({ appId, appSecret, timeout: 20_000, maxRetries: 0 })
  const x402 = createPrivyX402(privy, authorizationKey, inspectWallet)
  const mpp = createPrivyMpp(privy, authorizationKey, inspectWallet)
  const svm = createPrivySvm(privy, authorizationKey, inspectWallet)
  async function check(wallet: WalletRow, input: OperationInput) {
    const owned = await inspectWallet(wallet.providerWalletId, wallet.ownerId)
    if (!owned.serverAuthorized) fail(409, 'wallet_setup_required', 'Open this agent’s rules and save once to enable hosted execution')
    if (input.chainId === solanaDevnet ? owned.address !== wallet.address : owned.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Provider wallet address changed')
    if (input.chainId === solanaDevnet) return null
    const client = evmClient(input.chainId)
    if (await client.getChainId() !== client.chain.id) throw new Error('RPC network mismatch')
    return client
  }
  const executor: Executor & { buildRequest(wallet: WalletRow, input: OperationInput, id: string, expiresAt: Date): Promise<AuthorizationRequest> } = {
    id: 'privy',
    validate(wallet, input) {
      if (input.identity) { if (wallet.chainId !== 'eip155:11155111') fail(400, 'unsupported_network', 'Identity writes require Ethereum Sepolia'); identityCall(input); return }
      if (input.swap) { if (wallet.chainId !== uniswap.chainId) fail(400, 'unsupported_network', 'Uniswap currently requires Base Sepolia'); uniswapCall(input, wallet.address); return }
      if (input.action === 'paid_fetch') { if (input.mpp) validateMpp(wallet, input); else if (input.chainId === solanaDevnet) validateSvm(wallet, input); else validateX402(wallet, input); return }
      if (input.chainId === solanaDevnet && wallet.chainId === solanaDevnet) {
        if (!['native', `spl:${solanaUsdc}`].includes(input.asset) || BigInt(input.amountAtomic) > 18_446_744_073_709_551_615n) fail(400, 'unsupported_asset', 'Unsupported Solana transfer')
        return
      }
      if (wallet.chainId !== input.chainId || !['eip155:84532', 'eip155:5042002', 'eip155:42431', 'eip155:11155111'].includes(input.chainId)) fail(503, 'unsupported_execution', 'Hosted transfer network is not enabled')
      if (input.chainId === 'eip155:42431' && input.asset === 'native') fail(400, 'unsupported_asset', 'Tempo payments use TIP-20 tokens, not a native coin')
      const token = input.chainId === 'eip155:84532' ? 'erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e' : input.chainId === 'eip155:42431' ? 'erc20:0x20c0000000000000000000000000000000000001' : input.chainId === 'eip155:11155111' ? 'erc20:0x1c7d4b196cb0c7b01d743fbc6116a902379c7238' : null
      if (input.asset !== 'native' && input.asset.toLowerCase() !== token) fail(400, 'unsupported_asset', 'Transfer asset has not been enabled for this network')
    },
    async buildRequest(wallet: WalletRow, input: OperationInput, id: string, expiresAt: Date): Promise<AuthorizationRequest> {
      this.validate(wallet, input)
      const client = await check(wallet, input)
      if (!client) return { version: 1, method: 'POST', url: `https://api.privy.io/v1/wallets/${encodeURIComponent(wallet.providerWalletId)}/rpc`, headers: { 'privy-app-id': appId, 'privy-idempotency-key': id, 'privy-request-expiry': String(expiresAt.getTime()) }, body: await prepareSolanaTransfer(wallet.address, input) }
      if (input.identity) await validateIdentityChain(input, wallet.address as Address)
      if (input.swap) await validateSwapPool(input)
      const call = transferCall(input)
      const code = await client.getCode({ address: call.to })
      if (!input.swap && !input.identity && input.asset === 'native' && code && code !== '0x') throw new Error('Native transfer recipient must not be a contract')
      if ((input.swap || input.identity || input.asset !== 'native') && (!code || code === '0x')) throw new Error('Token contract not found')
      const signer = createWalletClient({ chain: client.chain, transport: http(client.transport.url, { retryCount: 0, timeout: 15_000 }) })
      let transaction: Record<string, unknown>
      if (input.chainId === 'eip155:42431') {
        transaction = await prepareTempoTransfer(wallet.address as Address, call, expiresAt, client.transport.url)
        if (roundedTempoFee(BigInt(String(transaction.gas_limit)) * BigInt(String(transaction.max_fee_per_gas))) > BigInt(input.maxFeeAtomic)) fail(409, 'fee_cap_exceeded', 'Estimated Tempo fee exceeds the requested cap')
      } else {
        const tx = await signer.prepareTransactionRequest({ account: wallet.address as Address, ...call, type: 'eip1559' })
        if (tx.gas * tx.maxFeePerGas > BigInt(input.maxFeeAtomic)) fail(409, 'fee_cap_exceeded', 'Estimated network fee exceeds the requested cap')
        transaction = { type: 2, chain_id: client.chain.id, to: call.to, value: toHex(call.value), data: call.data, nonce: tx.nonce, gas_limit: toHex(tx.gas), max_fee_per_gas: toHex(tx.maxFeePerGas), max_priority_fee_per_gas: toHex(tx.maxPriorityFeePerGas) }
      }
      return {
        version: 1, method: 'POST', url: `https://api.privy.io/v1/wallets/${encodeURIComponent(wallet.providerWalletId)}/rpc`,
        headers: { 'privy-app-id': appId, 'privy-idempotency-key': id, 'privy-request-expiry': String(expiresAt.getTime()) },
        body: { method: 'eth_signTransaction', params: { transaction } },
      }
    },
    async prepare(wallet, input, _authorization, execution) {
      if (!execution || execution.expiresAt.getTime() <= Date.now()) throw new Error('Valid operation context required')
      if (input.action === 'paid_fetch') return input.mpp ? mpp.prepare(wallet, input, execution) : input.chainId === solanaDevnet ? svm.prepare(wallet, input, execution) : x402.prepare(wallet, input, execution)
      const request = await executor.buildRequest(wallet, input, execution.id, execution.expiresAt)
      if (request.url !== `https://api.privy.io/v1/wallets/${encodeURIComponent(wallet.providerWalletId)}/rpc` || request.headers['privy-app-id'] !== appId || Number(request.headers['privy-request-expiry']) <= Date.now()) throw new Error('Invalid or expired authorization request')
      if (!['eth_signTransaction', 'signTransaction'].includes(String(request.body.method))) throw new Error('Only transaction signing is permitted')
      const result = await privy.wallets().rpc(wallet.providerWalletId, {
        ...request.body as unknown as WalletRpcParams,
        authorization_context: { authorization_private_keys: [authorizationKey] },
        idempotency_key: request.headers['privy-idempotency-key'],
        request_expiry: Number(request.headers['privy-request-expiry']),
      }) as { data?: { signed_transaction?: string } }
      if (!result.data?.signed_transaction) throw new Error('Missing signed transaction')
      if (input.chainId === solanaDevnet) return verifySolanaTransfer(wallet.address, input, result.data.signed_transaction, (request.body.params as { transaction: string }).transaction)
      if (!result.data.signed_transaction.startsWith('0x')) throw new Error('Expected signed EVM transaction')
      if (input.chainId === 'eip155:42431') {
        const transaction = (request.body.params as { transaction: Awaited<ReturnType<typeof prepareTempoTransfer>> }).transaction
        const signedTransaction = result.data.signed_transaction as Hex
        const expected = transferCall(input)
        if (transaction.calls.length !== 1 || transaction.calls[0]!.to.toLowerCase() !== expected.to.toLowerCase() || transaction.calls[0]!.data.toLowerCase() !== expected.data.toLowerCase() || BigInt(transaction.calls[0]!.value) !== expected.value || roundedTempoFee(BigInt(transaction.gas_limit) * BigInt(transaction.max_fee_per_gas)) > BigInt(input.maxFeeAtomic)) throw new Error('Tempo request differs from operation')
        return { signedTransaction, transactionHash: verifyTempoTransfer(signedTransaction, wallet.address as Address, transaction) }
      }
      const signedTransaction = result.data.signed_transaction as TransactionSerialized
      const actual = parseTransaction(signedTransaction)
      const expected = transferCall(input)
      const transaction = (request.body.params as { transaction: Record<string, string | number> }).transaction
      if (actual.chainId !== Number(input.chainId.split(':')[1]) || actual.to?.toLowerCase() !== expected.to.toLowerCase() || (actual.value ?? 0n) !== expected.value || (actual.data ?? '0x').toLowerCase() !== expected.data.toLowerCase() || actual.nonce !== Number(transaction.nonce) || actual.gas !== BigInt(transaction.gas_limit!) || actual.maxFeePerGas !== BigInt(transaction.max_fee_per_gas!) || actual.maxPriorityFeePerGas !== BigInt(transaction.max_priority_fee_per_gas!) || actual.gas! * actual.maxFeePerGas! > BigInt(input.maxFeeAtomic) || (await recoverTransactionAddress({ serializedTransaction: signedTransaction })).toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Signed transaction does not match approved terms')
      return { signedTransaction, transactionHash: keccak256(signedTransaction) }
    },
    async broadcast(serialized, savePaymentHash) {
      if (serialized.startsWith('x402:')) return x402.broadcast(serialized, savePaymentHash)
      if (serialized.startsWith('svm-x402:')) return svm.broadcast(serialized, savePaymentHash)
      if (serialized.startsWith('mpp:')) return mpp.broadcast(serialized)
      if (serialized.startsWith('solana:')) return broadcastSolanaTransfer(serialized.slice(7))
      const signedTransaction = serialized as TransactionSerialized
      const tx = serialized.startsWith('0x76') ? TxEnvelopeTempo.deserialize(serialized as `0x76${string}`) : parseTransaction(signedTransaction)
      if (![84532, 5042002, 42431, 11155111].includes(tx.chainId!)) throw new Error('Broadcast network not permitted')
      const client = evmClient(`eip155:${tx.chainId}`)
      if (await client.getChainId() !== tx.chainId) throw new Error('RPC network mismatch')
      await client.sendRawTransaction({ serializedTransaction: signedTransaction })
    },
    async receipt(transactionHash, input, signedTransaction) {
      if (!input) throw new Error('Network context required')
      if (input.action === 'paid_fetch' && !input.mpp) {
        if (!signedTransaction) throw new Error('Persisted payment required')
        return input.chainId === solanaDevnet ? svm.receipt(signedTransaction, input, transactionHash) : x402.receipt(signedTransaction, input, transactionHash)
      }
      if (!transactionHash) throw new Error('Transaction hash required')
      if (input.chainId === solanaDevnet) return solanaReceipt(transactionHash, input)
      const client = evmClient(input.chainId)
      if (await client.getChainId() !== client.chain.id) throw new Error('RPC network mismatch')
      try {
        const receipt = await client.getTransactionReceipt({ hash: transactionHash as Hex })
        const tempo = input.chainId === 'eip155:42431'
        const fee = tempo ? roundedTempoFee(receipt.gasUsed * receipt.effectiveGasPrice) : receipt.gasUsed * receipt.effectiveGasPrice + BigInt((receipt as unknown as { l1Fee?: bigint }).l1Fee ?? 0n)
        if (input.identity) return { transactionHash: receipt.transactionHash, chainId: input.chainId, blockNumber: receipt.blockNumber.toString(), feeAtomic: fee.toString(), success: receipt.status === 'success', identity: identityReceipt(input, receipt) }
        const transfers = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: 'Transfer' })
        if (tempo && (receipt as unknown as { feeToken?: string }).feeToken?.toLowerCase() !== tempoFeeToken) throw new Error('Unexpected Tempo fee token')
        if (input.swap) {
          if (input.action === 'uniswap_approval') {
            const approvals = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: 'Approval' })
            const approved = approvals.some(log => log.address.toLowerCase() === uniswap.USDC && log.args.owner.toLowerCase() === receipt.from.toLowerCase() && log.args.spender.toLowerCase() === uniswap.router.toLowerCase() && log.args.value === BigInt(input.amountAtomic))
            if (receipt.status === 'success' && !approved) throw Error('Successful approval missing expected event; reconcile manually')
            return { transactionHash: receipt.transactionHash, chainId: input.chainId, blockNumber: receipt.blockNumber.toString(), feeAtomic: fee.toString(), success: receipt.status === 'success' }
          }
          const swaps = parseEventLogs({ abi: poolSwapAbi, logs: receipt.logs, eventName: 'Swap' }).filter(log => log.address.toLowerCase() === input.swap!.pool.toLowerCase() && log.args.sender.toLowerCase() === uniswap.router.toLowerCase())
          let settled: { inputAtomic: string; outputAtomic: string; tokenOut: 'ETH' | 'USDC' } | undefined
          if (receipt.status === 'success') {
            if (swaps.length !== 1) throw Error('Missing or ambiguous swap receipt; reservation retained')
            const event = swaps[0]!.args
            const tokenIn = input.asset === 'native' ? uniswap.ETH : uniswap.USDC
            const inputFirst = tokenIn.toLowerCase() < uniswap[input.swap.tokenOut].toLowerCase()
            const spent = inputFirst ? event.amount0 : event.amount1, received = -(inputFirst ? event.amount1 : event.amount0)
            if (spent <= 0n || spent > BigInt(input.amountAtomic) || received < BigInt(input.swap.minimumOutputAtomic)) throw Error('Swap settlement outside approved bounds')
            const expectedRecipient = input.swap.tokenOut === 'ETH' ? uniswap.router : input.to
            if (swaps[0]!.args.recipient.toLowerCase() !== expectedRecipient.toLowerCase()) throw Error('Unexpected swap recipient')
            settled = { inputAtomic: spent.toString(), outputAtomic: received.toString(), tokenOut: input.swap.tokenOut }
          }
          return { transactionHash: receipt.transactionHash, chainId: input.chainId, blockNumber: receipt.blockNumber.toString(), feeAtomic: fee.toString(), success: receipt.status === 'success', swap: settled }
        }
        const transferred = input.asset === 'native' || transfers.some(log => log.address.toLowerCase() === input.asset.slice(6).toLowerCase() && log.args.from.toLowerCase() === receipt.from.toLowerCase() && log.args.to.toLowerCase() === input.to.toLowerCase() && log.args.value === BigInt(input.amountAtomic))
        return { transactionHash: receipt.transactionHash, chainId: input.chainId, blockNumber: receipt.blockNumber.toString(), feeAtomic: fee.toString(), success: receipt.status === 'success' && transferred, feePayment: { asset: tempo ? `erc20:${tempoFeeToken}` : 'native', amountAtomic: (tempo ? fee / tempoFeeScale : fee).toString(), decimals: tempo ? 6 : 18 } }
      } catch (error) {
        if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') return null
        throw error
      }
    },
  }
  return executor
}
