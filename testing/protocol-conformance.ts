const X402_SERVER = process.env.X402_SERVER ?? 'http://localhost:4000'
const MPP_SERVER = process.env.MPP_SERVER ?? 'http://localhost:4001'
const SDK_PAYWALL_SERVER = process.env.SDK_PAYWALL_SERVER ?? 'http://localhost:4003'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function decodeBase64Json(value: string): any {
  return JSON.parse(atob(value))
}

async function expectX402Challenge(path: string, init?: RequestInit) {
  const response = await fetch(`${X402_SERVER}${path}`, init)
  assert(response.status === 402, `x402 ${init?.method ?? 'GET'} ${path}: expected 402, got ${response.status}`)

  const required = response.headers.get('payment-required')
  assert(required, `x402 ${path}: missing PAYMENT-REQUIRED`)
  const challenge = decodeBase64Json(required)
  assert(challenge.x402Version === 2, `x402 ${path}: expected x402Version 2`)
  assert(Array.isArray(challenge.accepts) && challenge.accepts.length > 0, `x402 ${path}: missing accepts`)
  assert(
    challenge.accepts.some((option: any) => option.network === 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
    `x402 ${path}: missing Solana devnet CAIP-2 option`,
  )
  assert(!response.headers.has('x-payment-response'), `x402 ${path}: returned legacy v1 response header`)
}

async function expectMPPChallenge(path: string, init?: RequestInit) {
  const response = await fetch(`${MPP_SERVER}${path}`, init)
  assert(response.status === 402, `MPP ${init?.method ?? 'GET'} ${path}: expected 402, got ${response.status}`)

  const challenge = response.headers.get('www-authenticate')
  assert(challenge?.startsWith('Payment '), `MPP ${path}: missing Payment WWW-Authenticate challenge`)
  assert(/method="solana"/.test(challenge), `MPP ${path}: missing Solana method`)
  assert(/intent="charge"/.test(challenge), `MPP ${path}: missing charge intent`)
  assert(response.headers.get('cache-control') === 'no-store', `MPP ${path}: 402 must use Cache-Control: no-store`)
}

async function main() {
  const x402Free = await fetch(`${X402_SERVER}/free`)
  assert(x402Free.status === 200, `x402 free endpoint returned ${x402Free.status}`)

  await expectX402Challenge('/paid-data')
  await expectX402Challenge('/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conformance: true }),
  })
  await expectX402Challenge('/echo', {
    method: 'PATCH',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array([1, 2, 3]),
  })

  const malformedX402 = await fetch(`${X402_SERVER}/paid-data`, {
    headers: { 'payment-signature': 'not-base64' },
  })
  assert(malformedX402.status === 402, `x402 malformed payment should return 402, got ${malformedX402.status}`)
  assert(malformedX402.headers.has('payment-required'), 'x402 malformed payment response missing PAYMENT-REQUIRED')

  const mppFree = await fetch(`${MPP_SERVER}/free`)
  assert(mppFree.status === 200, `MPP free endpoint returned ${mppFree.status}`)

  await expectMPPChallenge('/mpp-data')
  await expectMPPChallenge('/mpp-echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conformance: true }),
  })
  await expectMPPChallenge('/mpp-echo', {
    method: 'PATCH',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array([1, 2, 3]),
  })

  const malformedMPP = await fetch(`${MPP_SERVER}/mpp-data`, {
    headers: { authorization: 'Payment not-base64' },
  })
  assert(malformedMPP.status === 402, `MPP malformed credential should return 402, got ${malformedMPP.status}`)
  assert(malformedMPP.headers.get('cache-control') === 'no-store', 'MPP malformed credential response must not be cached')

  const sdkX402 = await fetch(`${SDK_PAYWALL_SERVER}/x402-echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert(sdkX402.status === 402, `Agentis x402 paywall returned ${sdkX402.status}`)
  assert(sdkX402.headers.has('payment-required'), 'Agentis x402 paywall is missing PAYMENT-REQUIRED')
  assert(
    decodeBase64Json(sdkX402.headers.get('payment-required')!).x402Version === 2,
    'Agentis x402 paywall did not issue a v2 challenge',
  )
  assert(sdkX402.headers.get('cache-control') === 'no-store', 'Agentis x402 challenge must not be cached')

  const sdkMPP = await fetch(`${SDK_PAYWALL_SERVER}/mpp-echo`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert(sdkMPP.status === 402, `Agentis MPP paywall returned ${sdkMPP.status}`)
  assert(sdkMPP.headers.get('www-authenticate')?.startsWith('Payment '), 'Agentis MPP paywall is missing its challenge')
  assert(sdkMPP.headers.get('cache-control') === 'no-store', 'Agentis MPP challenge must not be cached')

  const dual = await fetch(`${SDK_PAYWALL_SERVER}/both-usdc`)
  assert(dual.status === 402, `Agentis dual paywall returned ${dual.status}`)
  assert(dual.headers.has('payment-required'), 'Agentis dual paywall is missing x402 challenge')
  assert(dual.headers.get('www-authenticate')?.startsWith('Payment '), 'Agentis dual paywall is missing MPP challenge')

  console.log('Protocol conformance checks passed')
  console.log('- x402 v2 challenge headers, CAIP-2 network, GET/POST/PATCH, malformed payment')
  console.log('- MPP challenge headers, cache controls, GET/POST/PATCH, malformed credential')
  console.log('- Agentis seller paywalls: x402, MPP, and dual-protocol challenge interoperability')
}

await main()
