import { Hono } from 'hono'
import { PrivyClient } from '@privy-io/node'
import { address as toAddress } from '@solana/kit'
import { getAgentByApiKey, updateAgent } from '../lib/db'
import { createUmbraClient } from '../lib/umbra-signer'
import { getUmbraRelayer } from '@umbra-privacy/sdk'
import {
  ReadServiceClient,
  decodeBase64ToAesCiphertext,
  decodeBase64ToU256LeBytes,
  decodeBase64ToX25519PublicKey,
  readU128LeFromBytes,
  splitBase64Address,
} from '@umbra-privacy/sdk'
import {
  getEncryptedBalanceQuerierFunction,
  getUserAccountQuerierFunction,
} from '@umbra-privacy/sdk/query'
import { getATAIntoETADirectDepositorFunction } from '@umbra-privacy/sdk/deposit'
import { getETAIntoATAWithdrawerFunction } from '@umbra-privacy/sdk/withdrawal'
import {
  getETAIntoReceiverBurnableStealthPoolNoteCreatorFunction,
  getETAIntoSelfBurnableStealthPoolNoteCreatorFunction,
} from '@umbra-privacy/sdk/deposit'
import {
  getBurnableStealthPoolNoteScannerFunction,
  getReceiverBurnableStealthPoolNoteIntoETABurnerFunction,
  getSelfBurnableStealthPoolNoteIntoETABurnerFunction,
} from '@umbra-privacy/sdk/burn'
import {
  getNodeClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getNodeCreateStealthPoolNoteFromEncryptedBalanceProver,
} from '../lib/node-prover'
import {
  registerPrivyWalletWithUmbra,
  repairPrivyWalletUmbraMintKey,
} from '../lib/umbra-registration'

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
const DEVNET_DUSDC_MINT = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7'
const DEVNET_DUSDT_MINT = 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6'
const DEVNET_RELAYER_URL = 'https://relayer.api-devnet.umbraprivacy.com'
const DEVNET_INDEXER_URL = 'https://utxo-indexer.api-devnet.umbraprivacy.com'

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

async function fetchStealthPoolNoteDataForScan(
  client: Awaited<ReturnType<typeof createUmbraClient>>,
  startIndex: bigint,
  endIndex?: bigint,
  limit?: bigint | number,
) {
  const safeStartIndex = startIndex === 0n ? 1n : startIndex
  if (endIndex !== undefined && endIndex < safeStartIndex) {
    return {
      items: new Map(),
      hasMore: false,
      nextCursor: undefined,
      totalCount: 0n,
    }
  }

  void client

  const indexerClient = new ReadServiceClient({ endpoint: DEVNET_INDEXER_URL })
  const response = await indexerClient.getUtxoDataColumnar({
    start: safeStartIndex,
    end: endIndex,
    limit: limit === undefined ? undefined : BigInt(limit),
  })
  const cols = response.columns
  const rowCount = cols !== null ? cols.absolute_index.length : 0
  const items = new Map()
  const decodeU128Base64 = (value: string) =>
    BigInt(readU128LeFromBytes(Uint8Array.from(Buffer.from(value, 'base64'))))

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const senderAddress = splitBase64Address(cols.h1_sender_address[rowIndex])
    const mintAddress = splitBase64Address(cols.h1_mint_address[rowIndex])
    const item = {
      absoluteIndex: cols.absolute_index[rowIndex],
      treeIndex: cols.tree_index[rowIndex],
      insertionIndex: cols.insertion_index[rowIndex],
      finalCommitment: decodeBase64ToU256LeBytes(cols.final_commitment[rowIndex]),
      h1Components: {
        version: decodeU128Base64(cols.h1_version[rowIndex]),
        commitmentIndex: decodeU128Base64(cols.h1_commitment_index[rowIndex]),
        senderAddressLow: senderAddress.low,
        senderAddressHigh: senderAddress.high,
        relayerFixedSolFees: BigInt(cols.h1_relayer_fixed_sol_fees[rowIndex]),
        mintAddressLow: mintAddress.low,
        mintAddressHigh: mintAddress.high,
        timestamp: {
          year: cols.h1_year[rowIndex],
          month: cols.h1_month[rowIndex],
          day: cols.h1_day[rowIndex],
          hour: cols.h1_hour[rowIndex],
          minute: cols.h1_minute[rowIndex],
          second: cols.h1_second[rowIndex],
        },
        poolVolumeSpl: BigInt(cols.h1_pool_volume_spl[rowIndex]),
        poolVolumeSol: BigInt(cols.h1_pool_volume_sol[rowIndex]),
      },
      h1Hash: decodeBase64ToU256LeBytes(cols.h1_hash[rowIndex]),
      h2Hash: decodeBase64ToU256LeBytes(cols.h2_hash[rowIndex]),
      aesEncryptedData: decodeBase64ToAesCiphertext(cols.aes_encrypted_data[rowIndex]),
      depositorX25519PublicKey: decodeBase64ToX25519PublicKey(cols.depositor_x25519_public_key[rowIndex]),
      timestamp: cols.timestamp[rowIndex],
      slot: cols.slot[rowIndex],
      eventType: cols.event_type[rowIndex],
    }
    items.set(cols.insertion_index[rowIndex], item)
  }

  return {
    items,
    hasMore: response.has_more,
    nextCursor: response.next_cursor ?? undefined,
    totalCount: response.total_count,
  }
}

function createScanOnlyUmbraClient(client: Awaited<ReturnType<typeof createUmbraClient>>) {
  return {
    ...(client as any),
    // The RC scanner runs a user-account key consistency assertion before it
    // decrypts indexer notes. Scanning is read-only and must not be blocked by
    // repair/rotation state; state-changing operations still use the real client.
    accountInfoProvider: async () => new Map(),
  } as typeof client
}

async function ensureUmbraMintKey(agent: NonNullable<Agent>, mint: string) {
  try {
    return await repairPrivyWalletUmbraMintKey(
      privyNode,
      agent.walletId,
      agent.walletAddress,
      mint,
    )
  } catch (err: any) {
    // Freshly-created agents or already-consistent accounts should not be blocked
    // by a best-effort repair path. The underlying Umbra operation will still fail
    // with a precise error if the key mismatch remains.
    if (
      typeof err?.message === 'string' &&
      err.message.toLowerCase().includes('does not match')
    ) {
      throw err
    }

    console.warn('[umbra/repair-mint-key] skipped', err)
    return null
  }
}

// GET /umbra/status — direct Umbra on-chain account status for this agent wallet
umbra.get('/status', async (c) => {
  const agent = c.get('agent')

  try {
    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const queryUser = getUserAccountQuerierFunction({ client })
    const result = await queryUser(toAddress(agent.walletAddress))
    const safeResult = toJsonSafe(result) as Record<string, unknown>
    const data = (safeResult.data && typeof safeResult.data === 'object')
      ? safeResult.data as Record<string, unknown>
      : {}
    const state = typeof safeResult.state === 'string' ? safeResult.state : 'unknown'
    const isInitialised = Boolean(data.isInitialised)
    const isActiveForAnonymousUsage = Boolean(data.isActiveForAnonymousUsage)
    const isUserCommitmentRegistered = Boolean(data.isUserCommitmentRegistered)
    const isUserAccountX25519KeyRegistered = Boolean(data.isUserAccountX25519KeyRegistered)

    return c.json({
      walletAddress: agent.walletAddress,
      agentis: {
        privacyEnabled: agent.privacyEnabled ?? false,
        umbraStatus: agent.umbraStatus ?? (agent.privacyEnabled ? 'pending' : 'disabled'),
        umbraRegisteredAt: agent.umbraRegisteredAt ?? null,
      },
      umbra: {
        state,
        isInitialised,
        isActiveForAnonymousUsage,
        isUserCommitmentRegistered,
        isUserAccountX25519KeyRegistered,
        generationIndex: data.generationIndex ?? null,
      },
      isRegistered: Boolean(
        isInitialised &&
        isUserAccountX25519KeyRegistered &&
        isUserCommitmentRegistered
      ),
      isAnonymousReady: isActiveForAnonymousUsage,
    })
  } catch (err: any) {
    console.error('[umbra/status]', err)
    return c.json({ error: err?.message ?? 'Status query failed' }, 500)
  }
})

// POST /umbra/register — register the agent's server-side Privy wallet with Umbra
umbra.post('/register', async (c) => {
  const agent = c.get('agent')

  try {
    const body: RegisterBody = await c.req.json<RegisterBody>().catch(() => ({}))
    const confidential = body.confidential ?? true
    const anonymous = body.anonymous ?? true

    const result = await registerPrivyWalletWithUmbra(privyNode, agent.walletId, agent.walletAddress, {
      confidential,
      anonymous,
    })

    await updateAgent(agent.id, {
      privacyEnabled: true,
      umbraStatus: 'registered',
      umbraRegisteredAt: new Date().toISOString(),
      umbraRegistrationSignatures: result.signatures,
      umbraError: '',
    })

    return c.json(result)
  } catch (err: any) {
    console.error('[umbra/register]', err)
    await updateAgent(agent.id, {
      privacyEnabled: true,
      umbraStatus: 'failed',
      umbraError: err?.message ?? 'Registration failed',
    })
    return c.json({ error: err?.message ?? 'Registration failed' }, 500)
  }
})

umbra.post('/repair-key', async (c) => {
  const agent = c.get('agent')

  try {
    const body: AmountBody = await c.req.json<AmountBody>().catch(() => ({}))
    const mint = body.mint ?? DEVNET_MINT
    const result = await repairPrivyWalletUmbraMintKey(
      privyNode,
      agent.walletId,
      agent.walletAddress,
      mint,
    )

    return c.json(result)
  } catch (err: any) {
    console.error('[umbra/repair-key]', err)
    return c.json({ error: err?.message ?? 'Umbra key repair failed' }, 500)
  }
})

umbra.post('/deposit', async (c) => {
  const agent = c.get('agent')

  try {
    const body: AmountBody = await c.req.json<AmountBody>().catch(() => ({}))
    const mint = body.mint ?? DEVNET_MINT
    const amount = parseAmount(body.amount, 1_000_000n)

    await ensureUmbraMintKey(agent, mint)
    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const deposit = getATAIntoETADirectDepositorFunction({ client })
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
    await ensureUmbraMintKey(agent, mint)
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

    await ensureUmbraMintKey(agent, mint)
    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const withdraw = getETAIntoATAWithdrawerFunction({ client })
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
    const amount = parseAmount(body.amount, 10_000_000n)
    const to = body.to ?? agent.walletAddress

    await ensureUmbraMintKey(agent, mint)
    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const zkProver = getNodeCreateStealthPoolNoteFromEncryptedBalanceProver() as any
    const createUtxo = to === agent.walletAddress
      ? getETAIntoSelfBurnableStealthPoolNoteCreatorFunction({ client }, { zkProver })
      : getETAIntoReceiverBurnableStealthPoolNoteCreatorFunction({ client }, { zkProver })
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
    const scanClient = createScanOnlyUmbraClient(client)
    const scan = getBurnableStealthPoolNoteScannerFunction(
      { client: scanClient },
      {
        fetchStealthPoolNoteData: (startIndex, endIndex, limit) =>
          fetchStealthPoolNoteDataForScan(client, startIndex, endIndex, limit),
      }
    )
    const result = await scan()

    return c.json({
      walletAddress: agent.walletAddress,
      counts: {
        received: result.etaToStealthPoolReceiverBurnable.length,
        selfBurnable: result.etaToStealthPoolSelfBurnable.length,
        publicSelfBurnable:
          result.ataToStealthPoolSelfBurnable.length +
          result.networkBalanceToStealthPoolSelfBurnableWithEncryptedAddress.length,
        publicReceived:
          result.ataToStealthPoolReceiverBurnable.length +
          result.networkBalanceToStealthPoolReceiverBurnableWithEncryptedAddress.length,
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
    await ensureUmbraMintKey(agent, DEVNET_MINT)
    const client = await createUmbraClient(privyNode, agent.walletId, agent.walletAddress)
    const scanClient = createScanOnlyUmbraClient(client)
    const trackedMints = [DEVNET_MINT, DEVNET_DUSDC_MINT, DEVNET_DUSDT_MINT]
    const beforeBalances = Object.fromEntries(
      await Promise.all(trackedMints.map(async (mint) => [mint, await getEncryptedBalanceValue(client, mint)]))
    )
    const scan = getBurnableStealthPoolNoteScannerFunction(
      { client: scanClient },
      {
        fetchStealthPoolNoteData: (startIndex, endIndex, limit) =>
          fetchStealthPoolNoteDataForScan(client, startIndex, endIndex, limit),
      }
    )
    const result = await scan()
    const receiverClaimables = [
      ...result.etaToStealthPoolReceiverBurnable,
      ...result.ataToStealthPoolReceiverBurnable,
      ...result.networkBalanceToStealthPoolReceiverBurnableWithEncryptedAddress,
    ].reverse()
    const selfClaimables = [
      ...result.etaToStealthPoolSelfBurnable,
      ...result.ataToStealthPoolSelfBurnable,
      ...result.networkBalanceToStealthPoolSelfBurnableWithEncryptedAddress,
    ].reverse()
    const claimables = [
      ...receiverClaimables.map((claimable) => ({ kind: 'receiver' as const, claimable })),
      ...selfClaimables.map((claimable) => ({ kind: 'self' as const, claimable })),
    ]

    if (claimables.length === 0) {
      return c.json({ error: 'No burnable UTXOs to claim' }, 400)
    }

    const relayer = getUmbraRelayer({
      apiEndpoint: DEVNET_RELAYER_URL,
    })
    const burnRelayer = {
      ...relayer,
      submitBurn: relayer.submitClaim,
      pollBurnStatus: relayer.pollClaimStatus,
    } as any
    const claimReceiver = getReceiverBurnableStealthPoolNoteIntoETABurnerFunction(
      { client },
      {
        zkProver: getNodeClaimReceiverClaimableUtxoIntoEncryptedBalanceProver() as any,
        relayer: burnRelayer,
        fetchBatchMerkleProof: (client as any).fetchBatchMerkleProof,
      }
    )
    const claimSelf = getSelfBurnableStealthPoolNoteIntoETABurnerFunction(
      { client },
      {
        zkProver: getNodeClaimReceiverClaimableUtxoIntoEncryptedBalanceProver() as any,
        relayer: burnRelayer,
        fetchBatchMerkleProof: (client as any).fetchBatchMerkleProof,
      }
    )

    const attemptedEntries: [string, unknown][] = []
    let anySucceeded = false
    let skippedAlreadyClaimed = 0
    let claimedKind: 'receiver' | 'self' | null = null

    for (const entry of claimables) {
      const claim = entry.kind === 'receiver' ? claimReceiver : claimSelf
      const claimResult = await claim([entry.claimable as any])
      const entries = claimResult.batches instanceof Map
        ? [...claimResult.batches.entries()]
        : Object.entries(claimResult.batches)
      const safeEntries = toJsonSafe(entries) as [string, Record<string, unknown>][]
      attemptedEntries.push(...safeEntries)

      const batchPayloads = safeEntries.map(([, payload]) => payload)
      anySucceeded = batchPayloads.some((payload) =>
        payload?.status === 'success' || payload?.status === 'completed'
      )
      const alreadyClaimed = batchPayloads.length > 0 && batchPayloads.every((payload) =>
        payload?.status === 'failed' &&
        typeof payload?.failureReason === 'string' &&
        payload.failureReason.includes('NullifierAlreadyBurnt')
      )

      if (anySucceeded) {
        claimedKind = entry.kind
        break
      }
      if (alreadyClaimed) {
        skippedAlreadyClaimed += 1
        continue
      }
      break
    }

    const afterBalances = Object.fromEntries(
      await Promise.all(trackedMints.map(async (mint) => [mint, await getEncryptedBalanceValue(client, mint)]))
    )
    const balanceDeltas = Object.fromEntries(
      trackedMints.map((mint) => {
        const before = beforeBalances[mint]?.balance ? BigInt(beforeBalances[mint].balance) : 0n
        const after = afterBalances[mint]?.balance ? BigInt(afterBalances[mint].balance) : 0n
        return [mint, (after - before).toString()]
      })
    )
    const safeEntries = attemptedEntries as [string, Record<string, unknown>][]
    const allAlreadyClaimed = !anySucceeded && skippedAlreadyClaimed === claimables.length

    console.log('[umbra/claim-latest] batches', safeEntries)
    console.log('[umbra/claim-latest] encrypted balance deltas', balanceDeltas)

    return c.json({
      walletAddress: agent.walletAddress,
      success: anySucceeded || Object.values(balanceDeltas).some((delta) => BigInt(delta) > 0n),
      claimedKind,
      alreadyClaimed: allAlreadyClaimed,
      skippedAlreadyClaimed,
      balanceBefore: toJsonSafe(beforeBalances),
      balanceAfter: toJsonSafe(afterBalances),
      balanceDeltas,
      batches: safeEntries,
    })
  } catch (err: any) {
    console.error('[umbra/claim-latest]', err)
    return c.json({ error: err?.message ?? 'Claim failed' }, 500)
  }
})

export default umbra
