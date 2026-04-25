import { Hono } from 'hono'
import { PrivyClient } from '@privy-io/node'
import { address as toAddress } from '@solana/kit'
import { getAgentByApiKey } from '../lib/db'
import { createUmbraClient } from '../lib/umbra-signer'
import {
  getClaimableUtxoScannerFunction,
  getEncryptedBalanceQuerierFunction,
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getPublicBalanceToReceiverClaimableUtxoCreatorFunction,
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getUmbraRelayer,
  getUserRegistrationFunction,
} from '@umbra-privacy/sdk'
import {
  getNodeClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getNodeCreateReceiverClaimableUtxoFromPublicBalanceProver,
  getNodeRegistrationProver,
} from '../lib/node-prover'

const privyNode = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
})

type Agent = Awaited<ReturnType<typeof getAgentByApiKey>>

const umbra = new Hono<{ Variables: { agent: NonNullable<Agent> } }>()

// Middleware: API key auth
umbra.use('*', async (c, next) => {
  const apiKey = c.req.header('x-api-key')
  if (!apiKey?.startsWith('agt_live_')) {
    return c.json({ error: 'Missing or invalid API key' }, 401)
  }
  const agent = await getAgentByApiKey(apiKey)
  if (!agent) return c.json({ error: 'Invalid API key' }, 401)
  c.set('agent', agent)
  await next()
})

type RegisterBody = {
  confidential?: boolean
  anonymous?: boolean
}

type AmountBody = {
  mint?: string
  amount?: string | number
}

type CreateUtxoBody = AmountBody & {
  to?: string
}

const DEVNET_MINT = 'So11111111111111111111111111111111111111112'
const DEVNET_RELAYER_URL = 'https://relayer.api-devnet.umbraprivacy.com'

function parseAmount(value: string | number | undefined, fallback: bigint) {
  if (value === undefined) return fallback
  return BigInt(value)
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (value instanceof Uint8Array) {
    return Array.from(value)
  }

  if (Array.isArray(value)) {
    return value.map(toJsonSafe)
  }

  if (value instanceof Map) {
    return [...value.entries()].map(([key, entryValue]) => [key, toJsonSafe(entryValue)])
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, toJsonSafe(entryValue)])
    )
  }

  return value
}

async function getEncryptedBalanceValue(client: Awaited<ReturnType<typeof createUmbraClient>>, mint: string) {
  const queryBalance = getEncryptedBalanceQuerierFunction({ client })
  const balances = await queryBalance([toAddress(mint)])
  const result = balances.get(toAddress(mint))

  if (!result || result.state !== 'shared') {
    return {
      state: result?.state ?? 'non_existent',
      balance: null as string | null,
      raw: result ?? null,
    }
  }

  return {
    state: result.state,
    balance: result.balance.toString(),
    raw: result,
  }
}

// POST /umbra/register — register the agent's server-side Privy wallet with Umbra
umbra.post('/register', async (c) => {
  const agent = c.get('agent')

  try {
    const body: RegisterBody = await c.req.json<RegisterBody>().catch(() => ({}))
    const confidential = body.confidential ?? true
    const anonymous = body.anonymous ?? true

    console.log('[umbra/register] start', {
      walletAddress: agent.walletAddress,
      confidential,
      anonymous,
    })

    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const deps = anonymous ? ({ zkProver: getNodeRegistrationProver() } as any) : undefined
    const register = getUserRegistrationFunction({ client }, deps)
    const signatures = await register({
      confidential,
      anonymous,
      callbacks: {
        userAccountInitialisation: {
          pre: async () => {
            console.log('[umbra/register] userAccountInitialisation pre')
          },
          post: async (_tx: any, signature: string) => {
            console.log('[umbra/register] userAccountInitialisation post', signature)
          },
        },
        registerX25519PublicKey: {
          pre: async () => {
            console.log('[umbra/register] registerX25519PublicKey pre')
          },
          post: async (_tx: any, signature: string) => {
            console.log('[umbra/register] registerX25519PublicKey post', signature)
          },
        },
        registerUserForAnonymousUsage: {
          pre: async () => {
            console.log('[umbra/register] registerUserForAnonymousUsage pre')
          },
          post: async (_tx: any, signature: string) => {
            console.log('[umbra/register] registerUserForAnonymousUsage post', signature)
          },
        },
      },
    })

    console.log('[umbra/register] done', { signatures })

    return c.json({
      walletAddress: agent.walletAddress,
      confidential,
      anonymous,
      signatures,
    })
  } catch (err: any) {
    console.error('[umbra/register]', err)
    return c.json({ error: err?.message ?? 'Registration failed' }, 500)
  }
})

umbra.post('/deposit', async (c) => {
  const agent = c.get('agent')

  try {
    const body: AmountBody = await c.req.json<AmountBody>().catch(() => ({}))
    const mint = body.mint ?? DEVNET_MINT
    const amount = parseAmount(body.amount, 1_000_000n)

    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const deposit = getPublicBalanceToEncryptedBalanceDirectDepositorFunction({ client })
    const result = await deposit(toAddress(agent.walletAddress), toAddress(mint), amount as any)

    return c.json({
      walletAddress: agent.walletAddress,
      mint,
      amount: amount.toString(),
      ...result,
    })
  } catch (err: any) {
    console.error('[umbra/deposit]', err)
    return c.json({ error: err?.message ?? 'Deposit failed' }, 500)
  }
})

umbra.get('/balance', async (c) => {
  const agent = c.get('agent')

  try {
    const mint = c.req.query('mint') ?? DEVNET_MINT
    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const result = await getEncryptedBalanceValue(client, mint)

    return c.json({
      walletAddress: agent.walletAddress,
      mint,
      result: toJsonSafe(result.raw),
      balance: result.balance,
      state: result.state,
    })
  } catch (err: any) {
    console.error('[umbra/balance]', err)
    return c.json({ error: err?.message ?? 'Balance query failed' }, 500)
  }
})

umbra.post('/withdraw', async (c) => {
  const agent = c.get('agent')

  try {
    const body: AmountBody = await c.req.json<AmountBody>().catch(() => ({}))
    const mint = body.mint ?? DEVNET_MINT
    const amount = parseAmount(body.amount, 1_000_000n)

    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const withdraw = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({ client })
    const result = await withdraw(toAddress(agent.walletAddress), toAddress(mint), amount as any)

    return c.json({
      walletAddress: agent.walletAddress,
      mint: toAddress(mint),
      amount: amount.toString(),
      ...result,
    })
  } catch (err: any) {
    console.error('[umbra/withdraw]', err)
    return c.json({ error: err?.message ?? 'Withdraw failed' }, 500)
  }
})

umbra.post('/create-utxo', async (c) => {
  const agent = c.get('agent')

  try {
    const body: CreateUtxoBody = await c.req.json<CreateUtxoBody>().catch(() => ({}))
    const mint = body.mint ?? DEVNET_MINT
    const amount = parseAmount(body.amount, 500_000n)
    const to = body.to ?? agent.walletAddress

    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const createUtxo = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
      { client },
      { zkProver: getNodeCreateReceiverClaimableUtxoFromPublicBalanceProver() as any }
    )
    const result = await createUtxo({
      destinationAddress: toAddress(to),
      mint: toAddress(mint),
      amount: amount as any,
    })

    return c.json({
      walletAddress: agent.walletAddress,
      destinationAddress: to,
      mint,
      amount: amount.toString(),
      ...result,
    })
  } catch (err: any) {
    console.error('[umbra/create-utxo]', err)
    return c.json({ error: err?.message ?? 'Create UTXO failed' }, 500)
  }
})

umbra.get('/scan', async (c) => {
  const agent = c.get('agent')

  try {
    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const scan = getClaimableUtxoScannerFunction({ client })
    const result = await (scan as any)(0n, 0n)

    return c.json({
      walletAddress: agent.walletAddress,
      counts: {
        received: result.received.length,
        selfBurnable: result.selfBurnable.length,
        publicSelfBurnable: result.publicSelfBurnable.length,
        publicReceived: result.publicReceived.length,
      },
    })
  } catch (err: any) {
    console.error('[umbra/scan]', err)
    return c.json({ error: err?.message ?? 'Scan failed' }, 500)
  }
})

umbra.post('/claim-latest', async (c) => {
  const agent = c.get('agent')

  try {
    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const before = await getEncryptedBalanceValue(client, DEVNET_MINT)
    const scan = getClaimableUtxoScannerFunction({ client })
    const result = await (scan as any)(0n, 0n)
    const claimable = result.publicReceived[0]

    if (!claimable) {
      return c.json({ error: 'No publicReceived UTXOs to claim' }, 400)
    }

    const relayer = getUmbraRelayer({
      apiEndpoint: DEVNET_RELAYER_URL,
    })
    const claim = getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
      { client },
      {
        zkProver: getNodeClaimReceiverClaimableUtxoIntoEncryptedBalanceProver() as any,
        relayer,
        fetchBatchMerkleProof: (client as any).fetchBatchMerkleProof,
      }
    )
    const claimResult = await claim([claimable])
    const entries = claimResult.batches instanceof Map
      ? [...claimResult.batches.entries()]
      : Object.entries(claimResult.batches)
    const after = await getEncryptedBalanceValue(client, DEVNET_MINT)
    const beforeBigInt = before.balance ? BigInt(before.balance) : 0n
    const afterBigInt = after.balance ? BigInt(after.balance) : 0n
    const delta = afterBigInt - beforeBigInt
    const safeEntries = toJsonSafe(entries) as [string, Record<string, unknown>][]
    const batchPayloads = safeEntries.map(([, payload]) => payload)
    const anySucceeded = batchPayloads.some((payload) => payload?.status === 'success')
    const allAlreadyClaimed = batchPayloads.length > 0 && batchPayloads.every((payload) =>
      payload?.status === 'failed' &&
      typeof payload?.failureReason === 'string' &&
      payload.failureReason.includes('NullifierAlreadyBurnt')
    )

    console.log('[umbra/claim-latest] batches', safeEntries)
    console.log('[umbra/claim-latest] encrypted balance delta', {
      before: before.balance,
      after: after.balance,
      delta: delta.toString(),
    })

    return c.json({
      walletAddress: agent.walletAddress,
      success: anySucceeded || delta > 0n,
      alreadyClaimed: allAlreadyClaimed,
      balanceBefore: before.balance,
      balanceAfter: after.balance,
      balanceDelta: delta.toString(),
      batches: safeEntries,
    })
  } catch (err: any) {
    console.error('[umbra/claim-latest]', err)
    return c.json({ error: err?.message ?? 'Claim failed' }, 500)
  }
})

export default umbra
