// Focused, no-money regression check. Run: bun testing/x402-settlement-check.ts
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { encodePaymentResponseHeader } from '@x402/core/http'
import { paymentHttp } from '../apps/backend/src/modules/payment-http'
import { settlementHeaders } from '../apps/backend/src/modules/x402-settlement'

const network = 'eip155:84532', payer = `0x${'12'.repeat(20)}`, hash = `0x${'ab'.repeat(32)}`
const header = encodePaymentResponseHeader({ success: true, transaction: hash, network, payer })
let saved: string | undefined
const save = settlementHeaders(network, payer, async value => { saved = value })
await save({ 'payment-response': header })
assert.equal(saved, hash)
saved = undefined
await save({ 'payment-response': encodePaymentResponseHeader({ success: true, transaction: hash, network: 'eip155:5042002', payer }) })
await save({ 'payment-response': 'invalid' })
assert.equal(saved, undefined)
await assert.rejects(settlementHeaders(network, payer, async () => { throw new Error('DB unavailable') })({ 'payment-response': header }), /DB unavailable/)

// Settlement headers must survive an interrupted HTTP body; no payment is sent.
const server = createServer((_request, response) => {
  response.writeHead(200, { 'payment-response': header, 'content-length': '100' })
  response.flushHeaders()
  setTimeout(() => response.destroy(), 30)
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const origin = `http://127.0.0.1:${port}`
try {
  await assert.rejects(paymentHttp({ url: origin, method: 'GET', headers: {} }, {}, [origin], settlementHeaders(network, payer, async value => {
    await new Promise(resolve => setTimeout(resolve, 60))
    saved = value
  })))
  assert.equal(saved, hash)
  console.log('Settlement header validation and hash retention after body failure passed (no payment).')
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
