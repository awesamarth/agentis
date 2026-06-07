import type { AgentInfo } from '@agentis-hq/core'
import type { LocalWallet } from './local-wallet'

type HostedAgentLike = Pick<AgentInfo, 'id' | 'name' | 'walletAddress' | 'privacyEnabled' | 'umbraStatus' | 'policyMode' | 'onchainPolicy'>

const blue = '\x1b[38;5;117m'
const purple = '\x1b[38;5;141m'
const green = '\x1b[38;5;114m'
const amber = '\x1b[38;5;179m'
const red = '\x1b[38;5;203m'
const muted = '\x1b[38;5;244m'
const reset = '\x1b[0m'

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

function shorten(value: string, prefix = 6, suffix = 5): string {
  if (value.length <= prefix + suffix + 3) return value
  return `${value.slice(0, prefix)}...${value.slice(-suffix)}`
}

function color(value: string, ansi: string): string {
  return `${ansi}${value}${reset}`
}

function colorPolicy(policy: string): string {
  if (policy === 'policy=onchain:ready') return color(policy, purple)
  if (policy === 'policy=onchain:pending') return color(policy, amber)
  if (policy === 'policy=local:killed') return color(policy, red)
  return color(policy, muted)
}

function colorPrivacy(privacy: string | null): string | null {
  if (!privacy) return null
  if (privacy === 'privacy=registered') return color(privacy, green)
  if (privacy === 'privacy=pending') return color(privacy, amber)
  if (privacy === 'privacy=failed') return color(privacy, red)
  return color(privacy, muted)
}

function formatBadges(parts: Array<string | null>): string {
  return parts.filter(Boolean).join('  ')
}

function formatName(name: string): string {
  return color(shorten(name, 17, 4).padEnd(24), blue)
}

export function formatHostedAgentLine(agent: HostedAgentLike): string {
  const badges = formatBadges([
    colorPolicy(formatPolicy(agent)),
    colorPrivacy(formatPrivacy(agent)),
  ])
  return `  ${formatName(agent.name)} ${shorten(agent.walletAddress)}  ${badges}`
}

export function formatLocalWalletLine(wallet: LocalWallet): string {
  return `  ${formatName(wallet.name)} ${shorten(wallet.solanaAddress)}  ${colorPolicy(formatLocalPolicy(wallet))}`
}
