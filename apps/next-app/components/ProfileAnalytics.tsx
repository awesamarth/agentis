'use client'

import type { ProfileSummary } from '@agentis-hq/sdk'

const colors = ['#c8a96e', '#2a2620', '#8f7a50', '#b8955a', '#6b6459', '#d6c18a', '#4a4340', '#aeb9c8']

// Round only for display; stored USD accounting stays in exact micros.
export function profileMoney(micros: string | bigint, decimals: 2 | 3 = 2) {
  const unit = 10n ** BigInt(6 - decimals)
  const rounded = (BigInt(micros) + unit / 2n) / unit
  const scale = 10n ** BigInt(decimals)
  const fraction = (rounded % scale).toString().padStart(decimals, '0').replace(/0+$/, '').padEnd(2, '0')
  return `$${(rounded / scale).toLocaleString('en-US')}.${fraction}`
}
function dateLabel(date: string, short = false) {
  const [year, month, day] = date.split('-')
  return short ? `${day}-${month}` : `${day}/${month}/${year.slice(-2)}`
}
function chartStep(max: bigint) {
  const target = (max + 3n) / 4n || 1n
  const unit = 10n ** BigInt(target.toString().length - 1)
  return [1n, 2n, 5n, 10n].map(n => n * unit).find(n => n >= target)!
}

export default function ProfileAnalytics({ data }: { data: ProfileSummary }) {
  const daily = [...data.daily].sort((a, b) => a.date.localeCompare(b.date))
  const recentTotal = daily.reduce((sum, day) => sum + BigInt(day.spendMicros), 0n)
  const max = daily.reduce((max, day) => BigInt(day.spendMicros) > max ? BigInt(day.spendMicros) : max, 0n)
  const step = chartStep(max || 40_000n), ceiling = step * 4n
  const byAgent = data.byAgent.filter(agent => BigInt(agent.spendMicros) > 0n)
  const breakdown = byAgent.length > 8 ? [...byAgent.slice(0, 7), { id: 'other', name: 'Other agents', spendMicros: byAgent.slice(7).reduce((sum, agent) => sum + BigInt(agent.spendMicros), 0n).toString() }] : byAgent
  const total = breakdown.reduce((sum, agent) => sum + BigInt(agent.spendMicros), 0n)
  const ratio = (amount: bigint) => total ? Number(amount * 1_000_000n / total) / 10_000 : 0
  const segments = breakdown.map((agent, index) => {
    const before = breakdown.slice(0, index).reduce((sum, item) => sum + BigInt(item.spendMicros), 0n)
    const start = ratio(before)
    return { ...agent, start, percent: ratio(before + BigInt(agent.spendMicros)) - start }
  })

  return <section className="space-y-6">
    <h2 className="font-mono text-[0.6rem] uppercase tracking-widest text-ink-muted">spend analytics</h2>
    <div className="border border-beige-darker bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-mono text-xs text-ink-muted">daily spend — last 14 days</h3><p className="mt-1 font-mono text-[0.6rem] uppercase tracking-widest text-ink-muted">USD settled through Agentis · fees included · UTC</p></div>
        <p className="font-mono text-xs text-ink-muted">Period total <span className="text-ink">{profileMoney(recentTotal)}</span></p>
      </div>
      <div className="mt-6 border border-beige-darker/70 bg-beige/40">
        <div className="px-4 pb-4 pt-8 sm:px-6">
          <div className="relative ml-20 h-56 border-b border-l border-beige-darker">
            {[0, 1, 2, 3, 4].map(tick => <div key={tick} className="pointer-events-none absolute inset-x-0" style={{ bottom: `${tick * 25}%` }}>
              {tick > 0 && <div className="border-t border-dashed border-beige-darker" />}
              <span className="absolute right-full -translate-y-1/2 whitespace-nowrap pr-3 font-mono text-[10px] tabular-nums text-ink-muted">{profileMoney(step * BigInt(tick))}</span>
            </div>)}
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${daily.length || 1}, minmax(0, 1fr))` }}>
              {daily.map(day => {
                const amount = BigInt(day.spendMicros)
                const label = `${dateLabel(day.date)}: ${profileMoney(amount, 3)}`
                return <div key={day.date} tabIndex={0} aria-label={label} className="group relative flex h-full items-end justify-center outline-none">
                  <div className="w-3/5 max-w-6 bg-accent group-hover:bg-ink group-focus-visible:bg-ink" style={{ height: `${Number(amount * 10_000n / ceiling) / 100}%`, minHeight: amount > 0n ? 3 : 0 }} />
                  <div aria-hidden="true" className="pointer-events-none absolute z-10 mb-2 hidden whitespace-nowrap border border-beige-darker bg-white px-2 py-1 font-mono text-[10px] shadow-sm group-hover:block group-focus-visible:block group-first:left-0 group-last:right-0" style={{ bottom: `${Number(amount * 10_000n / ceiling) / 100}%` }}>{profileMoney(amount)}</div>
                </div>
              })}
            </div>
          </div>
          <div className="ml-20 mt-3 grid" style={{ gridTemplateColumns: `repeat(${daily.length || 1}, minmax(0, 1fr))` }}>
            {daily.map((day, index) => <span key={day.date} className={`relative h-4 font-mono text-[9px] tabular-nums text-ink-muted sm:text-[10px] ${index === daily.length - 1 || (index % 4 === 0 && index < daily.length - 2) ? '' : 'invisible sm:visible'}`}><span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{dateLabel(day.date, true)}</span></span>)}
          </div>
        </div>
      </div>
      {recentTotal === 0n && <p className="mt-3 text-xs text-ink-muted">No settled spend in the last 14 days.</p>}
      <details className="mt-5 text-xs" open>
        <summary className="cursor-pointer font-mono text-ink-muted">daily amounts <span className="text-[10px]">· newest first · UTC</span></summary>
        <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">{daily.slice().reverse().map(day => <div key={day.date} className="flex items-center justify-between gap-3 border-b border-beige-darker/50 py-2">
          <dt className="font-mono text-[11px] text-ink-muted">{dateLabel(day.date)}</dt>
          <dd className={`font-mono text-xs tabular-nums ${BigInt(day.spendMicros) > 0n ? 'font-medium text-ink' : 'text-ink-muted'}`}>{profileMoney(day.spendMicros, 3)}</dd>
        </div>)}</dl>
      </details>
    </div>
    <div className="border border-beige-darker bg-white p-4 sm:p-6">
      <h3 className="font-mono text-xs text-ink-muted">spend by agent</h3>
      <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-widest text-ink-muted">All-time · fees included</p>
      <div className="grid items-center gap-8 py-6 sm:grid-cols-2">
        <div className="relative mx-auto w-full max-w-60">
          <svg viewBox="0 0 120 120" role="img" aria-label="All-time spend by agent; amounts listed alongside" className="w-full -rotate-90">
            <circle cx="60" cy="60" r="45" fill="none" stroke="#e8e1d5" strokeWidth="16" />
            {segments.map((agent, i) => <circle key={agent.id ?? 'unassigned'} cx="60" cy="60" r="45" pathLength="100" fill="none" stroke={colors[i % colors.length]} strokeWidth="16" strokeDasharray={`${agent.percent} ${100 - agent.percent}`} strokeDashoffset={-agent.start}><title>{`${agent.name}: ${profileMoney(agent.spendMicros)}`}</title></circle>)}
          </svg>
          <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center px-12 text-center"><span className="font-mono text-[9px] uppercase tracking-widest text-ink-muted">Total spend</span><span className="mt-2 max-w-full break-all font-serif text-lg font-bold">{profileMoney(total)}</span></div>
        </div>
        {segments.length ? <ul className="space-y-2">{segments.map((agent, i) => <li key={agent.id ?? 'unassigned'} className="flex items-center gap-3 border border-beige-darker/70 bg-beige/40 px-3 py-3">
          <span className="h-3 w-3 shrink-0" style={{ backgroundColor: colors[i % colors.length] }} />
          <div className="min-w-0 font-mono text-xs"><p className="break-words">{agent.name}</p><p className="mt-1 text-[11px] tabular-nums text-ink-muted">{profileMoney(agent.spendMicros)} · {agent.percent < 0.1 ? '<0.1' : agent.percent.toFixed(1)}%</p></div>
        </li>)}</ul> : <p className="text-sm text-ink-muted">Your agent breakdown will appear after your first settled payment.</p>}
      </div>
    </div>
  </section>
}
