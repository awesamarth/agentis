import { createPublicClient, createWalletClient, http, keccak256, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { fail } from '../errors'
import type { Executor } from './types'

export function createAnvilExecutor(rpcUrl: string, privateKey: Hex): Executor {
  const url = new URL(rpcUrl)
  if (process.env.NODE_ENV === 'production' || url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Anvil executor requires non-production loopback HTTP RPC')
  }
  const account = privateKeyToAccount(privateKey)
  const transport = http(rpcUrl, { retryCount: 0, timeout: 10_000 })
  const publicClient = createPublicClient({ chain: foundry, transport })
  const signer = createWalletClient({ account, chain: foundry, transport })
  async function checkChain() {
    if (await publicClient.getChainId() !== 31337) throw new Error('Local executor refuses non-Anvil chain ID')
  }
  return {
    id: 'anvil',
    validate(wallet, input) {
      if (input.chainId !== 'eip155:31337' || wallet.chainId !== input.chainId || input.asset !== 'native' || wallet.address.toLowerCase() !== account.address.toLowerCase()) {
        fail(503, 'unsupported_execution', 'Only the configured local Anvil wallet/native transfer is executable')
      }
    },
    async prepare(wallet, input) {
      this.validate(wallet, input)
      await checkChain()
      const to = input.to as Hex
      const code = await publicClient.getCode({ address: to })
      if (code && code !== '0x') throw new Error('Local native-transfer executor refuses contract recipients')
      const request = await signer.prepareTransactionRequest({ to, value: BigInt(input.amountAtomic) })
      const feePerGas = request.maxFeePerGas ?? request.gasPrice
      if (feePerGas === undefined || request.gas * feePerGas > BigInt(input.maxFeeAtomic)) {
        throw new Error('Estimated maximum network fee exceeds approved cap')
      }
      const signedTransaction = await signer.signTransaction(request)
      return { signedTransaction, transactionHash: keccak256(signedTransaction) }
    },
    async broadcast(signedTransaction) {
      await checkChain()
      await publicClient.sendRawTransaction({ serializedTransaction: signedTransaction as Hex })
    },
    async receipt(transactionHash) {
      await checkChain()
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash as Hex })
        return {
          transactionHash: receipt.transactionHash,
          chainId: 'eip155:31337',
          blockNumber: receipt.blockNumber.toString(),
          feeAtomic: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
          success: receipt.status === 'success',
        }
      } catch (error) {
        // RPC outages propagate; only "not found" is a pending observation.
        if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') return null
        throw error
      }
    },
  }
}
