import { PrivyClient } from '@privy-io/node'
import { getUserRegistrationFunction } from '@umbra-privacy/sdk/registration'
import { getMintEncryptionKeyRotatorFunction } from '@umbra-privacy/sdk/account'
import { address as toAddress } from '@solana/kit'
import { createUmbraClient } from './umbra-signer'
import { getNodeRegistrationProver } from './node-prover'

export type UmbraRegistrationOptions = {
  confidential?: boolean
  anonymous?: boolean
}

export async function registerPrivyWalletWithUmbra(
  privyNode: PrivyClient,
  walletId: string,
  walletAddress: string,
  options: UmbraRegistrationOptions = {},
) {
  const confidential = options.confidential ?? true
  const anonymous = options.anonymous ?? true

  console.log('[umbra/register] start', {
    walletAddress,
    confidential,
    anonymous,
  })

  const client = await createUmbraClient(privyNode, walletId, walletAddress)
  const deps = anonymous ? ({ zkProver: getNodeRegistrationProver() } as any) : undefined
  const register = getUserRegistrationFunction({ client }, deps)

  const signatures = await register({
    confidential,
    anonymous,
    hooks: {
      initUserAccount: {
        onPreSend: async () => {
          console.log('[umbra/register] userAccountInitialisation pre')
        },
        onPostSend: async ({ signature }) => {
          console.log('[umbra/register] userAccountInitialisation post', signature)
        },
      },
      registerX25519PublicKey: {
        onPreSend: async () => {
          console.log('[umbra/register] registerX25519PublicKey pre')
        },
        onPostSend: async ({ signature }) => {
          console.log('[umbra/register] registerX25519PublicKey post', signature)
        },
      },
      registerAnonymousUsage: {
        onPreSend: async () => {
          console.log('[umbra/register] registerUserForAnonymousUsage pre')
        },
        onPostSend: async ({ signature }) => {
          console.log('[umbra/register] registerUserForAnonymousUsage post', signature)
        },
      },
    },
  })

  console.log('[umbra/register] done', { signatures })

  return {
    walletAddress,
    confidential,
    anonymous,
    signatures,
  }
}

export async function repairPrivyWalletUmbraMintKey(
  privyNode: PrivyClient,
  walletId: string,
  walletAddress: string,
  mint: string,
) {
  console.log('[umbra/repair-mint-key] start', { walletAddress, mint })

  const client = await createUmbraClient(privyNode, walletId, walletAddress)
  const rotateMintKey = getMintEncryptionKeyRotatorFunction({ client })
  const signature = await rotateMintKey(
    toAddress(mint),
    undefined,
    undefined,
    undefined,
    { skipKeyConsistencyCheck: true }
  )

  console.log('[umbra/repair-mint-key] done', { walletAddress, mint, signature })

  return {
    walletAddress,
    mint,
    signature,
    repaired: Boolean(signature),
  }
}
