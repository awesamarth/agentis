import { sessions } from './session'
import { transferTerms, type LocalSendInput } from './local-send'
import { localNetworks } from './local-networks'

export async function sendHostedTransfer(input: LocalSendInput, agent?: string) {
  const terms = transferTerms(input)
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
  let operation = await session.client.operations.create({
    walletId: wallet.id, action: 'transfer', chainId,
    asset: terms.asset.token ? `${terms.chain === 'solana' ? 'spl' : 'erc20'}:${terms.asset.token}` : 'native',
    to: terms.to, amountAtomic: terms.amountAtomic.toString(), maxFeeAtomic: terms.maxFeeAtomic.toString(),
  }, { idempotencyKey: input.key })
  if (operation.status === 'queued') operation = await session.client.operations.wait(operation.id, { timeoutMs: 120_000 })
  return {
    wallet: name ?? 'Hosted wallet', chainId, to: terms.to, amount: input.amount, asset: terms.symbol,
    status: operation.status,
    operationId: operation.id, approvalUrl: operation.approvalUrl, transactionHash: operation.transactionHash,
    ...(operation.error ? { error: operation.error } : {}),
    ...(operation.status === 'pending_approval' ? { note: 'Open the approval link and approve in the dashboard.' } : {}),
    ...(['queued', 'submitting', 'submitted', 'unknown'].includes(operation.status) ? { note: 'Not settled yet. Reuse this exact command and key to check; do not create a new payment key.' } : {}),
  }
}
