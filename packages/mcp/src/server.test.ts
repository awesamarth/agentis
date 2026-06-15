import { describe, expect, test } from 'bun:test'
import { policyUnitMetadata } from './server'

describe('MCP policy unit metadata', () => {
  test('makes USD policy limits unambiguous', () => {
    const metadata = policyUnitMetadata()

    expect(metadata.currency).toBe('USD')
    expect(metadata.fieldUnits.maxPerTx).toBe('USD per transaction')
    expect(metadata.explanation).toContain('maxPerTx: 1')
    expect(metadata.explanation).toContain('$1 USD')
    expect(metadata.explanation).toContain('not 1 SOL')
  })
})
