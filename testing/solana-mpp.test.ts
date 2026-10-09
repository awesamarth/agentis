import { test, expect } from 'bun:test'
import { Challenge } from 'mppx'
import { address, generateKeyPairSigner, getBase64EncodedWireTransaction, getTransactionDecoder } from '@solana/kit'
import { VersionedTransaction, type Connection } from '@solana/web3.js'
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { paymentTransfers, recipientsAllowed } from '../packages/core/src/operations'
import { networkByKey } from '../packages/core/src/networks'
import { solanaMppTerms, prepareSolanaMpp, reconcileSolanaMpp, validateSolanaMpp } from '../packages/core/src/solana-mpp'

const network = networkByKey('solana-devnet')!
const payer = await generateKeyPairSigner(), seller = await generateKeyPairSigner(), affiliate = await generateKeyPairSigner()
const blockhash = seller.address
function challenge(sponsored: boolean, currency: string, details: Record<string, unknown> = {}) {
  return Challenge.serialize(Challenge.from({ secretKey: 'offline-fixture', realm: 'fixture', method: 'solana', intent: 'charge', expires: new Date(Date.now() + 300_000).toISOString(), request: { amount: '1000', currency, recipient: seller.address, methodDetails: { network: 'devnet', ...(currency === 'sol' ? {} : { decimals: 6, tokenProgram: TOKEN_PROGRAM_ADDRESS }), ...(sponsored ? { feePayer: true, feePayerKey: seller.address } : {}), recentBlockhash: blockhash, ...details } } }))
}
const request = { walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', url: 'https://example.com/image', method: 'POST' as const, body: 'exact body', maxAmountAtomic: '1000', maxFeeAtomic: '3000000' }
function rpc(overrides = {}) {
  return { getGenesisHash: async () => network.genesisHash, getSlot: async () => 10n, getLatestBlockhashAndContext: async () => ({ context: { slot: 10n }, value: { blockhash, lastValidBlockHeight: 500n } }), isBlockhashValid: async () => ({ value: true }), getBalance: async () => 10_000_000n, getTokenAccountBalance: async () => ({ value: { amount: '100000' } }), getFeeForMessage: async () => ({ value: 5001n }), getMinimumBalanceForRentExemption: async () => 2_039_280n, ...overrides } as unknown as Connection
}

test('Solana MPP uses the installed SDK for exact sponsored/self-paid SOL and USDC; reconciles final signatures and rent', async () => {
  for (const sponsored of [true, false]) for (const currency of ['sol', network.assets.find(asset => asset.symbol === 'USDC')!.id.slice(4)]) for (const split of [false, true]) {
    const cap = split ? '6000000' : '3000000'
    const input = solanaMppTerms({ ...request, asset: currency, maxFeeAtomic: cap }, network.chainId, challenge(sponsored, currency, split ? { splits: [{ recipient: affiliate.address, amount: '250', memo: 'royalty' }] } : {}))
    expect(input.mpp?.body).toBe('exact body')
    expect(input.maxFeeAtomic).toBe(sponsored ? '0' : cap)
    const proof = await prepareSolanaMpp(input, payer, rpc(), 'http://127.0.0.1:1', Date.now() + 300_000, 'first-purchase')
    const second = await prepareSolanaMpp(input, payer, rpc(), 'http://127.0.0.1:1', Date.now() + 300_000, 'second-purchase')
    expect(second.payerSignature).not.toBe(proof.payerSignature)
    const tx = getTransactionDecoder().decode(Buffer.from(proof.signed, 'base64'))
    const signatures = sponsored ? { ...tx.signatures, ...(await seller.signTransactions([tx as never]))[0] } : tx.signatures
    const wire = VersionedTransaction.deserialize(Buffer.from(getBase64EncodedWireTransaction({ ...tx, signatures } as never), 'base64'))
    const nativeAmount = currency === 'sol' ? 1000n : 0n
    const fee = sponsored ? 0n : currency === 'sol' ? 5001n : split ? 4083561n : 2044281n
    const index = sponsored ? 1 : 0
    const preBalances = wire.message.staticAccountKeys.map(() => 10_000_000n)
    const postBalances = [...preBalances]; postBalances[index] -= nativeAmount + fee
    const postTokenBalances: { accountIndex: number; mint: string; uiTokenAmount: { amount: string } }[] = []
    if (split) for (const transfer of paymentTransfers(input)) {
      if (currency === 'sol') {
        const index = wire.message.staticAccountKeys.findIndex(key => key.toBase58() === transfer.to)
        postBalances[index] += BigInt(transfer.amountAtomic) - (index === 0 ? 5001n : 0n)
      } else {
        const [ata] = await findAssociatedTokenPda({ mint: address(currency), owner: address(transfer.to), tokenProgram: TOKEN_PROGRAM_ADDRESS })
        postTokenBalances.push({ accountIndex: wire.message.staticAccountKeys.findIndex(key => key.toBase58() === ata), mint: currency, uiTokenAmount: { amount: transfer.amountAtomic } })
      }
    }
    const { getBase58Decoder } = await import('@solana/kit')
    const hashes = wire.signatures.map(value => getBase58Decoder().decode(value))
    const settled = { slot: 11n, transaction: { message: wire.message, signatures: hashes }, meta: { err: null, fee: 5001n, preBalances, postBalances, preTokenBalances: [], postTokenBalances } }
    const connection = rpc({ getTransaction: async () => settled, getSignaturesForAddress: async () => [{ signature: hashes[0], slot: 11n }] })
    const receipt = await reconcileSolanaMpp(proof, connection)
    expect(receipt?.transactionHash).toBe(hashes[0])
    expect(receipt?.feeAtomic).toBe(String(fee))
    expect(receipt?.success).toBe(true)
    if (split) {
      expect(recipientsAllowed(input, [seller.address])).toBe(false)
      expect(recipientsAllowed(input, [seller.address, affiliate.address])).toBe(true)
      expect(recipientsAllowed(input, [seller.address, affiliate.address.toLowerCase()])).toBe(false)
      expect(() => validateSolanaMpp({ ...input, mpp: { ...input.mpp!, splits: [{ to: affiliate.address, amountAtomic: '251' }] } }, payer.address)).toThrow('differ from approval')
      const wrong = currency === 'sol'
        ? { ...settled, meta: { ...settled.meta, postBalances: [...preBalances] } }
        : { ...settled, meta: { ...settled.meta, postTokenBalances: postTokenBalances.slice(0, 1) } }
      await expect(reconcileSolanaMpp(proof, rpc({ getTransaction: async () => wrong }), hashes[0])).rejects.toThrow('settlement')
    }
    if (sponsored) expect(proof.hash).toBeNull()
    await expect(reconcileSolanaMpp({ ...proof, payerSignature: seller.address }, connection, hashes[0])).rejects.toThrow('differs')
    // A wrong RPC or inadequate fee/rent budget must fail before touching custody.
    let signed = false
    const guard = { address: payer.address, signTransactions: async () => { signed = true; throw Error('must not sign') } }
    await expect(prepareSolanaMpp(input, guard, rpc({ getGenesisHash: async () => 'wrong-network' }), '', Date.now() + 300_000, 'guard-check')).rejects.toThrow('network')
    if (!sponsored) await expect(prepareSolanaMpp({ ...input, maxFeeAtomic: '1' }, guard, rpc(), '', Date.now() + 300_000, 'guard-check')).rejects.toThrow('exceeds')
    expect(signed).toBe(false)
  }
})

test('Solana MPP rejects unsupported authority and mismatched terms instead of silently dropping them', () => {
  const header = challenge(true, 'sol')
  const input = solanaMppTerms({ ...request, asset: 'SOL' }, network.chainId, header)
  expect(() => validateSolanaMpp({ ...input, amountAtomic: '999' })).toThrow()
  expect(() => validateSolanaMpp({ ...input, maxFeeAtomic: '1' })).toThrow()
  expect(() => solanaMppTerms(request, network.chainId, header)).toThrow() // default is USDC, never reinterpret decimal ceilings
  for (const details of [{ network: 'mainnet-beta' }, { decimals: 6 }, { splits: [{ recipient: seller.address, amount: '1000' }] }, { feePayerKey: payer.address, feePayer: false }, { tokenProgram: payer.address }]) {
    expect(() => solanaMppTerms({ ...request, asset: 'SOL' }, network.chainId, challenge(true, 'sol', details))).toThrow()
  }
  expect(() => solanaMppTerms({ ...request, asset: 'SOL', headers: { authorization: 'Bearer fixture' } }, network.chainId, header)).toThrow()
})
