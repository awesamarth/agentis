import { privy } from './privy'
import { getAccountByKey, getOAuthGrantByAccessToken } from './db'

export type AccountIdentity = {
  userId: string
  authType: 'account-key' | 'oauth' | 'privy'
  scopes: string[]
  grantId?: string
}

export async function authenticateAccountBearer(token: string): Promise<AccountIdentity | null> {
  if (token.startsWith('agt_user_')) {
    const account = await getAccountByKey(token)
    return account
      ? { userId: account.userId, authType: 'account-key', scopes: ['*'] }
      : null
  }

  if (token.startsWith('agt_oauth_')) {
    const grant = await getOAuthGrantByAccessToken(token)
    return grant
      ? {
          userId: grant.userId,
          authType: 'oauth',
          scopes: grant.scope,
          grantId: grant.id,
        }
      : null
  }

  try {
    const { userId } = await privy.verifyAuthToken(token)
    return { userId, authType: 'privy', scopes: ['*'] }
  } catch {
    return null
  }
}

export function hasAccountScope(identity: AccountIdentity, required: string): boolean {
  return identity.scopes.includes('*') || identity.scopes.includes(required)
}
