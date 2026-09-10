import { Connection, PublicKey } from '@solana/web3.js'
import { getBase58Decoder } from '@solana/kit'
import { getTokenSize } from '@solana-program/token'
import { assertSolanaTransfer, buildSolanaTransfer, encodeTransaction, decodeTransaction, solanaDevnet, solanaUsdc } from '@agentis-hq/core/solana-transfer'
import type { OperationInput, Operation } from '@agentis-hq/core/operations'

export { solanaDevnet, solanaUsdc }
export function solanaConnection(rpcUrl = process.env.SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com') {
  return new Connection(rpcUrl, { commitment: 'confirmed', fetch: ((url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => fetch(url, { ...options, signal: AbortSignal.timeout(15_000) })) as typeof fetch })
}
async function checkedConnection() {
  const connection = solanaConnection()
  if (!(await connection.getGenesisHash()).startsWith(solanaDevnet.slice(7))) throw new Error('RPC is not Solana devnet')
  return connection
}
export async function prepareSolanaTransfer(from: string, input: OperationInput) {
  const connection = await checkedConnection()
  const latest = await connection.getLatestBlockhash()
  const transaction = await buildSolanaTransfer(from, input, latest.blockhash)
  const fee = (await connection.getFeeForMessage(transaction.compileMessage())).value
  if (fee === null) throw new Error('Unable to quote Solana fee')
  const rent = input.asset === 'native' ? 0n : BigInt(await connection.getMinimumBalanceForRentExemption(getTokenSize()))
  // Reserve possible ATA rent even if it exists now: it may close before execution.
  if (BigInt(fee) + rent > BigInt(input.maxFeeAtomic)) throw new Error('Solana fee and account-rent budget is too small')
  const needed = BigInt(fee) + rent + (input.asset === 'native' ? BigInt(input.amountAtomic) : 0n)
  if (BigInt(await connection.getBalance(new PublicKey(from))) < needed) throw new Error('Fund the hosted wallet with devnet SOL first')
  return { method: 'signTransaction', params: { encoding: 'base64', transaction: encodeTransaction(await transaction.serialize({ requireAllSignatures: false, verifySignatures: false })) } }
}
export async function verifySolanaTransfer(from: string, input: OperationInput, signed: string, unsigned: string) {
  const connection = await checkedConnection()
  const actual = await assertSolanaTransfer(from, input, signed)
  const expected = await assertSolanaTransfer(from, input, unsigned)
  if (encodeTransaction(actual.serializeMessage()) !== encodeTransaction(expected.serializeMessage()) || !(await actual.verifySignatures()) || !actual.signature || !(await connection.isBlockhashValid(actual.recentBlockhash!)).value) throw new Error('Invalid or expired Solana signature')
  return { signedTransaction: `solana:${signed}`, transactionHash: getBase58Decoder().decode(actual.signature) }
}
export async function broadcastSolanaTransfer(signed: string) {
  const connection = await checkedConnection()
  await connection.sendRawTransaction(decodeTransaction(signed), { skipPreflight: false, maxRetries: 0n })
}
export async function solanaReceipt(signature: string, input: OperationInput): Promise<Operation['receipt']> {
  const connection = await checkedConnection()
  const receipt = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  if (!receipt?.meta) return null
  const meta = receipt.meta
  const success = !meta.err
  const payer = receipt.transaction.message.getAccountKeys().get(0)?.toBase58()
  const transferredNative = success && input.asset === 'native' && input.to !== payer ? BigInt(input.amountAtomic) : 0n
  const fee = BigInt(meta.preBalances[0]!) - BigInt(meta.postBalances[0]!) - transferredNative
  if (fee < 0n) throw new Error('Invalid Solana fee observation')
  return { transactionHash: String(receipt.transaction.signatures[0]), chainId: solanaDevnet, blockNumber: String(receipt.slot), feeAtomic: fee.toString(), success, feePayment: { asset: 'native', amountAtomic: fee.toString(), decimals: 9 } }
}
