/** Vault enrollment only. Connecting a card does not authorize any agent or key to spend. */
export type CardSetupStatus = {
  provider: 'agentcard'
  pluginEnabled: boolean
  configured: boolean
  checkoutEnabled: boolean
  purchaseApiEnabled: boolean
  setupUrl: string
}
export type VaultCard = {
  id: string; brand: string; last4: string; expiryMonth: number; expiryYear: number
  providerPermission: 'pending' | 'active' | 'revoked' | 'retired' | 'unavailable'
  providerAutoApproval: boolean
}
export type CardSession = {
  id: string
  status: 'creating' | 'pending' | 'linked' | 'expired' | 'unknown' | 'cancelled'
  expiresAt: string
  pollAfterMs: number
  /** Owner-only, short-lived bearer link. Never log, copy into agent prompts, or append query parameters. */
  enrollmentUrl?: string
}
export type CardVault = {
  provider: 'agentcard'
  configured: boolean
  connected: boolean
  testMode: boolean | null
  cards: VaultCard[]
  session: CardSession | null
  checkoutEnabled: boolean
  purchaseApiEnabled: boolean
}
