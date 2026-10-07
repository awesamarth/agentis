import { test, expect } from 'bun:test'
import { Challenge } from 'mppx'
import { encodeEventTopics, encodeAbiParameters, erc20Abi, type TransactionReceipt } from 'viem'
import { networkByKey, tempoTokens } from '../packages/core/src/networks'
import { tempoAsset, tempoFeeAsset, defaultTempoFeeAsset, selectTempoChallenge, parseTempoChallenge, roundedTempoFee, verifyTempoReceipt, assertTempoBalances } from '../packages/core/src/tempo'
import { operationInput, type OperationInput } from '../packages/core/src/operations'
import { validateMpp } from '../apps/backend/src/modules/mpp'
import { transferTerms } from '../packages/cli/src/lib/transfer-terms'
import type { WalletRow } from '../apps/backend/src/db/schema'

const to = '0x0000000000000000000000000000000000000011', from = '0x0000000000000000000000000000000000000022'
const chainId = 'eip155:4217'
const asset = `erc20:${tempoTokens.OUSD}`
function offer(token: string = tempoTokens.OUSD, patch: Record<string, unknown> = {}, details: Record<string, unknown> = {}) {
  return Challenge.serialize(Challenge.from({ id: 'fixture', realm: 'example.com', method: 'tempo', intent: 'charge', expires: new Date(Date.now() + 120_000).toISOString(), request: { amount: '1000', currency: token, recipient: to, description: 'A comma, in a description', methodDetails: { chainId: 4217, supportedModes: ['pull'], ...details }, ...patch } }))
}
const transfer: OperationInput = { walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', action: 'transfer', chainId, asset, feeAsset: `erc20:${tempoTokens.pathUSD}`, to, amountAtomic: '1000', maxFeeAtomic: '10000000000000000' }

test('Tempo allowlist: three mainnet assets, four testnet assets; OUSD defaults; no beta/theta', () => {
  expect(networkByKey('tempo')!.assets.map(a => a.symbol)).toEqual(['OUSD', 'USDC.e', 'pathUSD'])
  expect(networkByKey('tempo-testnet')!.assets.map(a => a.symbol)).toEqual(['OUSD', 'USDC.e', 'pathUSD', 'alphaUSD'])
  for (const key of ['tempo', 'tempo-testnet']) {
    const n = networkByKey(key)!
    expect(n.defaultAsset).toBe('OUSD')
    for (const a of n.assets) expect(a.decimals).toBe(6)
    for (const name of ['betaUSD', 'thetaUSD', 'USDC']) expect(() => tempoAsset(n.chainId, name)).toThrow()
  }
  expect(() => tempoAsset(chainId, 'alphaUSD')).toThrow()
  expect(() => tempoAsset(chainId, tempoTokens.usdcTestnet)).toThrow()
  expect(() => tempoAsset('eip155:42431', tempoTokens.usdcMainnet)).toThrow()
  expect(tempoAsset('eip155:42431', 'USDC.e').feeEligible).toBe(false)
  expect(() => tempoFeeAsset({ chainId: 'eip155:42431', feeAsset: 'USDC.e' })).toThrow('cannot pay')
  expect(defaultTempoFeeAsset('eip155:42431', 'USDC.e').symbol).toBe('OUSD')
  expect(defaultTempoFeeAsset(chainId, 'USDC.e').symbol).toBe('USDC.e')
  const testnet = transferTerms({ wallet: 'fixture', chain: 'tempo-testnet', asset: 'USDC.e', to, amount: '1', key: 'test' })
  expect(testnet.feeAsset).toBe(`erc20:${tempoTokens.OUSD}`)
})

test('explicit independent fee token is bound to terms; legacy absent fee token is unchanged', () => {
  expect(operationInput.parse(transfer).feeAsset).toBe(`erc20:${tempoTokens.pathUSD}`)
  expect(tempoFeeAsset(transfer).symbol).toBe('pathUSD')
  expect(tempoFeeAsset({ chainId }).symbol).toBe('pathUSD')
  expect(tempoFeeAsset({ chainId: 'eip155:42431' }).symbol).toBe('alphaUSD')
  expect(() => operationInput.parse({ ...transfer, feeAsset: `erc20:${tempoTokens.alphaUSD}` })).toThrow()
  expect(() => operationInput.parse({ ...transfer, chainId: 'eip155:8453' })).toThrow()
  const terms = transferTerms({ wallet: 'fixture', chain: 'tempo', to, amount: '1', key: 'fixture', feeAsset: 'USDC.e' })
  expect(terms.symbol).toBe('OUSD')
  expect(terms.feeAsset).toBe(`erc20:${tempoTokens.usdcMainnet}`)
  expect(roundedTempoFee(1n)).toBe(1000000000000n)
})

test('MPP selects a supported later offer, preserves description, and honors explicit token choice', () => {
  const unknown = offer('0x0000000000000000000000000000000000000001')
  const list = [unknown, offer(tempoTokens.usdcMainnet), offer(tempoTokens.pathUSD), offer()].join(', ')
  const selected = selectTempoChallenge(list, chainId, '1000')
  expect(selected.asset.symbol).toBe('OUSD')
  expect(selected.request.description).toContain(',')
  expect(selectTempoChallenge(list, chainId, '1000', 'pathUSD').asset.symbol).toBe('pathUSD')
  expect(selectTempoChallenge(list, chainId, '1000', 'USDC.e').asset.id).toBe(`erc20:${tempoTokens.usdcMainnet}`)
  expect(() => parseTempoChallenge(list, chainId)).toThrow('one approved')
  expect(() => selectTempoChallenge(offer(tempoTokens.pathUSD), chainId, '1000', 'OUSD')).toThrow()
})

test('MPP rejects wrong chain, over-cap, split payments, extra authority and unsupported intents', () => {
  for (const header of [offer(tempoTokens.OUSD, {}, { chainId: 42431 }), offer(tempoTokens.OUSD, {}, { supportedModes: ['push'] }), offer(tempoTokens.OUSD, {}, { splits: [{ recipient: from, amount: '1' }] }), offer(tempoTokens.OUSD, { amount: '0' }), offer(tempoTokens.OUSD, { additionalCharge: '1000' }), offer().replace('intent="charge"', 'intent="session"')]) expect(() => selectTempoChallenge(header, chainId, '1000')).toThrow()
  expect(() => selectTempoChallenge(offer(), chainId, '999')).toThrow()
  expect(() => selectTempoChallenge(offer(), chainId, '1000', undefined, Date.now() + 100_000)).toThrow()
  expect(() => selectTempoChallenge(offer(), chainId, '1000', undefined, Date.now() - 600_000)).toThrow()
})

test('sponsored charges bind zero agent gas to the actual challenge', () => {
  const selected = selectTempoChallenge(offer(tempoTokens.OUSD, {}, { feePayer: true }), chainId, '1000')
  expect(selectTempoChallenge([offer(), offer(tempoTokens.usdcMainnet, {}, { feePayer: true })].join(', '), chainId, '1000', undefined, Date.now(), true).asset.symbol).toBe('USDC.e')
  const input: OperationInput = { ...transfer, action: 'paid_fetch', maxFeeAtomic: '0', mpp: { sponsored: true, url: 'https://example.com/search', method: 'POST', body: '{"query":"test"}', challenge: Challenge.serialize(selected.challenge), maxAmountAtomic: '1000', expiresAt: selected.challenge.expires! } }
  expect(() => operationInput.parse(input)).not.toThrow()
  expect(() => validateMpp({ chainId } as WalletRow, input)).not.toThrow()
  expect(() => validateMpp({ chainId } as WalletRow, { ...input, mpp: { ...input.mpp!, sponsored: false } })).toThrow()
  expect(verifyTempoReceipt(receipt(), transfer, from, to).feeAtomic).toBe('0')
  expect(() => verifyTempoReceipt(receipt(), transfer, from, from)).toThrow()
})

test('persisted MPP currency/recipient/amount/expiry stay exact at execution', () => {
  const selected = selectTempoChallenge(offer(), chainId, '1000')
  const input: OperationInput = { ...transfer, action: 'paid_fetch', mpp: { url: 'https://example.com/paid', challenge: Challenge.serialize(selected.challenge), maxAmountAtomic: '1000', expiresAt: selected.challenge.expires! } }
  const wallet = { chainId } as WalletRow
  expect(() => validateMpp(wallet, input)).not.toThrow()
  for (const patch of [{ asset: `erc20:${tempoTokens.pathUSD}` }, { to: from }, { amountAtomic: '1001' }, { feeAsset: `erc20:${tempoTokens.usdcTestnet}` }]) expect(() => validateMpp(wallet, { ...input, ...patch })).toThrow()
  expect(() => validateMpp({ chainId: 'eip155:42431' } as WalletRow, input)).toThrow()
})

test('fee exposure rounds up and combines with the transfer only when the token is shared', () => {
  expect(() => assertTempoBalances(1000n, 1000n, null, 1n)).toThrow('Insufficient')
  expect(() => assertTempoBalances(1000n, 1001n, null, 1n)).not.toThrow()
  expect(() => assertTempoBalances(1000n, 1000n, 1n, 1n)).not.toThrow()
  expect(() => assertTempoBalances(1000n, 1000n, 0n, 1n)).toThrow('Insufficient')
  expect(() => assertTempoBalances(1000n, 999n, 1000n, 1n)).toThrow('Insufficient')
  expect(() => assertTempoBalances(1000n, 1001n, null, 1000000000001n)).toThrow('Insufficient')
})

function receipt(): TransactionReceipt & { feeToken: string } {
  return { from, feeToken: tempoTokens.pathUSD, status: 'success', gasUsed: 50000n, effectiveGasPrice: 600000000n,
    logs: [{ address: tempoTokens.OUSD, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }), data: encodeAbiParameters([{ type: 'uint256' }], [1000n]) }],
  } as unknown as TransactionReceipt & { feeToken: string }
}
test('settlement verifies token, payer and payment evidence; no false fee-only release', () => {
  expect(verifyTempoReceipt(receipt(), transfer, from)).toEqual({ feeAtomic: '30000000000000', feePayment: { asset: `erc20:${tempoTokens.pathUSD}`, amountAtomic: '30', decimals: 6 }, success: true })
  expect(() => verifyTempoReceipt({ ...receipt(), logs: [] }, transfer)).toThrow('reservation retained')
  expect(() => verifyTempoReceipt({ ...receipt(), feeToken: tempoTokens.OUSD }, transfer)).toThrow()
  expect(() => verifyTempoReceipt(receipt(), transfer, to)).toThrow()
  expect(() => verifyTempoReceipt(receipt(), { ...transfer, amountAtomic: '1001' })).toThrow()
  expect(verifyTempoReceipt({ ...receipt(), status: 'reverted', logs: [] }, transfer).success).toBe(false)
})
