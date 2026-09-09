// Internal chain module shared by server preparation and browser review.
// No credentials, RPC calls, signing authority, or plugin behavior live here.
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { address, blockhash as parseBlockhash, createNoopSigner, isSignerRole, isWritableRole, getBase64Encoder, getBase64Decoder, type Instruction } from '@solana/kit'
import { findAssociatedTokenPda, getTransferCheckedInstruction, getCreateAssociatedTokenIdempotentInstructionAsync, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import type { OperationInput } from './operations'

export const solanaDevnet = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
export const solanaUsdc = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
export const encodeTransaction = (bytes: Uint8Array) => getBase64Decoder().decode(bytes)
export const decodeTransaction = (text: string) => new Uint8Array(getBase64Encoder().encode(text))

function instruction(value: Instruction) {
  return new TransactionInstruction({ programId: new PublicKey(value.programAddress), data: new Uint8Array(value.data ?? []), keys: (value.accounts ?? []).map(account => ({ pubkey: new PublicKey(account.address), isSigner: isSignerRole(account.role), isWritable: isWritableRole(account.role) })) })
}
export async function tokenAccounts(from: string, to: string) {
  const mint = address(solanaUsdc)
  const [source] = await findAssociatedTokenPda({ mint, owner: address(from), tokenProgram: TOKEN_PROGRAM_ADDRESS })
  const [destination] = await findAssociatedTokenPda({ mint, owner: address(to), tokenProgram: TOKEN_PROGRAM_ADDRESS })
  return { mint, source, destination }
}
export async function buildSolanaTransfer(from: string, input: OperationInput, blockhash: string) {
  if (input.chainId !== solanaDevnet || BigInt(input.amountAtomic) > 18_446_744_073_709_551_615n) throw new Error('Invalid Solana transfer')
  const transaction = new Transaction({ feePayer: new PublicKey(from), recentBlockhash: parseBlockhash(blockhash) })
  if (input.asset === 'native') transaction.add(SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(input.to), lamports: BigInt(input.amountAtomic) }))
  else {
    if (input.asset !== `spl:${solanaUsdc}`) throw new Error('Unsupported Solana mint')
    const { mint, source, destination } = await tokenAccounts(from, input.to)
    // The no-op signer supplies instruction account metadata only. It never signs.
    const authority = createNoopSigner(address(from))
    transaction.add(instruction(await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: authority, owner: address(input.to), mint })))
    transaction.add(instruction(getTransferCheckedInstruction({ source, destination, mint, authority, amount: BigInt(input.amountAtomic), decimals: 6 })))
  }
  return transaction
}
export async function assertSolanaTransfer(from: string, input: OperationInput, encoded: string) {
  const actual = Transaction.from(decodeTransaction(encoded))
  if (!actual.recentBlockhash || actual.feePayer?.toBase58() !== from) throw new Error('Unexpected Solana payer')
  const expected = await buildSolanaTransfer(from, input, actual.recentBlockhash)
  const a = actual.serializeMessage(), b = expected.serializeMessage()
  if (a.length !== b.length || a.some((byte, index) => byte !== b[index])) throw new Error('Solana instructions differ from the reviewed payment')
  return actual
}
