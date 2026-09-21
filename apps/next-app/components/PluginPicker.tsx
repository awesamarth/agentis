'use client'

import type { AgentisAgent } from '@agentis-hq/sdk'
import { pluginChoices } from './plugins/registry'

export default function PluginPicker({ selected, onChange, disabled = false }: { selected: AgentisAgent['plugins']; onChange: (plugins: AgentisAgent['plugins']) => void; disabled?: boolean }) {
  return <div className="space-y-4">
    <p className="text-sm text-ink-muted">Add optional capabilities for this agent. You can change these later.</p>
    {pluginChoices.map(plugin => {
      const Logo = plugin.Logo
      return <label key={plugin.id} className={`flex items-start gap-3 border p-4 ${selected.includes(plugin.id) ? 'border-ink bg-[#faf7f1]' : 'border-beige-darker'} ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
        <input type="checkbox" checked={selected.includes(plugin.id)} disabled={disabled} className="mt-3 shrink-0 accent-black" onChange={event => onChange(event.target.checked ? [...selected, plugin.id] : selected.filter(id => id !== plugin.id))} />
        <span className="min-w-0 flex-1"><span className="flex items-center gap-3"><Logo /><span className="font-serif text-2xl font-bold">{plugin.name}</span></span><span className="mt-2 block text-sm text-ink-muted">{plugin.description}</span><span className="mt-2 block text-xs text-ink-muted">{plugin.detail}</span></span>
      </label>
    })}
  </div>
}
