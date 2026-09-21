'use client'
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usePrivy } from '@privy-io/react-auth'
import { type AgentisAgent } from '@agentis-hq/sdk'
import { useAgentisClient } from '@/lib/agentis'
import PluginPicker from './PluginPicker'
import { pluginDetails } from './plugins/registry'

export default function AgentPlugins({ agent }: { agent: AgentisAgent }) {
  const { user } = usePrivy()
  const cache = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState(agent.plugins)
  const client = useAgentisClient()
  const save = useMutation({ mutationFn: () => client.agents.setPlugins(agent.id, selected), onSuccess: async () => {
    await Promise.all([cache.invalidateQueries({ queryKey: ['agents', user?.id] }), cache.invalidateQueries({ queryKey: ['wallets', user?.id] })])
    dialog.current?.close()
  } })
  function open() { setSelected(agent.plugins); save.reset(); dialog.current?.showModal() }
  return <section aria-labelledby="agent-plugins-title" className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 id="agent-plugins-title" className="font-mono text-[0.6rem] uppercase tracking-widest text-ink-muted">Plugins</h2><div className="flex flex-wrap gap-2"><button className="border border-beige-darker px-4 py-2 text-sm hover:border-ink" onClick={open}>+ Add a plugin</button><button className="bg-black px-4 py-2 text-sm text-beige hover:bg-ink" onClick={open}>Manage</button></div></header>
    {!agent.plugins.length ? <p className="border border-beige-darker bg-[#faf7f1] p-5 text-sm text-ink-muted">No plugins added</p> : null}
    {agent.plugins.map(id => {
      const plugin = pluginDetails(id), Logo = plugin.Logo, Controls = plugin.Controls
      return <article key={id} className="border border-beige-darker bg-[#faf7f1] p-5"><div className="flex items-start gap-3"><Logo /><div className="min-w-0 flex-1"><h3 className="font-serif text-xl font-bold">{plugin.name}</h3><p className="mt-1 text-sm text-ink-muted">{plugin.description}</p></div></div><Controls agent={agent} /></article>
    })}
    <dialog ref={dialog} aria-labelledby="plugin-picker-title" onCancel={event => { if (save.isPending) event.preventDefault() }} onClick={event => {
      if (save.isPending || event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close()
    }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto border border-beige-darker bg-beige p-6 text-ink shadow-xl backdrop:bg-black/50 sm:p-8"><header className="mb-6 flex items-start justify-between gap-3"><h2 id="plugin-picker-title" className="font-serif text-2xl font-bold">Plugins for {agent.name}</h2><button aria-label="Close plugin picker" disabled={save.isPending} className="text-2xl" onClick={() => dialog.current?.close()}>×</button></header><PluginPicker selected={selected} onChange={setSelected} disabled={save.isPending} />{save.error && <p role="alert" className="mt-4 text-sm">{save.error.message}</p>}<footer className="mt-6 flex justify-end gap-3"><button disabled={save.isPending} className="border border-beige-darker px-4 py-2 text-sm" onClick={() => dialog.current?.close()}>Cancel</button><button disabled={save.isPending} className="bg-black px-4 py-2 text-sm text-beige disabled:opacity-40" onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button></footer></dialog>
  </section>
}
