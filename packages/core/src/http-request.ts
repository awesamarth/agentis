import { z } from 'zod'

// Application methods, not proxy/tunnel operations (CONNECT) or credential echo (TRACE).
export const httpMethod = z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
const forbiddenHeaders = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-connection', 'cookie', 'payment-signature', 'x-payment', 'payment-authorization', 'expect', 'trailer', 'te'])
export function validPaymentHeaders(headers: Record<string, string>) {
  return new Set(Object.keys(headers).map(name => name.toLowerCase())).size === Object.keys(headers).length && Object.entries(headers).every(([name, value]) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && !/[\r\n]/.test(value) && !forbiddenHeaders.has(name.toLowerCase()) && !(name.toLowerCase() === 'authorization' && /^Payment\s/i.test(value.trimStart())))
}
export const httpRequestFields = {
  method: httpMethod.optional(),
  headers: z.record(z.string(), z.string()).refine(validPaymentHeaders, 'Unsafe or pre-signed request header').optional(),
  body: z.string().optional(),
  bodyBase64: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).optional(),
}
export type HttpRequestFields = { method?: z.infer<typeof httpMethod>; headers?: Record<string, string>; body?: string; bodyBase64?: string }
export function validHttpBody(input: HttpRequestFields) {
  const hasBody = input.body !== undefined || input.bodyBase64 !== undefined
  return !(input.body !== undefined && input.bodyBase64 !== undefined) && !(hasBody && ['GET', 'HEAD'].includes(input.method ?? 'GET'))
}
export const httpRequest = z.object({ url: z.url().max(4096), ...httpRequestFields }).strict().refine(validHttpBody, 'Choose one body encoding; GET and HEAD do not accept a body')
// Preserve exact supplied bytes and headers in the operation hash. Defaults are only
// applied at transport time, so existing GET approvals/idempotency remain unchanged.
export function paymentRequest(input: { url: string } & HttpRequestFields) {
  const request = httpRequest.parse({ url: input.url, ...httpFields(input) })
  return { ...request, method: request.method ?? 'GET', headers: request.headers ?? {} }
}
export function httpFields(input: HttpRequestFields): HttpRequestFields {
  return { ...(input.method !== undefined ? { method: input.method } : {}), ...(input.headers !== undefined ? { headers: input.headers } : {}), ...(input.body !== undefined ? { body: input.body } : {}), ...(input.bodyBase64 !== undefined ? { bodyBase64: input.bodyBase64 } : {}) }
}
