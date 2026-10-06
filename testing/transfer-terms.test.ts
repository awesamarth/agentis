import { expect, test } from 'bun:test'
import { exactAmount, transferTerms, type TransferInput } from '../packages/cli/src/lib/transfer-terms'

const input: TransferInput = {
  wallet: 'fixture', chain: 'base', to: '0x0000000000000000000000000000000000000011',
  amount: '1.000001', asset: 'USDC', key: 'fixture-request',
}

test('shared transfer construction preserves exact token identity and bigint amounts', () => {
  const terms = transferTerms(input)
  expect(terms.asset.id).toBe('erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
  expect(terms.amountAtomic).toBe(1000001n)
  expect(terms.maxFeeAtomic).toBe(100000000000000n)
  expect(terms.to).toBe(input.to)
  expect(exactAmount('9007199254740993.000001', 6)).toBe(9007199254740993000001n)
})

test('invalid amounts, fee caps, networks and idempotency keys fail before custody access', () => {
  for (const amount of ['0', '-1', '1e6', '0.0000001', 'NaN', '']) {
    expect(() => transferTerms({ ...input, amount })).toThrow()
  }
  for (const change of [{ maxFee: '0' }, { maxFee: '-1' }, { chain: 'base,tempo' }, { chain: 'unknown' }, { key: '' }, { key: ' '.repeat(3) }, { key: 'a'.repeat(201) }, { asset: 'unknown' }, { to: 'invalid' }]) {
    expect(() => transferTerms({ ...input, ...change })).toThrow()
  }
})

test('ENS pass-through is explicit; local construction does not silently resolve names', () => {
  expect(() => transferTerms({ ...input, to: 'agent.example.eth' })).toThrow()
  expect(transferTerms({ ...input, to: 'agent.example.eth' }, true).to).toBe('agent.example.eth')
})

test('asset defaults and fee units remain network-specific', () => {
  const tempo = transferTerms({ ...input, chain: 'tempo', asset: undefined })
  expect(tempo.symbol).toBe('OUSD')
  expect(tempo.amountAtomic).toBe(1000001n)
  expect(tempo.maxFeeAtomic).toBe(10000000000000000n)
  const solana = transferTerms({ ...input, chain: 'solana', to: '11111111111111111111111111111111', asset: undefined })
  expect(solana.symbol).toBe('SOL')
  expect(solana.amountAtomic).toBe(1000001000n)
  expect(solana.maxFeeAtomic).toBe(5000000n)
})
