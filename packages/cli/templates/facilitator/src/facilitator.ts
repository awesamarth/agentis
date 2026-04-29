import { config } from 'dotenv'
import express from 'express'
import { KoraClient } from '@solana/kora'
import { SOLANA_DEVNET_CAIP2 } from '@x402/svm'
import {
  getMetrics,
  listSellers,
  recordSettlement,
  requireSellerCanPayFee,
  upsertSeller,
  microsToDollars,
} from './ledger'
import { startHeartbeat } from './heartbeat'

config()

const app = express()
app.use(express.json({ limit: '2mb' }))

const PORT = Number(process.env.FACILITATOR_PORT ?? 3000)
const NETWORK = process.env.NETWORK ?? SOLANA_DEVNET_CAIP2
const KORA_RPC_URL = process.env.KORA_RPC_URL ?? 'http://localhost:8080/'
const KORA_API_KEY = process.env.KORA_API_KEY ?? ''
const DEFAULT_FEE_BPS = Number(process.env.FACILITATOR_FEE_BPS ?? 500)

function kora() {
  return new KoraClient({ rpcUrl: KORA_RPC_URL, apiKey: KORA_API_KEY })
}

function paymentAmountMicros(paymentRequirements: any): number {
  const raw = paymentRequirements?.maxAmountRequired ?? paymentRequirements?.amount
  const amount = typeof raw === 'bigint' ? Number(raw) : Number(String(raw ?? '0'))
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid payment amount')
  return amount
}

function paymentPayTo(paymentRequirements: any): string {
  const payTo = String(paymentRequirements?.payTo ?? '')
  if (!payTo) throw new Error('Missing payment recipient')
  return payTo
}

function paymentTransaction(paymentPayload: any): string {
  const transaction = paymentPayload?.payload?.transaction
  if (!transaction || typeof transaction !== 'string') throw new Error('Missing Solana transaction in payment payload')
  return transaction
}

function assertNetwork(paymentRequirements: any) {
  const network = String(paymentRequirements?.network ?? '')
  if (!network.startsWith('solana:')) throw new Error('Invalid network')
}

function requireAdmin(req: express.Request, res: express.Response): boolean {
  const token = process.env.ADMIN_TOKEN
  if (!token || token === 'change-me') {
    res.status(500).json({ error: 'ADMIN_TOKEN must be set before using admin endpoints' })
    return false
  }
  if (req.header('x-admin-token') !== token) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

const defaultSeller = process.env.DEFAULT_SELLER_PAY_TO
if (defaultSeller) {
  upsertSeller({
    payTo: defaultSeller,
    label: 'default',
    balanceUsd: Number(process.env.DEFAULT_SELLER_BALANCE_USD ?? 0),
  })
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, network: NETWORK, feeBps: DEFAULT_FEE_BPS, ...getMetrics() })
})

app.get('/supported', async (_req, res) => {
  try {
    const { signer_address } = await kora().getPayerSigner()
    res.json({
      kinds: [{
        x402Version: 2,
        scheme: 'exact',
        network: NETWORK,
        extra: { feePayer: signer_address },
      }],
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/verify', async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body
    assertNetwork(paymentRequirements)
    const payTo = paymentPayTo(paymentRequirements)
    const amountMicros = paymentAmountMicros(paymentRequirements)
    requireSellerCanPayFee(payTo, amountMicros, DEFAULT_FEE_BPS)
    await kora().signTransaction({ transaction: paymentTransaction(paymentPayload) })
    res.json({ isValid: true })
  } catch (err) {
    res.status(400).json({
      isValid: false,
      invalidReason: err instanceof Error ? err.message : 'Kora validation failed',
    })
  }
})

app.post('/settle', async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body
    assertNetwork(paymentRequirements)
    const payTo = paymentPayTo(paymentRequirements)
    const amountMicros = paymentAmountMicros(paymentRequirements)
    const { feeMicros } = requireSellerCanPayFee(payTo, amountMicros, DEFAULT_FEE_BPS)
    const { signature } = await kora().signAndSendTransaction({
      transaction: paymentTransaction(paymentPayload),
    })
    recordSettlement({ payTo, signature, amountMicros, feeMicros })
    res.json({ transaction: signature, success: true, network: NETWORK })
  } catch (err) {
    res.status(400).json({
      transaction: '',
      success: false,
      network: NETWORK,
      errorReason: err instanceof Error ? err.message : 'Kora settlement failed',
    })
  }
})

app.get('/admin/sellers', (req, res) => {
  if (!requireAdmin(req, res)) return
  res.json(listSellers().map((seller: any) => ({
    ...seller,
    balanceUsd: microsToDollars(seller.balanceMicros),
  })))
})

app.post('/admin/sellers', (req, res) => {
  if (!requireAdmin(req, res)) return
  const payTo = String(req.body?.payTo ?? '')
  if (!payTo) return res.status(400).json({ error: 'payTo is required' })
  const seller = upsertSeller({
    payTo,
    label: req.body?.label ? String(req.body.label) : undefined,
    topUpUsd: req.body?.topUpUsd === undefined ? undefined : Number(req.body.topUpUsd),
    balanceUsd: req.body?.balanceUsd === undefined ? undefined : Number(req.body.balanceUsd),
    feeBps: req.body?.feeBps === undefined ? undefined : Number(req.body.feeBps),
    active: req.body?.active === undefined ? undefined : Boolean(req.body.active),
  })
  res.json({ ...seller, balanceUsd: microsToDollars(seller.balanceMicros) })
})

startHeartbeat()

app.listen(PORT, () => {
  console.log(`Agentis facilitator listening at http://localhost:${PORT}`)
  console.log(`Kora RPC: ${KORA_RPC_URL}`)
})
