import { sessions } from './session'
import { transferTerms, type TransferInput } from './transfer-terms'
import { localNetworks } from './local-networks'
import { paymentRequest, type PaymentRequestOptions } from './payment-request'

export async function sendHostedTransfer(input: Omit<TransferInput, 'key'> & PaymentRequestOptions, agent?: string) {
  const terms = transferTerms(input, true, true)
  const chainId = localNetworks[terms.chain].chainId
  const candidates = []
  for (const session of sessions(agent)) {
    for (const wallet of await session.client.wallets.list()) {
      const name = wallet.agentName ?? (wallet.agentId === session.agentId ? session.agentName : null)
      if (wallet.enabled && wallet.chainId === chainId && (input.wallet === wallet.id || input.wallet === wallet.agentId || input.wallet === name)) candidates.push({ session, wallet, name })
    }
  }
  if (candidates.length !== 1) throw Error('Choose one accessible hosted wallet by name or wallet ID and --chain; use wallet list --hosted')
  const { session, wallet, name } = candidates[0]!
  const request = {
    walletId: wallet.id, action: 'transfer', chainId,
    asset: terms.asset.id, ...(terms.feeAsset ? { feeAsset: terms.feeAsset } : {}),
    to: terms.to, amountAtomic: terms.amountAtomic.toString(), maxFeeAtomic: terms.maxFeeAtomic.toString(),
  } as const
  let operation = await paymentRequest(session.client, 'send', request, input, options => session.client.operations.create(request, options))
  if (operation.status === 'queued') operation = await session.client.operations.wait(operation.id, { timeoutMs: 120_000 })
  return {
    wallet: name ?? 'Hosted wallet', chainId, to: operation.to, ...(operation.ens ? { ensName: operation.ens.name } : {}), amount: input.amount, asset: terms.symbol,
    status: operation.status,
    operationId: operation.id, approvalUrl: operation.approvalUrl, transactionHash: operation.transactionHash,
    ...(operation.error ? { error: operation.error } : {}),
    ...(operation.status === 'pending_approval' ? { note: 'Open the approval link and approve in the dashboard.' } : {}),
    ...(['queued', 'submitting', 'submitted', 'unknown'].includes(operation.status) ? { note: 'Not settled yet. Inspect this operation ID or repeat the exact command with --retry <saved-request-id>. A bare send creates a new payment.' } : {}),
  }
}
