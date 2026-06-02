import type { AgentInfo } from '@agentis-hq/core'
import type { LocalWallet } from './local-wallet'

type HostedAgentLike = Pick<AgentInfo, 'id' | 'name' | 'walletAddress' | 'privacyEnabled' | 'umbraStatus' | 'policyMode' | 'onchainPolicy'>

function formatPolicy(agent: HostedAgentLike): string {
  const mode = agent.policyMode ?? 'backend'
  if (mode !== 'onchain') return 'policy=backend'
  return `policy=onchain:${agent.onchainPolicy?.initialized ? 'ready' : 'pending'}`
}

function formatPrivacy(agent: HostedAgentLike): string | null {
  if (!agent.privacyEnabled && !agent.umbraStatus) return null
  return `privacy=${agent.umbraStatus ?? 'enabled'}`
}

function formatLocalPolicy(wallet: LocalWallet): string {
  return wallet.policy.killSwitch ? 'policy=local:killed' : 'policy=local'
}

function formatBadges(parts: Array<string | null>): string {
  return parts.filter(Boolean).join(', ')
}

export function formatHostedAgentLine(agent: HostedAgentLike): string {
  const badges = formatBadges(['hosted', formatPolicy(agent), formatPrivacy(agent)])
  return `  ${agent.name.padEnd(20)} ${agent.walletAddress}  [${agent.id}]  ${badges}`
}

export function formatLocalWalletLine(wallet: LocalWallet): string {
  const badges = formatBadges(['local', formatLocalPolicy(wallet)])
  return `  ${wallet.name.padEnd(20)} ${wallet.solanaAddress}  [${wallet.id}]  ${badges}`
}
