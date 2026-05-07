import { Connection, Transaction } from '@solana/web3.js'
import { getAgentById, recordTransaction } from '../src/lib/db'
import { confirmTransactionOrThrow, preparePrivyTransaction } from '../src/lib/onchain-policy'
import { privy } from '../src/lib/privy'

const AGENT_ID = 'a6acdc00-ad16-4e9b-859c-490cf93a91c4'
const MAINNET_RPC = process.env.MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
const MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const JUPITER_LEND_API = 'https://api.jup.ag/lend/v1'
const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

function atomicToUiString(amount: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals)
  const whole = amount / base
  const fraction = amount % base
  if (fraction === 0n) return whole.toString()
  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

async function jupiterFetch(path: string, init?: RequestInit) {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (process.env.JUPITER_API_KEY) headers['x-api-key'] = process.env.JUPITER_API_KEY

  const res = await fetch(`${JUPITER_LEND_API}${path}`, { ...init, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.message ?? data.error ?? JSON.stringify(data))
  }
  return data
}

async function main() {
  const agent = await getAgentById(AGENT_ID)
  if (!agent) throw new Error(`Agent not found: ${AGENT_ID}`)
  if (agent.name !== 'leno') throw new Error(`Refusing to run for unexpected agent: ${agent.name}`)

  const positions = await jupiterFetch(`/earn/positions?users=${agent.walletAddress}`)
  const usdcPosition = Array.isArray(positions)
    ? positions.find((position) => position?.token?.assetAddress === USDC_MAINNET_MINT)
    : null

  const shares = BigInt(usdcPosition?.shares ?? 0)
  const underlying = BigInt(usdcPosition?.underlyingAssets ?? 0)
  if (shares <= 0n || underlying <= 0n) {
    console.log('No leno USDC Jupiter Earn position to redeem.')
    return
  }

  console.log(`Redeeming ${atomicToUiString(underlying)} USDC from ${shares.toString()} jlUSDC shares`)
  console.log(`Wallet: ${agent.walletAddress}`)

  const data = await jupiterFetch('/earn/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      asset: USDC_MAINNET_MINT,
      signer: agent.walletAddress,
      shares: shares.toString(),
    }),
  })

  if (!data.transaction) {
    throw new Error(`Jupiter redeem response missing transaction: ${JSON.stringify(data)}`)
  }

  const connection = new Connection(MAINNET_RPC, 'confirmed')
  const tx = await preparePrivyTransaction(
    connection,
    agent.walletAddress,
    Transaction.from(Buffer.from(String(data.transaction), 'base64')),
  )

  const result = await privy.walletApi.solana.signAndSendTransaction({
    walletId: agent.walletId,
    transaction: tx,
    caip2: MAINNET_CAIP2,
  })
  await confirmTransactionOrThrow(connection, result.hash, tx)

  await recordTransaction(agent.id, {
    txHash: result.hash,
    amount: Number(atomicToUiString(underlying)),
    amountUsd: Number(atomicToUiString(underlying)),
    recipient: `jupiter-earn-redeem:${USDC_MAINNET_MINT}`,
    timestamp: new Date().toISOString(),
  })

  console.log(`Redeemed to leno wallet: ${result.hash}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
