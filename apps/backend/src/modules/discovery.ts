import { Hono } from 'hono'
import { isIP } from 'node:net'
import { z } from 'zod'
import { discoverySearchInput, discoveryServiceId, type DiscoveryCompatibility, type DiscoveryDescription, type DiscoveryEndpoint, type DiscoveryPaymentOffer, type DiscoverySearchInput, type DiscoverySearchResult } from '@agentis-hq/core/discovery'
import { findNetwork } from '@agentis-hq/core/networks'
import { httpMethod } from '@agentis-hq/core/operations'
import { paymentHttp, publicAddress } from './payment-http'
import { ApiError } from '../errors'

// Only these public catalog GETs are called. No incoming auth headers, wallet
// identifiers, provider URLs, quotes, jobs or payment credentials are forwarded.
const origin = 'https://mercator.sh'
const object = z.record(z.string(), z.unknown())
const offerSchema = z.object({
  protocol: z.string(), method: z.string(), intent: z.string(), network: z.string().optional(), currency: z.string().optional(),
  amount: z.string().regex(/^\d+$/).max(78).nullable().optional(), amountHint: z.string().optional(),
  decimals: z.number().int().nonnegative().optional(), dynamic: z.boolean().optional(), scheme: z.string().optional(),
  description: z.string().optional(), unitType: z.string().optional(), recipient: z.string().optional(),
})
const endpointSchema = z.object({
  method: z.string(), path: z.string(), description: z.string(), requestFormat: z.string().optional(),
  inputSchema: object.optional(), inputExample: object.optional(), completion: object.optional(),
  paymentOffers: z.array(offerSchema).default([]),
})
const serviceSchema = z.object({
  id: discoveryServiceId, name: z.string(), description: z.string(), serviceUrl: z.string(),
  integration: z.string(), isFirstParty: z.boolean(), provider: z.object({ name: z.string(), url: z.string() }),
  docs: z.record(z.string(), z.string()), endpoints: z.array(endpointSchema),
})
const searchSchema = z.object({
  resolution: z.literal('static'), endpoints: z.array(endpointSchema.omit({ paymentOffers: true }).extend({
    serviceId: discoveryServiceId, serviceName: z.string(), rank: z.number().int().positive(), score: z.number(),
    requiredArguments: z.array(z.string()).optional(),
    estimatedPrice: z.object({ amount: z.string().optional(), amountHint: z.string().optional(), currency: z.string().optional(), dynamic: z.boolean().optional() }).optional(),
  })).max(25),
})
type CatalogService = z.infer<typeof serviceSchema>
type CatalogEndpoint = z.infer<typeof endpointSchema>
const compatibility = (status: DiscoveryCompatibility['status'], reason: string): DiscoveryCompatibility => ({ status, reason })

export function catalogOffer(offer: z.infer<typeof offerSchema>): DiscoveryPaymentOffer {
  const { amount, ...terms } = offer
  const result: DiscoveryPaymentOffer = { ...terms, ...(amount === undefined ? {} : { amountAtomic: amount }), compatibility: compatibility('unknown', 'Catalog payment metadata is incomplete; inspect the provider challenge.') }
  const unsupported = (reason: string) => ({ ...result, compatibility: compatibility('unsupported', reason) })
  if (!['mpp', 'x402'].includes(offer.protocol)) return unsupported('Payment protocol is not implemented.')
  if (offer.intent !== 'charge') return unsupported('Only one-shot charges are implemented.')
  if (offer.protocol === 'mpp' && offer.method !== 'tempo') return unsupported('This MPP method is not implemented.')
  if (offer.protocol === 'x402' && offer.scheme !== 'exact') return offer.scheme ? unsupported('Only x402 exact payments are implemented.') : result
  if (!offer.network || !offer.currency) return result
  const network = findNetwork(offer.network)
  if (!network || network.enabled === false) return unsupported('Network is not enabled in Agentis.')
  const sameToken = (a: string, b: string) => network.family === 'solana' ? a === b : a.toLowerCase() === b.toLowerCase()
  let asset: (typeof network.assets)[number] | undefined
  if (offer.protocol === 'mpp') {
    if (!network.mpp) return unsupported('MPP is not implemented on this network.')
    asset = network.assets.find(asset => sameToken(asset.id, offer.currency!) || sameToken(asset.id, `erc20:${offer.currency}`))
  } else {
    if (!network.x402) return unsupported('x402 is not implemented on this network.')
    if (sameToken(offer.currency, network.x402.token) || (network.x402.asset !== 'native' && sameToken(offer.currency, network.x402.asset))) asset = network.assets.find(asset => asset.id === network.x402!.asset)
  }
  if (!asset) return unsupported('Payment token is not supported on this network.')
  // All currently implemented x402 tokens are six-decimal USDC, including
  // Arc's token representation (distinct from its 18-decimal native units).
  if (offer.decimals !== undefined && offer.decimals !== (offer.protocol === 'x402' ? 6 : asset.decimals)) return unsupported('Catalog token decimals do not match Agentis.')
  return { ...result, asset: asset.id, symbol: asset.symbol, networkName: network.name, compatibility: compatibility('candidate', 'Catalog rail/network/token match. Live challenge, execution readiness, mode, fees, wallet consent and policy still require validation.') }
}

function endpointUrl(serviceUrl: string, path: string): string | null {
  try {
    const base = new URL(serviceUrl)
    const hostname = base.hostname.replace(/^\[|\]$/g, '')
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || (isIP(hostname) && !publicAddress(hostname))) return null
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || (base.port && base.port !== '443') || !/^\/(?!\/)[^?#\\]*$/.test(path)) return null
    // serviceUrl may contain a gateway prefix, e.g. /serper. An absolute-path
    // new URL(path, base) would incorrectly discard it.
    const prefix = base.pathname.replace(/\/$/, '') + '/'
    const url = new URL(base.href.replace(/\/$/, '') + path)
    return url.origin === base.origin && url.pathname.startsWith(prefix) ? url.href : null
  } catch { return null }
}
function endpoint(service: CatalogService | undefined, item: CatalogEndpoint, id: string, name: string): DiscoveryEndpoint {
  const paymentOffers = item.paymentOffers.map(catalogOffer)
  const url = service ? endpointUrl(service.serviceUrl, item.path) : null
  let match = paymentOffers.find(offer => offer.compatibility.status === 'candidate')?.compatibility
    ?? (paymentOffers.length && paymentOffers.every(offer => offer.compatibility.status === 'unsupported') ? compatibility('unsupported', 'No catalog offer matches the implemented payment rails.') : compatibility('unknown', 'Payment metadata is missing or incomplete; inspect the provider challenge.'))
  if (!httpMethod.safeParse(item.method).success) match = compatibility('unsupported', 'HTTP method is not implemented.')
  if (!url) match = compatibility('unknown', 'A usable provider URL could not be established from the catalog.')
  return { serviceId: id, serviceName: name, serviceUrl: service?.serviceUrl ?? null, integration: service?.integration ?? null, url, method: item.method, path: item.path, description: item.description, requestFormat: item.requestFormat, inputSchema: item.inputSchema, inputExample: item.inputExample, completion: item.completion, paymentOffers, compatibility: match }
}
const unavailable = () => new ApiError(503, 'discovery_unavailable', 'Discovery catalog is unavailable. Try again later; no payment was requested.')

export function createDiscovery(read: typeof paymentHttp = paymentHttp) {
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    try {
      const response = await read({ url: origin + path, method: 'GET', headers: { accept: 'application/json' } })
      if (response.status === 404) throw new ApiError(404, 'discovery_not_found', 'Service is not in the current discovery catalog.')
      if (response.status !== 200) throw unavailable()
      return schema.parse(JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8')))
    } catch (error) { if (error instanceof ApiError) throw error; throw unavailable() }
  }
  const service = (id: string) => get(`/v1/services/${encodeURIComponent(discoveryServiceId.parse(id))}`, z.object({ service: serviceSchema })).then(result => {
    if (result.service.id !== id) throw unavailable()
    return result.service
  })
  return {
    async describe(id: string): Promise<DiscoveryDescription> {
      const item = await service(id)
      return { source: 'mercator', advisory: true, retrievedAt: new Date().toISOString(), service: { ...item, endpoints: item.endpoints.map(entry => endpoint(item, entry, item.id, item.name)) } }
    },
    async search(input: DiscoverySearchInput): Promise<DiscoverySearchResult> {
      const { query, limit = 8 } = discoverySearchInput.parse(input)
      const data = await get(`/v1/services/search?${new URLSearchParams({ query, limit: String(limit), resolution: 'static' })}`, searchSchema)
      const items = data.endpoints.slice(0, limit)
      // Search omits service URLs/payment offers. Describe each distinct service
      // once, four at a time; a failed enrichment remains visible as unknown.
      const ids = [...new Set(items.map(item => item.serviceId))]
      const services = new Map<string, CatalogService>()
      const deadline = Date.now() + 45_000
      for (let i = 0; i < ids.length && Date.now() < deadline; i += 4) await Promise.all(ids.slice(i, i + 4).map(async id => {
        try { services.set(id, await service(id)) } catch { /* Partial catalog results, never an invented payment offer. */ }
      }))
      let partial = services.size !== ids.length
      const endpoints = items.map(item => {
        const found = services.get(item.serviceId)
        const detail = found?.endpoints.find(entry => entry.method === item.method && entry.path === item.path)
        if (!detail) partial = true
        const price = item.estimatedPrice
        return { ...endpoint(found, detail ?? { ...item, paymentOffers: [] }, item.serviceId, item.serviceName), rank: item.rank, score: item.score, requiredArguments: item.requiredArguments,
          estimatedPrice: price ? { amountDecimal: price.amount, amountHint: price.amountHint, currency: price.currency, dynamic: price.dynamic } : undefined }
      })
      return { source: 'mercator', advisory: true, resolution: 'static', retrievedAt: new Date().toISOString(), endpoints, partial }
    },
  }
}

export function discoveryRoutes(discovery = createDiscovery()) {
  const app = new Hono()
  app.get('/search', async c => c.json(await discovery.search(discoverySearchInput.parse({ query: c.req.query('query'), ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }) }))))
  app.get('/services/:serviceId', async c => c.json(await discovery.describe(discoveryServiceId.parse(c.req.param('serviceId')))))
  return app
}
