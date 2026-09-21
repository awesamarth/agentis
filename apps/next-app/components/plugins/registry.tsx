'use client'

import Image from 'next/image'
import { pluginIdValues, type AgentisAgent, type PluginId } from '@agentis-hq/sdk'
import IdentityControls, { ensDescription } from '../IdentityControls'
import UniswapControls from '../UniswapControls'

export function UniswapLogo() {
  return <Image src="/plugins/uniswap.png" width={36} height={36} alt="" className="shrink-0" />
}

export function EnsLogo() {
  return <Image src="/plugins/ens.svg" width={36} height={36} alt="" className="shrink-0" />
}

const pluginUi = {
  uniswap: {
    name: 'Uniswap',
    description: 'Token swaps, payment funding, portfolio rebalancing and scheduled purchases.',
    detail: 'Base Sepolia. Existing budgets and payment approvals still apply. Recurring schedules are opt-in.',
    Logo: UniswapLogo,
    Controls: ({ agent }: { agent: AgentisAgent }) => <UniswapControls agentId={agent.id} />,
  },
  ens: {
    name: 'ENS',
    description: ensDescription,
    detail: 'Ethereum Sepolia. You retain control of the parent namespace.',
    Logo: EnsLogo,
    Controls: ({ agent }: { agent: AgentisAgent }) => <div className="mt-5 border-t border-beige-darker pt-4"><IdentityControls agent={agent} showDescription={false} /></div>,
  },
} satisfies Record<PluginId, {
  name: string
  description: string
  detail: string
  Logo: React.ComponentType
  Controls: React.ComponentType<{ agent: AgentisAgent }>
}>

export const pluginChoices = pluginIdValues.map(id => ({ id, ...pluginUi[id] }))
export const pluginDetails = (id: PluginId) => pluginUi[id]
