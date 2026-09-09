import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'

export type PaymentHttpRequest = { url: string; method: string; headers: Record<string, string>; bodyBase64?: string }
export type PaymentHttpResponse = { status: number; headers: Record<string, string>; bodyBase64: string }
const privateAddresses = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['192.0.2.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) privateAddresses.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [['2001:db8::', 32], ['2001::', 32], ['2002::', 16], ['2001:10::', 28], ['2001:20::', 28], ['3fff::', 20]] as const) privateAddresses.addSubnet(address, prefix, 'ipv6')
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6')
export function publicAddress(address: string) {
  const family = isIP(address)
  return family === 4 ? !privateAddresses.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !privateAddresses.check(address, 'ipv6')
}
const forbiddenHeaders = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-connection', 'cookie', 'payment-signature', 'x-payment'])
export function validatePaymentHeaders(headers: Record<string, string>) {
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value) || forbiddenHeaders.has(name.toLowerCase()) || (name.toLowerCase() === 'authorization' && /^Payment\s/i.test(value))) throw new Error('Unsafe or pre-signed request header')
  }
}
export async function paymentHttp(input: PaymentHttpRequest, paymentHeaders: Record<string, string> = {}, localOrigins: readonly string[] = []): Promise<PaymentHttpResponse> {
  validatePaymentHeaders(input.headers)
  const url = new URL(input.url)
  const local = process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && url.hostname === '127.0.0.1' && localOrigins.includes(url.origin)
  if (url.username || url.password || url.hash || (!local && (url.protocol !== 'https:' || (url.port && url.port !== '443')))) throw new Error('Paid requests require HTTPS; redirects and embedded credentials are not supported')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  let timer: ReturnType<typeof setTimeout> | undefined
  const records = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS lookup timed out')), 10_000) }),
  ]).finally(() => clearTimeout(timer))
  if (!records.length || (!local && records.some(record => !publicAddress(record.address)))) throw new Error('Private, reserved or mixed DNS destinations are not allowed')
  const pinned = records.find(record => record.family === 4) ?? records[0]!
  const body = input.bodyBase64 ? Buffer.from(input.bodyBase64, 'base64') : undefined
  if (body && body.length > 24_576) throw new Error('Request body is too large')
  const headers = Object.fromEntries(Object.entries(input.headers).map(([name, value]) => [name.toLowerCase(), value]))
  return new Promise((resolve, reject) => {
    const request = (local ? httpRequest : httpsRequest)(url, {
      method: input.method, headers: { ...headers, ...paymentHeaders, 'accept-encoding': 'identity', ...(body ? { 'content-length': String(body.length) } : {}) },
      agent: false, family: pinned.family, maxHeaderSize: 16_384,
      // Pin the validated address while preserving the original Host/TLS SNI.
      lookup: (_host, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
    }, response => {
      response.on('error', error => { clearTimeout(deadline); reject(error) })
      if ((response.statusCode ?? 0) >= 300 && response.statusCode! < 400) { response.destroy(new Error('Paid request redirects are not followed')); return }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(new Error('Compressed paid responses are not accepted')); return }
      const chunks: Buffer[] = []; let size = 0
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 1_048_576) response.destroy(new Error('Response exceeds 1 MiB')); else chunks.push(chunk) })
      response.on('end', () => {
        clearTimeout(deadline)
        const headers: Record<string, string> = {}
        for (const [name, value] of Object.entries(response.headers)) if (value !== undefined && !['set-cookie', 'connection', 'transfer-encoding'].includes(name)) headers[name] = Array.isArray(value) ? value.join(', ') : value
        resolve({ status: response.statusCode ?? 502, headers, bodyBase64: Buffer.concat(chunks).toString('base64') })
      })
    })
    const deadline = setTimeout(() => request.destroy(new Error('Paid request timed out')), 20_000)
    request.on('error', error => { clearTimeout(deadline); reject(error) })
    request.end(body)
  })
}
