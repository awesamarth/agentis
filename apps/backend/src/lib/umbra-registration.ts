import { PrivyClient } from '@privy-io/node'
import { getUserRegistrationFunction } from '@umbra-privacy/sdk'
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
    callbacks: {
      userAccountInitialisation: {
        pre: async () => {
          console.log('[umbra/register] userAccountInitialisation pre')
        },
        post: async (_tx: any, signature: string) => {
          console.log('[umbra/register] userAccountInitialisation post', signature)
        },
      },
      registerX25519PublicKey: {
        pre: async () => {
          console.log('[umbra/register] registerX25519PublicKey pre')
        },
        post: async (_tx: any, signature: string) => {
          console.log('[umbra/register] registerX25519PublicKey post', signature)
        },
      },
      registerUserForAnonymousUsage: {
        pre: async () => {
          console.log('[umbra/register] registerUserForAnonymousUsage pre')
        },
        post: async (_tx: any, signature: string) => {
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
