import { test, expect } from 'bun:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fetchRequest, httpFields, paymentRequest } from '../packages/core/src/operations'
import { paymentHttp } from '../packages/core/src/payment-http'

test('paid responses accept 10 MiB and reject overflow without losing settlement headers', async () => {
  const limit = 10 * 1024 * 1024
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'payment-receipt': 'fixture-receipt' })
    response.end(Buffer.alloc(request.url === '/overflow' ? limit + 1 : limit, 0xa5))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const response = await paymentHttp({ url: origin, method: 'GET', headers: {} }, {}, [origin])
    expect(response.status).toBe(200)
    const bytes = Buffer.from(response.bodyBase64, 'base64')
    expect(bytes.length).toBe(limit)
    expect(bytes[0]).toBe(0xa5)
    expect(bytes.at(-1)).toBe(0xa5)
    let saved: string | undefined
    await expect(paymentHttp({ url: `${origin}/overflow`, method: 'GET', headers: {} }, {}, [origin], async headers => {
      await Promise.resolve()
      saved = headers['payment-receipt']
    })).rejects.toThrow('Response exceeds 10 MiB')
    expect(saved).toBe('fixture-receipt')
  } finally { server.closeAllConnections(); server.close() }
})

const walletId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
test('paid HTTP preserves methods, content types and exact bodies above the old cap', async () => {
  const requests: { method: string; type: string | null; body: Uint8Array }[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({ method: request.method!, type: request.headers['content-type'] ?? null, body: Buffer.concat(chunks) })
    response.writeHead(402, { 'www-authenticate': 'Payment test' }); response.end()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const body = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? undefined : '<request>' + 'x'.repeat(40_000) + '🙂</request>'
      const input = fetchRequest.parse({ walletId, url: origin, method, body, headers: { 'content-type': 'application/xml' }, maxAmountAtomic: '1000' })
      const persisted = { url: input.url, ...httpFields(input) }
      expect((await paymentHttp(paymentRequest(persisted), {}, [origin])).status).toBe(402)
      const request = requests.at(-1)!
      expect(request.method).toBe(method)
      expect(request.type).toBe('application/xml')
      expect(Buffer.from(request.body).equals(Buffer.from(body ?? ''))).toBe(true)
    }
    const binary = Buffer.from([0, 255, 128, 10, 13])
    await paymentHttp(paymentRequest({ url: origin, method: 'POST', bodyBase64: binary.toString('base64'), headers: { 'content-type': 'application/octet-stream' } }), {}, [origin])
    expect(Buffer.from(requests.at(-1)!.body)).toEqual(binary)
    expect(() => fetchRequest.parse({ walletId, url: origin, method: 'GET', body: 'bad', maxAmountAtomic: '1' })).toThrow()
    await expect(paymentHttp({ url: origin, method: 'CONNECT', headers: {} }, {}, [origin])).rejects.toThrow()
    await expect(paymentHttp({ url: origin, method: 'POST', headers: { 'Payment-Authorization': 'pre-signed' } }, {}, [origin])).rejects.toThrow()
  } finally { server.closeAllConnections(); server.close() }
})
