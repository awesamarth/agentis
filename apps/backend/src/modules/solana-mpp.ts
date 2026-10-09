import type { PrivyClient } from '@privy-io/node'
import { createSolanaKitSigner } from '@privy-io/node/solana-kit'
import { address } from '@solana/kit'
import { prepareSolanaMpp, reconcileSolanaMpp, solanaMppConnection, submitSolanaMpp, validateSolanaMpp, type SolanaMppProof } from '@agentis-hq/core/solana-mpp'
import type { OperationInput } from '@agentis-hq/core/operations'
import type { WalletRow } from '../db/schema'

export function createPrivySolanaMpp(privy: PrivyClient, authorizationKey: string, inspect: (id: string, owner: string) => Promise<{ address: string; serverAuthorized?: boolean }>) {
  return {
    async prepare(wallet: WalletRow, input: OperationInput, execution: { id: string; expiresAt: Date }) {
      if (wallet.chainId !== input.chainId) throw Error('Wallet network differs from Solana MPP approval')
      validateSolanaMpp(input, wallet.address)
      const owned = await inspect(wallet.providerWalletId, wallet.ownerId)
      if (!owned.serverAuthorized || owned.address !== wallet.address) throw Error('Wallet ownership changed')
      const signer = createSolanaKitSigner(privy, { walletId: wallet.providerWalletId, address: address(wallet.address), authorizationContext: { authorization_private_keys: [authorizationKey] } })
      const { rpc, rpcUrl } = solanaMppConnection(input.chainId)
      const proof = await prepareSolanaMpp(input, signer, rpc, rpcUrl, execution.expiresAt.getTime(), execution.id)
      return { signedTransaction: `svm-mpp:${JSON.stringify(proof)}`, transactionHash: proof.hash }
    },
    async broadcast(serialized: string, save?: (hash: string) => Promise<void>) {
      const proof = unpack(serialized)
      return submitSolanaMpp(proof, (process.env.AGENTIS_PAID_FETCH_LOCAL_ORIGINS ?? '').split(',').filter(Boolean), save)
    },
    async receipt(serialized: string, input: OperationInput, hash?: string | null) {
      const proof = unpack(serialized)
      if (JSON.stringify(proof.input) !== JSON.stringify(input)) throw Error('Persisted Solana MPP payment mismatch')
      return reconcileSolanaMpp(proof, solanaMppConnection(input.chainId).rpc, hash)
    },
  }
}
function unpack(serialized: string): SolanaMppProof {
  if (!serialized.startsWith('svm-mpp:')) throw Error('Expected a persisted Solana MPP proof')
  return JSON.parse(serialized.slice(8))
}
