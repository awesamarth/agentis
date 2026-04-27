import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'

type Policy = {
  hourlyLimit: number | null
  dailyLimit: number | null
  monthlyLimit: number | null
  maxBudget: number | null
  maxPerTx: number | null
  allowedDomains: string[]
  killSwitch: boolean
}

type AgentLike = {
  walletAddress: string
  onchainPolicy?: {
    programId: string
    owner: string
    agent: string
    policy: string
    spendCounter: string
    initialized: boolean
  }
}

const DEFAULT_PROGRAM_ID = 'EGZKucpjMmAHvqUP3hLSBCccs4uAQyCAvQ8ikSNCryhM'
export const ONCHAIN_POLICY_PROGRAM_ID = process.env.AGENTIS_POLICY_PROGRAM_ID ?? DEFAULT_PROGRAM_ID

const MICRO_USD = 1_000_000

function u64Le(value: bigint): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(value)
  return buf
}

function usdToMicroUsd(value: number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n
  if (!Number.isFinite(value) || value < 0) return 0n
  return BigInt(Math.round(value * MICRO_USD))
}

export function deriveOnchainPolicy(walletAddress: string) {
  const programId = new PublicKey(ONCHAIN_POLICY_PROGRAM_ID)
  const owner = new PublicKey(walletAddress)
  const agentWallet = owner
  const [agent] = PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), owner.toBuffer(), agentWallet.toBuffer()],
    programId,
  )
  const [policy] = PublicKey.findProgramAddressSync(
    [Buffer.from('policy'), agent.toBuffer()],
    programId,
  )
  const [spendCounter] = PublicKey.findProgramAddressSync(
    [Buffer.from('spend'), agent.toBuffer()],
    programId,
  )

  return {
    programId: programId.toBase58(),
    owner: owner.toBase58(),
    agent: agent.toBase58(),
    policy: policy.toBase58(),
    spendCounter: spendCounter.toBase58(),
    initialized: false,
  }
}

function getPolicyState(agent: AgentLike) {
  return agent.onchainPolicy ?? deriveOnchainPolicy(agent.walletAddress)
}

export function createInitializePolicyInstruction(agent: AgentLike): TransactionInstruction {
  const state = getPolicyState(agent)
  const owner = new PublicKey(state.owner)
  const agentWallet = new PublicKey(agent.walletAddress)

  return new TransactionInstruction({
    programId: new PublicKey(state.programId),
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: agentWallet, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(state.agent), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(state.policy), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(state.spendCounter), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([10]),
  })
}

export function createUpdatePolicyInstruction(agent: AgentLike, policy: Policy): TransactionInstruction {
  const state = getPolicyState(agent)
  const data = Buffer.concat([
    Buffer.from([11, policy.killSwitch ? 1 : 0]),
    u64Le(usdToMicroUsd(policy.maxPerTx)),
    u64Le(usdToMicroUsd(policy.hourlyLimit)),
    u64Le(usdToMicroUsd(policy.dailyLimit)),
    u64Le(usdToMicroUsd(policy.monthlyLimit)),
    u64Le(usdToMicroUsd(policy.maxBudget)),
  ])

  return new TransactionInstruction({
    programId: new PublicKey(state.programId),
    keys: [
      { pubkey: new PublicKey(state.owner), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(agent.walletAddress), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(state.agent), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(state.policy), isSigner: false, isWritable: true },
    ],
    data,
  })
}

export function createCheckAndRecordSpendInstruction(
  agent: AgentLike,
  amountUsd: number,
  unixTimestampSeconds = Math.floor(Date.now() / 1000),
): TransactionInstruction {
  const state = getPolicyState(agent)
  const data = Buffer.concat([
    Buffer.from([12]),
    u64Le(usdToMicroUsd(amountUsd)),
    u64Le(BigInt(unixTimestampSeconds)),
  ])

  return new TransactionInstruction({
    programId: new PublicKey(state.programId),
    keys: [
      { pubkey: new PublicKey(agent.walletAddress), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(state.agent), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(state.policy), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(state.spendCounter), isSigner: false, isWritable: true },
    ],
    data,
  })
}

export async function preparePrivyTransaction(connection: Connection, feePayer: string, tx: Transaction) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')
  tx.recentBlockhash = blockhash
  tx.lastValidBlockHeight = lastValidBlockHeight
  tx.feePayer = new PublicKey(feePayer)
  return tx
}

export async function confirmTransactionOrThrow(
  connection: Connection,
  signature: string,
  tx: Transaction,
) {
  if (!tx.recentBlockhash || tx.lastValidBlockHeight === undefined) {
    throw new Error('Cannot confirm transaction without blockhash metadata')
  }

  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash: tx.recentBlockhash,
    lastValidBlockHeight: tx.lastValidBlockHeight,
  }, 'finalized')

  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
  }
}

export function formatSolanaTransactionError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)

  if (
    message.includes('Attempt to debit an account but found no record of a prior credit') ||
    message.includes('insufficient lamports') ||
    message.includes('InsufficientFundsForFee')
  ) {
    return 'Agent wallet has no SOL yet. Add funds to the agent, then try again.'
  }

  if (message.includes('custom program error: 0x1')) {
    return 'Policy rejected: kill switch is active.'
  }

  if (message.includes('custom program error: 0x2')) {
    return 'Policy rejected: exceeds max per-transaction limit.'
  }

  if (message.includes('custom program error: 0x3')) {
    return 'Policy rejected: hourly spend limit exceeded.'
  }

  if (message.includes('custom program error: 0x4')) {
    return 'Policy rejected: daily spend limit exceeded.'
  }

  if (message.includes('custom program error: 0x5')) {
    return 'Policy rejected: monthly spend limit exceeded.'
  }

  if (message.includes('custom program error: 0x6')) {
    return 'Policy rejected: lifetime budget exceeded.'
  }

  return message
}

function readU64(data: Buffer, offset: number): string {
  return data.readBigUInt64LE(offset).toString()
}

export async function readOnchainPolicy(connection: Connection, agent: AgentLike) {
  const state = getPolicyState(agent)
  const [policyAccount, counterAccount] = await Promise.all([
    connection.getAccountInfo(new PublicKey(state.policy), 'confirmed'),
    connection.getAccountInfo(new PublicKey(state.spendCounter), 'confirmed'),
  ])

  const result: any = {
    ...state,
    policyPda: state.policy,
    spendCounterPda: state.spendCounter,
    exists: Boolean(policyAccount && counterAccount),
  }

  if (policyAccount?.data) {
    const data = Buffer.from(policyAccount.data)
    result.policyConfig = {
      killSwitch: data[65] === 1,
      maxPerTxMicroUsd: readU64(data, 66),
      hourlyLimitMicroUsd: readU64(data, 74),
      dailyLimitMicroUsd: readU64(data, 82),
      monthlyLimitMicroUsd: readU64(data, 90),
      maxBudgetMicroUsd: readU64(data, 98),
      bump: data[106],
    }
  }

  if (counterAccount?.data) {
    const data = Buffer.from(counterAccount.data)
    result.spendCounterState = {
      hourWindow: readU64(data, 33),
      dayWindow: readU64(data, 41),
      monthWindow: readU64(data, 49),
      hourSpentMicroUsd: readU64(data, 57),
      daySpentMicroUsd: readU64(data, 65),
      monthSpentMicroUsd: readU64(data, 73),
      totalSpentMicroUsd: readU64(data, 81),
      bump: data[89],
    }
  }

  return result
}
