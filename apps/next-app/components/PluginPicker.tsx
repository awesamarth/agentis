'use client'
import Image from 'next/image'
import type { AgentisAgent } from '@agentis-hq/sdk'

export const uniswapDescription = 'Token swaps, payment funding, portfolio rebalancing and scheduled purchases.'
// Official mark: https://raw.githubusercontent.com/Uniswap/interface/main/apps/web/public/favicon.png
export function UniswapLogo() {
  return <Image src="/plugins/uniswap.png" width={36} height={36} alt="" className="shrink-0" />
}
export default function PluginPicker({ selected, onChange, disabled = false }: { selected: AgentisAgent['plugins']; onChange: (plugins: AgentisAgent['plugins']) => void; disabled?: boolean }) {
  return <div className="space-y-4"><p className="text-sm text-ink-muted">Add optional capabilities for this agent. You can change these later.</p><label className={`flex items-start gap-3 border p-4 ${selected.includes('uniswap') ? 'border-ink bg-[#faf7f1]' : 'border-beige-darker'} ${disabled ? 'opacity-50' : 'cursor-pointer'}`}><input type="checkbox" checked={selected.includes('uniswap')} disabled={disabled} className="mt-3 shrink-0 accent-black" onChange={event => onChange(event.target.checked ? ['uniswap'] : [])} /><span className="min-w-0 flex-1"><span className="flex items-center gap-3"><UniswapLogo /><span className="font-serif text-lg font-bold">Uniswap</span></span><span className="mt-2 block text-sm text-ink-muted">{uniswapDescription}</span><span className="mt-2 block text-xs text-ink-muted">Base Sepolia. Existing budgets and payment approvals still apply. Recurring schedules are opt-in.</span></span></label></div>
}
