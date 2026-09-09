import { expect, test } from 'bun:test'
import type { Operation } from '@agentis-hq/sdk'
import { assertTransferAuthorization } from './operation-authorization'

const operation: Operation = { id: '00000000-0000-4000-8000-000000000001', walletId: '00000000-0000-4000-8000-000000000002', action: 'transfer', chainId: 'eip155:84532', asset: 'native', to: '0x0000000000000000000000000000000000001234', amountAtomic: '10', maxFeeAtomic: '100', reason: 'test', status: 'pending_approval', operationHash: 'a'.repeat(64), policyVersion: 1, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), approvalUrl: null, receipt: null, transactionHash: null, error: null }
function request() {
  return { version: 1 as const, method: 'POST' as const, url: 'https://api.privy.io/v1/wallets/test/rpc', headers: { 'privy-app-id': 'app', 'privy-idempotency-key': operation.id, 'privy-request-expiry': String(Date.parse(operation.expiresAt)) }, body: { method: 'eth_signTransaction', params: { transaction: { type: 2, chain_id: 84532, to: operation.to, value: '0xa', data: '0x', nonce: 0, gas_limit: '0xa', max_fee_per_gas: '0x1', max_priority_fee_per_gas: '0x1' } } } }
}
test('browser only signs the payment the user reviewed', () => {
  expect(() => assertTransferAuthorization(operation, request(), 'app')).not.toThrow()
  for (const patch of [{ to: '0x0000000000000000000000000000000000004321' }, { chain_id: 1 }, { value: '0xb' }, { gas_limit: '0x10000' }, { data: '0x1234' }, { type: 4 }, { authorization_list: [] }]) {
    const changed = request()
    Object.assign(changed.body.params.transaction, patch)
    expect(() => assertTransferAuthorization(operation, changed, 'app')).toThrow()
  }
  const other = request(); other.headers['privy-idempotency-key'] = 'other'
  expect(() => assertTransferAuthorization(operation, other, 'app')).toThrow()
})
