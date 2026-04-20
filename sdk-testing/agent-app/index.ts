import { AgentisClient } from '@agentis/sdk'

// ─── Config ───────────────────────────────────────────────────────────────────
const API_KEY = process.env.AGENTIS_API_KEY ?? 'agt_live_PASTE_YOUR_KEY_HERE'
const BACKEND_URL = process.env.AGENTIS_BACKEND_URL ?? 'http://localhost:3001'
const X402_SERVER = 'http://localhost:4000'
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🤖 Agentis SDK Test\n')
  console.log(`Backend: ${BACKEND_URL}`)
  console.log(`x402 server: ${X402_SERVER}\n`)

  // Initialize SDK
  console.log('Initializing AgentisClient...')
  const agentis = await AgentisClient.create({
    apiKey: API_KEY,
    baseUrl: BACKEND_URL,
    simulate: false,
    onPayment: (details) => {
      console.log(`\n💸 Payment made:`)
      console.log(`   Protocol : ${details.protocol}`)
      console.log(`   Amount   : ${details.amount} ${details.currency}`)
      console.log(`   Recipient: ${details.recipient}`)
      console.log(`   URL      : ${details.url}`)
    },
  })

  console.log(`✅ Initialized agent: ${agentis.agentName}`)
  console.log(`   Wallet: ${agentis.walletAddress}\n`)

  // Test 1 — free endpoint (no payment)
  console.log('── Test 1: Free endpoint ──────────────────────────')
  const freeRes = await agentis.fetch(`${X402_SERVER}/free`)
  const freeData = await freeRes.json()
  console.log('Response:', freeData)
  console.log()

  // Test 2 — paid endpoint (0.001 SOL)
  console.log('── Test 2: Paid endpoint (0.001 SOL) ──────────────')
  try {
    const paidRes = await agentis.fetch(`${X402_SERVER}/paid-data`)
    const paidData = await paidRes.json()
    console.log('Response:', JSON.stringify(paidData, null, 2))
  } catch (err: any) {
    console.error('Error:', err.message)
    console.error('Stack:', err.stack)
  }
  console.log()

  // Test 3 — premium endpoint (0.005 SOL)
  console.log('── Test 3: Premium endpoint (0.005 SOL) ───────────')
  try {
    const premiumRes = await agentis.fetch(`${X402_SERVER}/premium-data`)
    const premiumData = await premiumRes.json()
    console.log('Response:', JSON.stringify(premiumData, null, 2))
  } catch (err: any) {
    console.error('Error:', err.message)
  }
  console.log()

  // Test 4 — policy check (fetch same paid endpoint again — should work if within limits)
  console.log('── Test 4: Current policy ─────────────────────────')
  const policy = await agentis.policy.get()
  console.log('Policy:', JSON.stringify(policy, null, 2))
}

main().catch((err) => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
