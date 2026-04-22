/**
 * Agentis SDK Test — x402 + MPP
 *
 * Three modes:
 * 1. AgentisClient.fetch() — uses Privy-backed wallet via Agentis backend (x402 + MPP)
 * 2. x402 direct fetch — uses local keypair with @x402/fetch + PayAI facilitator
 * 3. MPP direct fetch — uses local keypair with @solana/mpp client
 */

import { AgentisClient } from '@agentis/sdk'
import { wrapFetchWithPayment, x402Client } from '@x402/fetch'
import { ExactSvmSchemeV1 } from '@x402/svm/exact/v1/client'
import { Mppx, solana as solanaClient } from '@solana/mpp/client'
import { createKeyPairSignerFromBytes } from '@solana/kit'
import { base58 } from '@scure/base'
import { readFileSync, existsSync } from 'fs'

const API_KEY = process.env.AGENTIS_API_KEY ?? 'agt_live_PASTE_YOUR_KEY_HERE'
const BACKEND_URL = process.env.AGENTIS_BACKEND_URL ?? 'http://localhost:3001'
const X402_SERVER = 'http://localhost:4000'
const MPP_SERVER = 'http://localhost:4001'
const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'

async function testAgentisSDK() {
  console.log('━━━ Mode 1: AgentisClient (Privy-backed wallet) ━━━━━━━━━━━━\n')

  const agentis = await AgentisClient.create({
    apiKey: API_KEY,
    baseUrl: BACKEND_URL,
    simulate: false,
    onPayment: (details) => {
      console.log(`\n💸 Payment:`)
      console.log(`   Protocol : ${details.protocol}`)
      console.log(`   Amount   : ${details.amount} ${details.currency}`)
      console.log(`   URL      : ${details.url}`)
    },
  })

  console.log(`✅ Agent: ${agentis.agentName} (${agentis.walletAddress})\n`)

  // Free endpoint
  console.log('── Free endpoint ──')
  const freeRes = await agentis.fetch(`${X402_SERVER}/free`)
  console.log('Response:', await freeRes.json())
  console.log()

  // x402: Paid endpoint ($0.001 USDC)
  console.log('── x402 Paid endpoint ($0.001 USDC) ──')
  try {
    const paidRes = await agentis.fetch(`${X402_SERVER}/paid-data`)
    console.log('Response:', JSON.stringify(await paidRes.json(), null, 2))
  } catch (err: any) {
    console.error('Error:', err.message)
  }
  console.log()

  // x402: Premium endpoint ($0.005 USDC)
  console.log('── x402 Premium endpoint ($0.005 USDC) ──')
  try {
    const premiumRes = await agentis.fetch(`${X402_SERVER}/premium-data`)
    console.log('Response:', JSON.stringify(await premiumRes.json(), null, 2))
  } catch (err: any) {
    console.error('Error:', err.message)
  }
  console.log()

  // MPP: Paid endpoint ($0.001 USDC) — via AgentisClient → backend → @solana/mpp client
  console.log('── MPP endpoint ($0.001 USDC) via AgentisClient ──')
  try {
    const mppRes = await agentis.fetch(`${MPP_SERVER}/mpp-data`)
    console.log('Response:', JSON.stringify(await mppRes.json(), null, 2))
  } catch (err: any) {
    console.error('Error:', err.message)
  }
  console.log()

  // MPP: Premium ($0.005 USDC) — via AgentisClient
  console.log('── MPP premium ($0.005 USDC) via AgentisClient ──')
  try {
    const mppPremiumRes = await agentis.fetch(`${MPP_SERVER}/mpp-premium`)
    console.log('Response:', JSON.stringify(await mppPremiumRes.json(), null, 2))
  } catch (err: any) {
    console.error('Error:', err.message)
  }
  console.log()
}

async function testX402Direct() {
  console.log('━━━ Mode 2: x402 direct (local keypair + PayAI) ━━━━━━━━━━━\n')

  // Load keypair from file or env
  const keyPath = './keypair.json'
  let keypairBytes: Uint8Array

  if (existsSync(keyPath)) {
    const raw = JSON.parse(readFileSync(keyPath, 'utf-8'))
    keypairBytes = Uint8Array.from(raw)
    console.log('Loaded keypair from keypair.json')
  } else if (process.env.SVM_PRIVATE_KEY) {
    keypairBytes = base58.decode(process.env.SVM_PRIVATE_KEY)
    console.log('Loaded keypair from SVM_PRIVATE_KEY env')
  } else {
    console.log('⚠️  No keypair found — skipping x402 direct test')
    console.log('   Create one: solana-keygen new --outfile sdk-testing/agent-app/keypair.json')
    console.log('   Fund with USDC: https://faucet.circle.com/ (Solana Devnet)')
    return
  }

  const signer = await createKeyPairSignerFromBytes(keypairBytes)
  console.log(`Wallet: ${signer.address}\n`)

  const svmScheme = new ExactSvmSchemeV1(signer)
  const client = new x402Client().register(DEVNET_NETWORK, svmScheme, 1)
  const fetchWithPay = wrapFetchWithPayment(globalThis.fetch, client)

  // Paid endpoint
  console.log('── Paid endpoint ($0.001 USDC) ──')
  try {
    const res = await fetchWithPay(`${X402_SERVER}/paid-data`)
    console.log('Status:', res.status)
    console.log('Response:', JSON.stringify(await res.json(), null, 2))
  } catch (err: any) {
    console.error('Error:', err.message)
  }

  console.log()

  // Premium endpoint
  console.log('── Premium endpoint ($0.005 USDC) ──')
  try {
    const res = await fetchWithPay(`${X402_SERVER}/premium-data`)
    console.log('Status:', res.status)
    console.log('Response:', JSON.stringify(await res.json(), null, 2))
  } catch (err: any) {
    console.error('Error:', err.message)
  }
}

async function testMPPDirect() {
  console.log('━━━ Mode 3: MPP direct (local keypair + @solana/mpp) ━━━━━━\n')

  const keyPath = './keypair.json'
  let keypairBytes: Uint8Array

  if (existsSync(keyPath)) {
    const raw = JSON.parse(readFileSync(keyPath, 'utf-8'))
    keypairBytes = Uint8Array.from(raw)
    console.log('Loaded keypair from keypair.json')
  } else if (process.env.SVM_PRIVATE_KEY) {
    keypairBytes = base58.decode(process.env.SVM_PRIVATE_KEY)
    console.log('Loaded keypair from SVM_PRIVATE_KEY env')
  } else {
    console.log('⚠️  No keypair found — skipping MPP direct test')
    return
  }

  const signer = await createKeyPairSignerFromBytes(keypairBytes)
  console.log(`Wallet: ${signer.address}\n`)

  // Create MPP client with @solana/mpp
  const mppx = Mppx.create({
    polyfill: false,
    methods: [
      solanaClient.charge({
        signer,
        rpcUrl: 'https://api.devnet.solana.com',
      }),
    ],
  })

  console.log('── MPP basic ($0.001 USDC) ──')
  try {
    const res = await mppx.fetch(`${MPP_SERVER}/mpp-data`)
    console.log('Status:', res.status)
    console.log('Response:', JSON.stringify(await res.json(), null, 2))
  } catch (err: any) {
    console.error('Error:', err.message)
  }
  console.log()

  console.log('── MPP premium ($0.005 USDC) ──')
  try {
    const res = await mppx.fetch(`${MPP_SERVER}/mpp-premium`)
    console.log('Status:', res.status)
    console.log('Response:', JSON.stringify(await res.json(), null, 2))
  } catch (err: any) {
    console.error('Error:', err.message)
  }
}

async function main() {
  console.log('🤖 Agentis + x402 + MPP Test\n')
  console.log(`Backend: ${BACKEND_URL}`)
  console.log(`x402 server: ${X402_SERVER}`)
  console.log(`MPP server:  ${MPP_SERVER}\n`)

  await testAgentisSDK()
  await testX402Direct()
  await testMPPDirect()
}

main().catch((err) => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
