import { z } from 'zod'

export const discoveryServiceId = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/)
export const discoverySearchInput = z.object({ query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(25).optional() }).strict()
export type DiscoverySearchInput = z.infer<typeof discoverySearchInput>

// Catalog compatibility is advisory, never a live challenge or spending authority.
export type DiscoveryCompatibility = { status: 'candidate' | 'unsupported' | 'unknown'; reason: string }
export type DiscoveryPaymentOffer = {
  protocol: string; method: string; intent: string; network?: string; currency?: string
  amountAtomic?: string | null; amountHint?: string; decimals?: number; dynamic?: boolean; scheme?: string
  description?: string; unitType?: string; recipient?: string
  asset?: string; symbol?: string; networkName?: string
  compatibility: DiscoveryCompatibility
}
export type DiscoveryEndpoint = {
  serviceId: string; serviceName: string; serviceUrl: string | null; integration: string | null
  url: string | null; method: string; path: string; description: string; requestFormat?: string
  rank?: number; score?: number; requiredArguments?: string[]
  inputSchema?: Record<string, unknown>; inputExample?: Record<string, unknown>
  completion?: Record<string, unknown>
  estimatedPrice?: { amountDecimal?: string; amountHint?: string; currency?: string; dynamic?: boolean }
  paymentOffers: DiscoveryPaymentOffer[]; compatibility: DiscoveryCompatibility
}
export type DiscoveryService = {
  id: string; name: string; description: string; serviceUrl: string; integration: string
  isFirstParty: boolean; provider: { name: string; url: string }; docs: Record<string, string>
  endpoints: DiscoveryEndpoint[]
}
export type DiscoverySearchResult = {
  source: 'mercator'; advisory: true; resolution: 'static'; retrievedAt: string
  endpoints: DiscoveryEndpoint[]; partial: boolean
}
export type DiscoveryDescription = {
  source: 'mercator'; advisory: true; retrievedAt: string; service: DiscoveryService
}
