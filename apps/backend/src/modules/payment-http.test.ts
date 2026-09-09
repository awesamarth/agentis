import { test, expect } from 'bun:test'
import { paymentHttp, publicAddress, validatePaymentHeaders } from './payment-http'

test('payment transport blocks private and disguised network destinations', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.100.100.200', '::1', '::ffff:127.0.0.1', 'fe80::1', '2001:db8::1']) expect(publicAddress(ip)).toBe(false)
  expect(publicAddress('8.8.8.8')).toBe(true)
  expect(publicAddress('2001:4860:4860::8888')).toBe(true)
  expect(() => validatePaymentHeaders({ Host: 'localhost' })).toThrow()
  expect(() => validatePaymentHeaders({ Authorization: 'Payment credential' })).toThrow()
  await expect(paymentHttp({ url: 'https://2130706433/', method: 'GET', headers: {} })).rejects.toThrow('Private')
})

test('payment transport preserves POST bytes, rejects redirects and bounds responses', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async request => {
    if (new URL(request.url).pathname === '/redirect') return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })
    if (new URL(request.url).pathname === '/large') return new Response(new Uint8Array(1_048_577))
    expect(request.method).toBe('POST')
    expect(request.headers.get('x-user-value')).toBe('preserved')
    return new Response(await request.arrayBuffer(), { headers: { 'content-type': 'application/octet-stream' } })
  } })
  const origin = `http://127.0.0.1:${server.port}`
  try {
    const bodyBase64 = Buffer.from([0, 255, 128, 10]).toString('base64')
    const result = await paymentHttp({ url: origin, method: 'POST', headers: { 'X-User-Value': 'preserved' }, bodyBase64 }, {}, [origin])
    expect(result.bodyBase64).toBe(bodyBase64)
    expect(result.status).toBe(200)
    await expect(paymentHttp({ url: `${origin}/redirect`, method: 'GET', headers: {} }, {}, [origin])).rejects.toThrow('redirects')
    await expect(paymentHttp({ url: `${origin}/large`, method: 'GET', headers: {} }, {}, [origin])).rejects.toThrow('1 MiB')
  } finally { server.stop(true) }
})
