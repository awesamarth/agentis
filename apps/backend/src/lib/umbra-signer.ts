import { PrivyClient } from '@privy-io/node'
import { createSolanaKitSigner } from '@privy-io/node/solana-kit'
import { address as toAddress } from '@solana/kit'
import { getPollingTransactionForwarder, getUmbraClient } from '@umbra-privacy/sdk'

const DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const DEVNET_RPC_URL = 'https://api.devnet.solana.com'
const DEVNET_RPC_SUBSCRIPTIONS_URL = 'wss://api.devnet.solana.com'
const DEVNET_INDEXER_URL = 'https://utxo-indexer.api-devnet.umbraprivacy.com'

function createPrivyUmbraSigner(
  privyNode: PrivyClient,
  walletId: string,
  walletAddress: string
) {
  const address = toAddress(walletAddress)
  const privySigner = createSolanaKitSigner(privyNode, {
    walletId,
    address,
    caip2: DEVNET_CAIP2,
  })

  return {
    address,

    async signTransaction(transaction: any) {
      console.log('[umbra-signer] signTransaction start')
      const [signedTransaction] = await this.signTransactions([transaction])
      console.log('[umbra-signer] signTransaction done')
      return signedTransaction
    },

    async signTransactions(transactions: readonly any[]) {
      console.log('[umbra-signer] signTransactions start', { count: transactions.length })
      const signatureMaps = await privySigner.signTransactions(transactions as any[])
      console.log('[umbra-signer] signTransactions got signatures', { count: signatureMaps.length })
      return transactions.map((transaction, index) => ({
        ...transaction,
        signatures: {
          ...transaction.signatures,
          ...signatureMaps[index],
        },
      }))
    },

    async signMessage(message: Uint8Array) {
      console.log('[umbra-signer] signMessage start', { bytes: message.length })
      const [signatureMap] = await privySigner.signMessages([{ content: message } as any] as any)
      if (!signatureMap) {
        throw new Error('Privy did not return a message signature payload')
      }

      const signature = signatureMap[address]

      if (!signature) {
        throw new Error('Privy did not return a message signature for the configured wallet')
      }

      console.log('[umbra-signer] signMessage done')

      return {
        message,
        signature,
        signer: address,
      }
    },
  }
}

export async function createUmbraClient(
  privyNode: PrivyClient,
  walletId: string,
  walletAddress: string
) {
  const transactionForwarder = getPollingTransactionForwarder({
    rpcUrl: DEVNET_RPC_URL,
  })

  return getUmbraClient(
    {
      signer: createPrivyUmbraSigner(privyNode, walletId, walletAddress) as any,
      network: 'devnet',
      rpcUrl: DEVNET_RPC_URL,
      rpcSubscriptionsUrl: DEVNET_RPC_SUBSCRIPTIONS_URL,
      indexerApiEndpoint: DEVNET_INDEXER_URL,
    },
    { transactionForwarder }
  )
}
