import { AgentisClient } from '@agentis/sdk'

const BURN_ADDRESS = '5yDpyuSofQARocCtzkrHaEeRjSBTuYTPPna1aeZjqUB6'
const API_KEY = process.env.AGENTIS_API_KEY!

if (!API_KEY) {
  console.error('AGENTIS_API_KEY env var required')
  process.exit(1)
}

const client = await AgentisClient.create({
  apiKey: API_KEY,
  baseUrl: 'http://localhost:3001',
})

console.log(`Agent: ${client.agentName} (${client.walletAddress})`)
console.log(`Sending 0.001 SOL to burn address...`)

try {
  const sig = await client.send(BURN_ADDRESS, 0.001)
  console.log(`\nSuccess!`)
  console.log(`Signature: ${sig}`)
  console.log(`Explorer:  https://explorer.solana.com/tx/${sig}?cluster=devnet`)
} catch (err: any) {
  console.error(`\nFailed: ${err.message}`)
}
