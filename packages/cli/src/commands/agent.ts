import { getToken } from '../lib/keychain'
import { apiFetch } from '../lib/config'
import { getLocalWalletSigner, loadLocalWalletByNameOrId, recordLocalSpend } from '../lib/local-wallet'
import { checkPolicy } from '@agentis/core'
import {
  address,
  appendTransactionMessageInstruction,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  devnet,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'

const DEVNET_RPC = 'https://api.devnet.solana.com'
const DEVNET_WS = 'wss://api.devnet.solana.com'
const LAMPORTS_PER_SOL = 1_000_000_000
const SOL_MINT = 'So11111111111111111111111111111111111111112'

async function requireAuth(): Promise<string> {
  const token = await getToken()
  if (!token) {
    console.error('Not logged in. Run `agentis login` first.')
    process.exit(1)
  }
  return token
}

async function findHostedAgent(nameOrId: string, token: string): Promise<any | null> {
  const res = await apiFetch('/account/agents', {}, token)
  if (!res.ok) return null
  const agents = await res.json()
  return agents.find((a: any) => a.id === nameOrId || a.name === nameOrId) ?? null
}

// Resolve agent by name or id — fetches all agents and matches
async function resolveAgent(nameOrId: string, token: string): Promise<any> {
  const agent = await findHostedAgent(nameOrId, token)
  if (!agent) {
    console.error(`Agent not found: ${nameOrId}`)
    process.exit(1)
  }
  return agent
}

async function getSolBalance(walletAddress: string): Promise<number> {
  const solRes = await fetch(DEVNET_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [walletAddress, { commitment: 'confirmed' }] })
  })
  const solData = await solRes.json()
  return (solData.result?.value ?? 0) / LAMPORTS_PER_SOL
}

let cachedSolPrice: { usd: number; fetchedAt: number } | null = null

async function solToUsd(sol: number): Promise<number> {
  const now = Date.now()
  if (cachedSolPrice && now - cachedSolPrice.fetchedAt < 60_000) return sol * cachedSolPrice.usd
  const res = await fetch(`https://api.jup.ag/price/v3?ids=${SOL_MINT}`)
  const data = await res.json() as any
  const price = data[SOL_MINT]?.usdPrice ?? 0
  cachedSolPrice = { usd: price, fetchedAt: now }
  return sol * price
}

export async function agentList() {
  const token = await requireAuth()
  const res = await apiFetch('/account/agents', {}, token)
  if (!res.ok) {
    console.error('Failed to fetch agents')
    process.exit(1)
  }
  const agents = await res.json()
  if (agents.length === 0) {
    console.log('No agents found. Run `agentis agent create <name>` to create one.')
    return
  }
  console.log()
  for (const a of agents) {
    console.log(`  ${a.name.padEnd(20)} ${a.walletAddress}  [${a.id}]`)
  }
  console.log()
}

export async function agentCreate(args: string[] | string | undefined) {
  const parts = Array.isArray(args) ? args : args ? [args] : []
  const name = parts.find(part => !part.startsWith('--'))
  const policyMode = parts.includes('--onchain-policy') || parts.includes('--policy-onchain')
    ? 'onchain'
    : 'backend'

  if (!name) {
    console.error('Usage: agentis agent create <name> [--onchain-policy]')
    process.exit(1)
  }
  const token = await requireAuth()
  const res = await apiFetch('/account/agents', {
    method: 'POST',
    body: JSON.stringify({ name, policyMode }),
  }, token)
  if (!res.ok) {
    const data = await res.json()
    console.error('Failed to create agent:', data.error ?? res.statusText)
    process.exit(1)
  }
  const agent = await res.json()
  console.log(`\nAgent created`)
  console.log(`  Name:    ${agent.name}`)
  console.log(`  ID:      ${agent.id}`)
  console.log(`  Wallet:  ${agent.walletAddress}`)
  console.log(`  Policy:  ${agent.policyMode ?? 'backend'}${agent.onchainPolicy?.initialized ? ' (initialized)' : agent.policyMode === 'onchain' ? ' (pending init)' : ''}`)
  console.log(`  API Key: ${agent.apiKey}\n`)
}

export async function agentBalance(nameOrId: string | undefined) {
  if (!nameOrId) {
    console.error('Usage: agentis agent balance <name-or-id>')
    process.exit(1)
  }
  const token = await getToken()
  const hosted = token ? await findHostedAgent(nameOrId, token) : null
  const local = hosted ? null : loadLocalWalletByNameOrId(nameOrId)
  const walletAddress = hosted?.walletAddress ?? local?.solanaAddress
  const name = hosted?.name ?? local?.name

  if (!walletAddress || !name) {
    console.error(`Agent or local wallet not found: ${nameOrId}`)
    process.exit(1)
  }

  const KNOWN_TOKENS: Record<string, string> = {
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'USDC',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
    '2u1tszSeqaGNBXyMBCBMHXHNsJL83PbkSbB5CmEZi69W': 'USDG',
  }

  const solBalance = await getSolBalance(walletAddress)

  // Token balances
  const tokenRes = await fetch(DEVNET_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getTokenAccountsByOwner', params: [walletAddress, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }] })
  })
  const tokenData = await tokenRes.json()
  const tokens = (tokenData.result?.value ?? [])
    .map((acc: any) => {
      const info = acc.account.data.parsed.info
      return { symbol: KNOWN_TOKENS[info.mint] ?? info.mint.slice(0, 8) + '...', uiAmount: info.tokenAmount.uiAmount ?? 0 }
    })
    .filter((t: any) => t.uiAmount > 0)

  console.log(`\nBalances for ${name} (${walletAddress})${local ? ' [local]' : ''}:`)
  console.log(`  SOL     ${solBalance.toFixed(6)}`)
  for (const t of tokens) {
    console.log(`  ${t.symbol.padEnd(6)}  ${t.uiAmount}`)
  }
  console.log()
}

async function sendLocalSol(nameOrId: string, to: string, amountSol: number, displayAmount: string) {
  const wallet = loadLocalWalletByNameOrId(nameOrId)
  if (!wallet) {
    console.error(`Agent or local wallet not found: ${nameOrId}`)
    process.exit(1)
  }

  const amountUsd = await solToUsd(amountSol)
  try {
    checkPolicy({ ...wallet.policy, allowedDomains: [] }, amountUsd, `solana:${to}`, wallet.spendHistory)
  } catch (err: any) {
    console.error('Policy rejected:', err?.message ?? String(err))
    process.exit(1)
  }

  const signer = await getLocalWalletSigner(wallet)
  const rpc = createSolanaRpc(devnet(DEVNET_RPC))
  const rpcSubscriptions = createSolanaRpcSubscriptions(devnet(DEVNET_WS))
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send()

  const transactionMessage = pipe(
    createTransactionMessage({ version: 'legacy' }),
    m => setTransactionMessageFeePayerSigner(signer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    m => appendTransactionMessageInstruction(
      getTransferSolInstruction({
        source: signer,
        destination: address(to),
        amount: BigInt(Math.round(amountSol * LAMPORTS_PER_SOL)),
      }),
      m,
    ),
  )

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage)
  await sendAndConfirm(signedTransaction as any, { commitment: 'confirmed' })
  const signature = getSignatureFromTransaction(signedTransaction)

  recordLocalSpend(wallet, {
    amount: amountUsd,
    timestamp: new Date().toISOString(),
    url: `solana:${to}`,
  })

  console.log(`\nSent from local wallet ${wallet.name}!`)
  console.log(`  Amount:    ${displayAmount}`)
  console.log(`  Signature: ${signature}`)
  console.log(`  Explorer:  https://explorer.solana.com/tx/${signature}?cluster=devnet\n`)
}

export async function agentSend(args: string[]) {
  // agentis agent send <name-or-id> <to> <amount> [--sol] [--token <mint>]
  if (args.length < 3) {
    console.error('Usage: agentis agent send <name-or-id> <to> <amount> [--sol] [--token <mint>]')
    process.exit(1)
  }

  const [nameOrId, to, amountStr, ...flags] = args
  const isSol = flags.includes('--sol')
  const tokenIdx = flags.indexOf('--token')
  const tokenMint = tokenIdx !== -1 ? flags[tokenIdx + 1] : null
  const rawAmount = parseFloat(amountStr)

  if (isNaN(rawAmount) || rawAmount <= 0) {
    console.error('Invalid amount')
    process.exit(1)
  }

  // Convert to SOL for the backend
  let amountSol: number
  const displayAmount = isSol ? `${rawAmount} SOL` : `${rawAmount} lamports`
  if (tokenMint) {
    // SPL token send — needs separate handling
    console.error('SPL token send not yet supported via CLI')
    process.exit(1)
  } else if (isSol) {
    amountSol = rawAmount
  } else {
    // lamports
    amountSol = rawAmount / 1_000_000_000
  }

  const token = await getToken()
  const agent = token ? await findHostedAgent(nameOrId, token) : null

  if (!agent) {
    console.log(`\nSending ${displayAmount} to ${to} from local wallet...`)
    await sendLocalSol(nameOrId, to, amountSol, displayAmount)
    return
  }

  console.log(`\nSending ${displayAmount} to ${to} from hosted agent...`)

  const res = await apiFetch(`/agents/${agent.id}/send`, {
    method: 'POST',
    body: JSON.stringify({ to, amountSol }),
  }, token)

  if (!res.ok) {
    const data = await res.json()
    console.error('Send failed:', data.error ?? res.statusText)
    process.exit(1)
  }

  const data = await res.json()
  console.log(`\nSent!`)
  console.log(`  Signature: ${data.signature}`)
  console.log(`  Explorer:  https://explorer.solana.com/tx/${data.signature}?cluster=devnet\n`)
}
