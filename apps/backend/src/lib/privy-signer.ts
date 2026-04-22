/**
 * Wraps a Privy server wallet into a @solana/kit TransactionModifyingSigner.
 */

import {
  address,
  getTransactionCodec,
  getBase64EncodedWireTransaction,
  type TransactionModifyingSigner,
} from '@solana/kit'

type PrivyNodeClient = {
  wallets(): {
    solana(): {
      signTransaction(walletId: string, params: { transaction: string }): Promise<{
        signed_transaction: string
        encoding: string
      }>
    }
  }
}

export function createPrivyTransactionSigner(
  privyNode: PrivyNodeClient,
  walletId: string,
  walletAddress: string
): TransactionModifyingSigner {
  const addr = address(walletAddress)
  const codec = getTransactionCodec()

  return {
    address: addr,

    async modifyAndSignTransactions(transactions: any): Promise<any> {
      const signed = []
      for (const tx of transactions) {
        const txBytes = codec.encode(tx)
        const unsignedBase64 = Buffer.from(txBytes).toString('base64')

        const result = await privyNode.wallets().solana().signTransaction(walletId, {
          transaction: unsignedBase64,
        })

        const signedBytes = Buffer.from(result.signed_transaction, 'base64')
        const signedTx = codec.decode(new Uint8Array(signedBytes))
        signedTx.lifetimeConstraint = tx.lifetimeConstraint

        // Check roundtrip fidelity
        try {
          const reencoded = getBase64EncodedWireTransaction(signedTx)
          const match = reencoded === result.signed_transaction
          console.log('[privy-signer] roundtrip match:', match)
          if (!match) {
            console.log('[privy-signer] privy len:', result.signed_transaction.length, 'ours:', reencoded.length)
          }
        } catch (e: any) {
          console.log('[privy-signer] re-encode failed:', e.message?.slice(0, 100))
        }

        signed.push(signedTx)
      }
      return signed
    },
  }
}
