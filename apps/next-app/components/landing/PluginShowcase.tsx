'use client'

import { useId, useRef, useState, type KeyboardEvent } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import styles from './PluginShowcase.module.css'

const plugins = [
  {
    id: 'agentcard', name: 'Agentcard', icon: '/plugins/agentcard.png', status: 'Preview',
    title: 'Bring your own card.',
    body: 'Shopping doesn’t always end at a crypto checkout. Connect an existing credit or debit card and choose when your agent can use it.',
    features: [
      ['Connect your card', 'Use a credit or debit card you already own.'],
      ['Shop in the browser', 'Let your agent pay at supported checkouts.'],
      ['Delegate the shopping', 'Have your agent put together a cart for your review.'],
    ],
    caption: 'Example purchase · card payments are in preview',
  },
  {
    id: 'uniswap', name: 'Uniswap', icon: '/plugins/uniswap.png', status: 'Base Sepolia · testnet',
    title: 'Keep the right tokens on hand.',
    body: 'Give your agent the tokens it needs without managing every swap yourself. Choose what it can trade and how much it can spend.',
    features: [
      ['Swap tokens', 'Review a quote before exchanging one token for another.'],
      ['Schedule purchases', 'Choose an amount and a recurring buying schedule.'],
      ['Rebalance funds', 'Adjust token holdings with a plan you review first.'],
    ],
    caption: 'Illustrative swap · not a live quote',
  },
  {
    id: 'ens', name: 'ENS', icon: '/plugins/ens.svg', status: 'Ethereum Sepolia · testnet',
    title: 'Give your agent a name.',
    body: 'Make your agent easier to recognise and connect with. Bring its payment addresses and service details together under an ENS name.',
    features: [
      ['A name of its own', 'Create an agent name under a namespace you control.'],
      ['Payment addresses', 'Publish the addresses for its selected networks.'],
      ['Service details', 'Share a description and the endpoint where it can be reached.'],
    ],
    caption: 'Example identity · names and addresses are illustrative',
  },
] as const

type PluginId = typeof plugins[number]['id']
const label = 'font-mono text-xs uppercase tracking-[0.12em]'

function CardPreview() {
  return <div className="mx-auto w-full max-w-md">
    <div className={`${styles.card} relative z-10 mx-3 border border-ink bg-ink p-6 text-beige shadow-[6px_6px_0_rgba(42,38,32,0.1)] sm:mx-5 sm:p-7`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`${label} text-beige/70`}>Your connected card</span>
        <span aria-hidden="true" className="grid h-7 w-9 grid-cols-2 gap-0.5 rounded-sm border border-beige/60 p-1"><span className="border border-beige/40" /><span className="border border-beige/40" /></span>
      </div>
      <p className="mt-8 font-mono text-xl tracking-[0.12em] sm:text-2xl">•••• •••• •••• 4242</p>
      <p className="mt-5 text-sm text-beige/70">Connected through Agentcard</p>
    </div>
    <div className="-mt-5 border-2 border-ink bg-[#f8f4ed] p-1">
      <div className="border border-beige-darker px-5 pb-6 pt-11 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className={label}>Purchase request</p><span className="border border-beige-darker px-2 py-1 font-mono text-xs">Ask mode</span></div>
        <h4 className="mt-5 font-serif text-3xl font-bold">Office supplies</h4>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-b border-beige-darker pb-5"><p className="text-sm text-ink-muted">Requested by research-agent</p><p className="font-mono text-3xl">$24.00</p></div>
        <p className="mt-5 flex items-center gap-2 text-sm"><span aria-hidden="true" className="h-2 w-2 shrink-0 bg-ink" />Waiting for your approval</p>
      </div>
    </div>
  </div>
}

function SwapPreview() {
  return <div className="mx-auto w-full max-w-md border-2 border-ink bg-[#f8f4ed] p-1 shadow-[6px_6px_0_rgba(42,38,32,0.06)]">
    <div className="border border-beige-darker p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-serif text-3xl font-bold">Swap preview</h4><span className="font-mono text-xs text-ink-muted">Base Sepolia</span></div>
      <div className="mt-7 border border-beige-darker bg-white/60 p-5">
        <p className={`${label} text-ink-muted`}>You pay</p>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3"><span className="font-mono text-3xl sm:text-4xl">25.00</span><span className="font-mono text-lg">USDC</span></div>
      </div>
      <div aria-hidden="true" className="relative z-10 -my-3 mx-auto flex h-9 w-9 items-center justify-center border border-ink bg-beige text-xl">↓</div>
      <div className="border border-beige-darker bg-white/60 p-5 pt-6">
        <p className={`${label} text-ink-muted`}>Estimated receive</p>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3"><span className="font-mono text-3xl sm:text-4xl">0.008</span><span className="font-mono text-lg">ETH</span></div>
      </div>
      <dl className="mt-6 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-ink-muted">Agent</dt><dd>research-agent</dd></div><div className="flex justify-between gap-4"><dt className="text-ink-muted">Approval</dt><dd>Required before swap</dd></div></dl>
      <p className="mt-6 border-t border-beige-darker pt-4 text-sm text-ink-muted">Your agent’s spending limits still apply.</p>
    </div>
  </div>
}

function IdentityPreview() {
  return <div className="mx-auto w-full max-w-md border-2 border-ink bg-[#f8f4ed] p-1 shadow-[6px_6px_0_rgba(42,38,32,0.06)]">
    <div className="border border-beige-darker p-5 sm:p-7">
      <div className="flex items-center gap-3"><Image src="/plugins/ens.svg" alt="" width={40} height={40} /><p className={`${label} text-ink-muted`}>Agent identity</p></div>
      <h4 className="mt-6 break-words font-serif text-3xl font-bold leading-tight sm:text-4xl">research<wbr />.yourname<wbr />.eth</h4>
      <p className="mt-4 text-base leading-relaxed text-ink-muted">An agent for research, useful data and fresh ideas.</p>
      <dl className="mt-7 divide-y divide-beige-darker border-y border-beige-darker">
        {[
          ['Ethereum Sepolia', '0x7a2c…41e9'],
          ['Base Sepolia', '0x7a2c…41e9'],
          ['Service', 'research.example'],
        ].map(([name, value]) => <div key={name} className="flex flex-wrap items-center justify-between gap-2 py-4"><dt className="text-sm text-ink-muted">{name}</dt><dd className="font-mono text-sm">{value}</dd></div>)}
      </dl>
      <p className="mt-6 text-sm text-ink-muted">Your namespace. Your agent’s identity.</p>
    </div>
  </div>
}

function PluginPreview({ id }: { id: PluginId }) {
  if (id === 'agentcard') return <CardPreview />
  if (id === 'uniswap') return <SwapPreview />
  return <IdentityPreview />
}

export default function PluginShowcase() {
  const [selected, setSelected] = useState(0)
  const id = useId()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % plugins.length
    else if (event.key === 'ArrowLeft') next = (index + plugins.length - 1) % plugins.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = plugins.length - 1
    else return
    event.preventDefault()
    setSelected(next)
    buttons.current[next]?.focus()
  }
  return <section id="plugins" className="scroll-mt-8 px-6 py-16 sm:px-10 sm:py-20 lg:px-12">
    <div className="mx-auto max-w-7xl">
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-muted">Optional plugins</p>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
        <h2 className="max-w-3xl font-serif text-4xl font-black leading-[1.02] text-black sm:text-5xl lg:text-6xl">Add what your agent needs.</h2>
        <Link href="/dashboard" className="border-b border-ink pb-1 font-mono text-xs uppercase tracking-wider focus-visible:outline-2 focus-visible:outline-offset-4">Manage your agents <span aria-hidden="true">↗</span></Link>
      </div>
      <p className="mt-5 max-w-xl leading-relaxed text-ink-muted">Keep each agent’s setup focused. You choose which extras to enable.</p>
      <div className="mt-10 border-2 border-ink bg-[#f8f4ed] p-1 shadow-[8px_8px_0_rgba(42,38,32,0.06)]">
        <div className="border border-beige-darker">
          <div role="tablist" aria-label="Explore Agentis plugins" className="grid grid-cols-3 border-b border-beige-darker">
            {plugins.map((plugin, index) => <button
              key={plugin.id}
              ref={node => { buttons.current[index] = node }}
              type="button" role="tab" id={`${id}-tab-${plugin.id}`} aria-controls={`${id}-panel-${plugin.id}`}
              aria-selected={selected === index} tabIndex={selected === index ? 0 : -1}
              onClick={() => setSelected(index)} onKeyDown={event => navigate(event, index)}
              className={`flex min-w-0 cursor-pointer flex-col items-center justify-center gap-2 px-2 py-5 transition-colors motion-reduce:transition-none focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-4 sm:flex-row sm:gap-3 sm:px-6 sm:py-6 ${index < plugins.length - 1 ? 'border-r border-beige-darker' : ''} ${selected === index ? 'bg-ink text-beige' : 'text-ink hover:bg-beige-dark'}`}
            ><Image src={plugin.icon} alt="" width={32} height={32} className="shrink-0" /><span className="font-serif text-lg font-bold sm:text-2xl">{plugin.name}</span></button>)}
          </div>
          <div className={styles.stack}>
          {plugins.map((plugin, index) => <div key={plugin.id} role="tabpanel" id={`${id}-panel-${plugin.id}`} aria-labelledby={`${id}-tab-${plugin.id}`} aria-hidden={selected !== index} inert={selected !== index} tabIndex={selected === index ? 0 : -1} className={`${styles.panel} ${selected === index ? styles.active : ''} focus-visible:outline-2 focus-visible:-outline-offset-4`}>
            <div className="grid lg:min-h-[38rem] lg:grid-cols-2">
              <div className={`${styles.enter} flex flex-col justify-center p-6 sm:p-9 lg:p-10`}>
                <p className="self-start border border-beige-darker px-3 py-1.5 font-mono text-xs uppercase tracking-wide">{plugin.status}</p>
                <h3 className="mt-6 max-w-lg font-serif text-4xl font-black leading-[0.96] tracking-normal text-black sm:text-5xl">{plugin.title}</h3>
                <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-muted">{plugin.body}</p>
                <ul className="mt-8 space-y-5">
                  {plugin.features.map(([title, description], featureIndex) => <li key={title} className="flex gap-4">
                    <span aria-hidden="true" className="mt-1 font-mono text-xs text-ink-muted">0{featureIndex + 1}</span>
                    <div><h4 className="font-serif text-xl font-bold">{title}</h4><p className="mt-1 text-base leading-relaxed text-ink-muted">{description}</p></div>
                  </li>)}
                </ul>
              </div>
              <figure className="flex min-w-0 flex-col justify-center gap-6 border-t border-beige-darker bg-beige p-5 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
                <div className={styles.enter}><PluginPreview id={plugin.id} /></div>
                <figcaption className={`${styles.enter} mx-auto max-w-md text-center font-mono text-xs leading-relaxed text-ink-muted`}>{plugin.caption}</figcaption>
              </figure>
            </div>
          </div>)}
          </div>
        </div>
      </div>
    </div>
  </section>
}
