// Run after starting the local API + worker with Anvil. No hosted/mainnet target.
// AGENTIS_TOKEN must be the local-demo owner token; it is never printed.
import assert from 'node:assert/strict'
import { AgentisClient } from '@agentis-hq/sdk'

const baseUrl = process.env.AGENTIS_API_URL ?? 'http://127.0.0.1:3001'
const url = new URL(baseUrl)
assert(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname), 'Local API only')
assert(process.env.AGENTIS_TOKEN, 'Provide the local owner token through a private environment')
const owner = new AgentisClient({ baseUrl, token: process.env.AGENTIS_TOKEN })
const wallet = (await owner.wallets.list()).find(wallet => wallet.chainId === 'eip155:31337')
assert(wallet, 'Configure/fund a disposable Anvil wallet first')
const grant = await owner.grants.create({ walletId: wallet.id, agentName: 'sdk-example', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
try {
  const agent = new AgentisClient({ baseUrl, token: grant.token })
  const operation = await agent.operations.create({
    walletId: wallet.id, action: 'transfer', chainId: 'eip155:31337', asset: 'native',
    to: '0x0000000000000000000000000000000000001234',
    amountAtomic: '1000000000000', maxFeeAtomic: '1000000000000000', reason: 'Disposable Anvil example',
  }, { idempotencyKey: 'example-payment-1' })
  console.log('Requested:', operation.id, operation.status, operation.approvalUrl)
  // Only this local demo combines owner and executor. Real agents must not get the owner token.
  if (operation.status === 'pending_approval') await owner.operations.approve(operation.id, operation.operationHash)
  const settled = await agent.operations.wait(operation.id)
  console.log('Result:', settled.status, settled.receipt)
  assert.equal(settled.status, 'confirmed', 'Inspect the operation; do not blindly create another payment')
} finally {
  await owner.grants.revoke(grant.id)
}
