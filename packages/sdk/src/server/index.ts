/**
 * @agentis-hq/sdk/server
 *
 * Standards-backed seller-side paywall helpers for Solana MPP and x402.
 */

import { Buffer } from 'node:buffer'
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type FacilitatorClient,
  type HTTPAdapter,
  type HTTPProcessResult,
  type HTTPRequestContext,
  type ProcessSettleResultResponse,
  type RouteConfig,
} from '@x402/core/server'
import type { PaymentRequirements, Price } from '@x402/core/types'
import { ExactSvmScheme } from '@x402/svm/exact/server'
import { Mppx, solana } from '@solana/mpp/server'

const SOLANA_DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'

const SOLANA_DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const SOLANA_MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOLANA_DEVNET_USDT = 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6'
const SOLANA_MAINNET_USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator'

export type PaywallProtocol = 'mpp' | 'x402' | 'both'
export type PaywallNetwork = 'devnet' | 'mainnet' | 'mainnet-beta'
export type PaywallAssetSymbol = 'sol' | 'usdc' | 'usdt'

export type PaywallAsset =
  | PaywallAssetSymbol
  | {
      symbol?: string
      /** "sol" for native SOL in MPP, or an SPL mint address. */
      currency: string
      /** Required for SPL tokens. Native SOL uses 9 decimals. */
      decimals: number
      tokenProgram?: string
    }

export type PaywallConfig = {
  /**
   * Atomic amount in the selected asset. For USDC/USDT with 6 decimals,
   * "1000" means 0.001 token. For SOL, "1000" means 1000 lamports.
   */
  amount?: string | number | bigint
  /** Legacy alias. Interpreted as SOL UI units when amount is omitted. */
  fee?: number
  /** Seller wallet. `receiver` is kept for backwards compatibility. */
  recipient?: string
  receiver?: string
  /** Defaults to USDC for new integrations. */
  asset?: PaywallAsset
  /** Defaults to both when the asset supports both protocols. */
  protocol?: PaywallProtocol
  /** Defaults to Solana devnet. */
  network?: PaywallNetwork
  description?: string
  mimeType?: string
  maxTimeoutSeconds?: number
  /** x402 facilitator URL/client. Defaults to the public test facilitator. */
  facilitatorUrl?: string
  facilitator?: FacilitatorClient
  /** MPP options. Set a stable secret in production. */
  mppSecretKey?: string
  mppRealm?: string
  rpcUrl?: string
}

export type PaywallHandler<Req = Request, Res = Response> = (req: Req) => Promise<Res> | Res

type ResolvedNetwork = {
  input: PaywallNetwork
  mpp: 'devnet' | 'mainnet-beta'
  x402: typeof SOLANA_DEVNET_CAIP2 | typeof SOLANA_MAINNET_CAIP2
}

type ResolvedAsset = {
  symbol: string
  currency: string
  decimals: number
  tokenProgram?: string
  nativeSol: boolean
}

type ResolvedConfig = {
  amount: string
  recipient: string
  asset: ResolvedAsset
  network: ResolvedNetwork
  protocol: Exclude<PaywallProtocol, 'both'>[]
  description: string
  mimeType: string
  maxTimeoutSeconds: number
  facilitator: FacilitatorClient
  mppSecretKey: string
  mppRealm?: string
  rpcUrl?: string
}

type BeforeResult =
  | { type: 'response'; response: Response }
  | { type: 'mpp-paid'; withReceipt: (response: Response) => Response }
  | {
      type: 'x402-paid'
      paymentPayload: Extract<HTTPProcessResult, { type: 'payment-verified' }>['paymentPayload']
      paymentRequirements: PaymentRequirements
      declaredExtensions?: Record<string, unknown>
      context: HTTPRequestContext
    }

function env(name: string): string | undefined {
  return (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[name]
}

function randomSecret(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64')
}

function resolveNetwork(network: PaywallNetwork = 'devnet'): ResolvedNetwork {
  if (network === 'mainnet' || network === 'mainnet-beta') {
    return { input: network, mpp: 'mainnet-beta', x402: SOLANA_MAINNET_CAIP2 }
  }
  return { input: 'devnet', mpp: 'devnet', x402: SOLANA_DEVNET_CAIP2 }
}

function resolveAsset(asset: PaywallAsset | undefined, network: ResolvedNetwork): ResolvedAsset {
  const selected = asset ?? 'usdc'
  if (typeof selected !== 'string') {
    const nativeSol = selected.currency.toLowerCase() === 'sol'
    return {
      symbol: selected.symbol ?? (nativeSol ? 'SOL' : selected.currency),
      currency: nativeSol ? 'sol' : selected.currency,
      decimals: selected.decimals,
      tokenProgram: selected.tokenProgram,
      nativeSol,
    }
  }

  switch (selected.toLowerCase() as PaywallAssetSymbol) {
    case 'sol':
      return { symbol: 'SOL', currency: 'sol', decimals: 9, nativeSol: true }
    case 'usdt':
      return {
        symbol: 'USDT',
        currency: network.mpp === 'devnet' ? SOLANA_DEVNET_USDT : SOLANA_MAINNET_USDT,
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM,
        nativeSol: false,
      }
    case 'usdc':
      return {
        symbol: 'USDC',
        currency: network.mpp === 'devnet' ? SOLANA_DEVNET_USDC : SOLANA_MAINNET_USDC,
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM,
        nativeSol: false,
      }
  }
}

function normalizeAtomicAmount(config: PaywallConfig, asset: ResolvedAsset): string {
  if (config.amount !== undefined) return String(config.amount)
  if (config.fee !== undefined) {
    return String(Math.round(config.fee * 10 ** asset.decimals))
  }
  throw new Error('Paywall amount is required')
}

function resolveProtocols(requested: PaywallProtocol | undefined, asset: ResolvedAsset): Exclude<PaywallProtocol, 'both'>[] {
  const wanted = requested ?? 'both'
  if (wanted === 'mpp') return ['mpp']
  if (wanted === 'x402') {
    if (asset.nativeSol) throw new Error('x402 SVM exact payments require an SPL token asset; use MPP for native SOL')
    return ['x402']
  }
  return asset.nativeSol ? ['mpp'] : ['mpp', 'x402']
}

function resolveConfig(config: PaywallConfig): ResolvedConfig {
  const recipient = config.recipient ?? config.receiver
  if (!recipient) throw new Error('Paywall recipient is required')

  const network = resolveNetwork(config.network)
  const asset = resolveAsset(config.asset ?? (config.fee !== undefined && config.amount === undefined ? 'sol' : undefined), network)
  const amount = normalizeAtomicAmount(config, asset)
  const protocol = resolveProtocols(config.protocol, asset)

  return {
    amount,
    recipient,
    asset,
    network,
    protocol,
    description: config.description ?? 'Paid resource',
    mimeType: config.mimeType ?? 'application/json',
    maxTimeoutSeconds: config.maxTimeoutSeconds ?? 300,
    facilitator: config.facilitator ?? new HTTPFacilitatorClient({ url: config.facilitatorUrl ?? DEFAULT_FACILITATOR_URL }),
    mppSecretKey: config.mppSecretKey ?? env('MPP_SECRET_KEY') ?? randomSecret(),
    mppRealm: config.mppRealm,
    rpcUrl: config.rpcUrl,
  }
}

class RequestAdapter implements HTTPAdapter {
  private readonly url: URL

  constructor(private readonly req: Request) {
    this.url = new URL(req.url)
  }

  getHeader(name: string): string | undefined {
    return this.req.headers.get(name) ?? undefined
  }

  getMethod(): string {
    return this.req.method
  }

  getPath(): string {
    return this.url.pathname
  }

  getUrl(): string {
    return this.req.url
  }

  getAcceptHeader(): string {
    return this.req.headers.get('accept') ?? ''
  }

  getUserAgent(): string {
    return this.req.headers.get('user-agent') ?? ''
  }

  getQueryParams(): Record<string, string | string[]> {
    const params: Record<string, string | string[]> = {}
    for (const [key, value] of this.url.searchParams.entries()) {
      const existing = params[key]
      if (existing === undefined) params[key] = value
      else if (Array.isArray(existing)) existing.push(value)
      else params[key] = [existing, value]
    }
    return params
  }

  getQueryParam(name: string): string | string[] | undefined {
    const values = this.url.searchParams.getAll(name)
    if (values.length === 0) return undefined
    return values.length === 1 ? values[0] : values
  }

  async getBody(): Promise<unknown> {
    try {
      return await this.req.clone().json()
    } catch {
      return undefined
    }
  }
}

class PaywallEngine {
  private readonly mppHandler?: (req: Request) => Promise<any>
  private readonly x402HTTPServer?: x402HTTPResourceServer
  private x402Init?: Promise<void>

  constructor(private readonly config: ResolvedConfig) {
    if (config.protocol.includes('mpp')) {
      const method = solana.charge({
        recipient: config.recipient,
        currency: config.asset.currency,
        decimals: config.asset.nativeSol ? undefined : config.asset.decimals,
        tokenProgram: config.asset.tokenProgram,
        network: config.network.mpp,
        rpcUrl: config.rpcUrl,
      })
      const mppx = Mppx.create({
        secretKey: config.mppSecretKey,
        realm: config.mppRealm,
        methods: [method],
      })
      this.mppHandler = mppx.charge({
        amount: config.amount,
        description: config.description,
      }) as unknown as (req: Request) => Promise<any>
    }

    if (config.protocol.includes('x402')) {
      const x402Server = new x402ResourceServer(config.facilitator)
        .register(config.network.x402, new ExactSvmScheme())
      const route: RouteConfig = {
        accepts: {
          scheme: 'exact',
          network: config.network.x402,
          payTo: config.recipient,
          price: {
            amount: config.amount,
            asset: config.asset.currency,
          } satisfies Price,
          maxTimeoutSeconds: config.maxTimeoutSeconds,
        },
        description: config.description,
        mimeType: config.mimeType,
      }
      this.x402HTTPServer = new x402HTTPResourceServer(x402Server, route)
    }
  }

  async before(req: Request): Promise<BeforeResult> {
    const hasMPP = req.headers.get('authorization')?.toLowerCase().startsWith('payment ') ?? false
    const hasX402 = !!(req.headers.get('payment-signature') ?? req.headers.get('x-payment'))

    if (hasMPP && this.mppHandler) {
      const result = await this.mppHandler(req.clone())
      if (result.status === 402) return { type: 'response', response: result.challenge }
      return { type: 'mpp-paid', withReceipt: result.withReceipt }
    }

    if (hasX402 && this.x402HTTPServer) {
      const context = this.context(req)
      await this.ensureX402Initialized()
      const result = await this.x402HTTPServer.processHTTPRequest(context)
      if (result.type === 'payment-error') return { type: 'response', response: responseFromInstructions(result.response) }
      if (result.type === 'payment-verified') {
        return {
          type: 'x402-paid',
          paymentPayload: result.paymentPayload,
          paymentRequirements: result.paymentRequirements,
          declaredExtensions: result.declaredExtensions,
          context,
        }
      }
    }

    if (hasMPP || hasX402) {
      return { type: 'response', response: await this.unpaidResponse(req, 'Unsupported payment protocol for this route') }
    }

    return { type: 'response', response: await this.unpaidResponse(req) }
  }

  async settleX402(pre: Extract<BeforeResult, { type: 'x402-paid' }>, response: Response): Promise<Response> {
    if (!this.x402HTTPServer || response.status >= 400) return response
    const responseBody = Buffer.from(await response.clone().arrayBuffer())
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })
    const result = await this.x402HTTPServer.processSettlement(
      pre.paymentPayload,
      pre.paymentRequirements,
      pre.declaredExtensions,
      { request: pre.context, responseBody, responseHeaders }
    )
    return applySettlementResult(response, result)
  }

  private async unpaidResponse(req: Request, error?: string): Promise<Response> {
    let response: Response | undefined
    if (this.x402HTTPServer) {
      const context = this.context(req)
      await this.ensureX402Initialized()
      const result = await this.x402HTTPServer.processHTTPRequest(context)
      if (result.type === 'payment-error') response = responseFromInstructions(result.response)
    }

    if (this.mppHandler) {
      const mppResult = await this.mppHandler(req.clone())
      if (mppResult.status === 402) {
        response = mergeChallengeResponse(response, mppResult.challenge)
      }
    }

    if (!response) {
      response = Response.json(error ? { error } : {}, { status: 402 })
    } else if (error) {
      response = withJsonBody(response, { error })
    }

    response.headers.set('cache-control', 'no-store')
    return response
  }

  private context(req: Request): HTTPRequestContext {
    const adapter = new RequestAdapter(req)
    return {
      adapter,
      path: adapter.getPath(),
      method: adapter.getMethod(),
      paymentHeader: adapter.getHeader('payment-signature') ?? adapter.getHeader('x-payment'),
    }
  }

  private async ensureX402Initialized(): Promise<void> {
    if (!this.x402HTTPServer) return
    this.x402Init ??= this.x402HTTPServer.initialize()
    await this.x402Init
  }
}

function responseFromInstructions(instructions: {
  status: number
  headers: Record<string, string>
  body?: unknown
  isHtml?: boolean
}): Response {
  const headers = new Headers(instructions.headers)
  if (instructions.isHtml) {
    return new Response(String(instructions.body ?? ''), { status: instructions.status, headers })
  }
  return new Response(JSON.stringify(instructions.body ?? {}), { status: instructions.status, headers })
}

function mergeChallengeResponse(base: Response | undefined, challenge: Response): Response {
  if (!base) return challenge

  const headers = new Headers(base.headers)
  for (const [key, value] of challenge.headers.entries()) {
    if (key.toLowerCase() === 'www-authenticate') headers.append(key, value)
    else if (!headers.has(key)) headers.set(key, value)
  }
  return new Response(base.body, {
    status: base.status,
    statusText: base.statusText,
    headers,
  })
}

function withJsonBody(response: Response, body: unknown): Response {
  const headers = new Headers(response.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function applySettlementResult(response: Response, result: ProcessSettleResultResponse): Response {
  if (!result.success) return responseFromInstructions(result.response)
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(result.headers)) headers.set(key, value)
  headers.set('cache-control', 'private')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function markPaymentReceiptPrivate(response: Response): Response {
  if (!response.headers.has('payment-receipt')) return response
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'private')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function createEngine(config: PaywallConfig): PaywallEngine {
  return new PaywallEngine(resolveConfig(config))
}

/**
 * Web standard / Next.js route-handler wrapper.
 */
export function paywall(
  config: PaywallConfig,
  handler: (req: Request) => Promise<Response> | Response
): (req: Request) => Promise<Response> {
  const engine = createEngine(config)
  return async (req: Request): Promise<Response> => {
    const pre = await engine.before(req)
    if (pre.type === 'response') return pre.response

    const response = await handler(req)
    if (pre.type === 'mpp-paid') return markPaymentReceiptPrivate(pre.withReceipt(response))
    return engine.settleX402(pre, response)
  }
}

/**
 * Hono middleware adapter.
 */
export function honoPaywall(config: PaywallConfig) {
  const engine = createEngine(config)
  return async (c: any, next: () => Promise<void>) => {
    const pre = await engine.before(c.req.raw)
    if (pre.type === 'response') return pre.response

    await next()

    if (pre.type === 'mpp-paid') {
      c.res = markPaymentReceiptPrivate(pre.withReceipt(c.res))
      return
    }

    c.res = await engine.settleX402(pre, c.res)
  }
}

/**
 * Standard middleware-style helper. For Next.js, prefer wrapping route handlers
 * with `paywall(...)`; middleware cannot continue into a route handler after
 * payment verification in the same standard Web API shape.
 */
export function paywallMiddleware(config: PaywallConfig) {
  const protectedHandler = paywall(config, async () => new Response(null, { status: 204 }))
  return async (req: Request): Promise<Response> => protectedHandler(req)
}
