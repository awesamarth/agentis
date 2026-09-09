import { test, expect } from 'bun:test'
import { Keypair } from '@solana/web3.js'
import { buildSolanaTransfer, assertSolanaTransfer, encodeTransaction, solanaDevnet, solanaUsdc } from './solana-transfer'

test('Solana SDK builds SOL/SPL transfers and rejects changed approved terms', async () => {
  const sender = await Keypair.generate()
  const receiver = await Keypair.generate()
  for (const asset of ['native', `spl:${solanaUsdc}`] as const) {
    const input = { walletId: crypto.randomUUID(), chainId: solanaDevnet, action: 'transfer' as const, asset, to: receiver.publicKey.toBase58(), amountAtomic: '1000000', maxFeeAtomic: '3000000', reason: 'Local serialization contract test' }
    const transaction = await buildSolanaTransfer(sender.publicKey.toBase58(), input, receiver.publicKey.toBase58())
    const unsigned = encodeTransaction(await transaction.serialize({ requireAllSignatures: false, verifySignatures: false }))
    await expect(assertSolanaTransfer(sender.publicKey.toBase58(), input, unsigned)).resolves.toBeDefined()
    await expect(assertSolanaTransfer(sender.publicKey.toBase58(), { ...input, amountAtomic: '2000000' }, unsigned)).rejects.toThrow('differ')
    await expect(assertSolanaTransfer(receiver.publicKey.toBase58(), input, unsigned)).rejects.toThrow('payer')
    await transaction.sign(sender)
    const signed = encodeTransaction(await transaction.serialize())
    const checked = await assertSolanaTransfer(sender.publicKey.toBase58(), input, signed)
    expect(await checked.verifySignatures()).toBe(true)
  }
})
