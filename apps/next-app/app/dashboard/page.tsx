'use client'
import { usePrivy } from '@privy-io/react-auth'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import Navbar from '@/components/Navbar'
import GuestWallets from '@/components/GuestWallets'
import Operations from '@/components/Operations'
import Onboarding from '@/components/Onboarding'
import TransferRequest from '@/components/TransferRequest'

export default function Dashboard() {
  const { ready, authenticated, login } = usePrivy()
  return <><Navbar showCrumb="dashboard" /><main className="mx-auto max-w-6xl px-6 py-12 sm:px-10 sm:py-20">
    <header className="mb-10 flex flex-wrap items-end justify-between gap-6 border-b border-beige-darker pb-8">
      <div><p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">Your financial workspace</p><h1 className="font-serif text-4xl font-black tracking-tight sm:text-6xl">Money moves.<br /><span className="italic">You make the rules.</span></h1></div>
      <span className="border border-beige-darker px-3 py-2 font-mono text-[10px] uppercase tracking-widest">Testnet environment</span>
    </header>
    {!ready ? <p role="status" className="py-10 text-ink-muted">Loading your workspace…</p> : authenticated ? <div className="space-y-8"><Onboarding /><TransferRequest /><Operations /></div> : <section className="grid border border-beige-darker bg-[#faf7f1] md:grid-cols-[1.35fr_1fr]">
      <div className="p-7 sm:p-10"><p className="font-mono text-xs uppercase tracking-widest text-ink-muted">Hosted wallets</p><h2 className="mt-5 max-w-md font-serif text-3xl font-bold sm:text-4xl">An account for your agent.<br />Control stays with you.</h2><p className="mt-5 max-w-md leading-relaxed text-ink-muted">Choose your networks, set spending limits, and review payments before they leave your wallet.</p><button onClick={login} className="mt-8 inline-flex items-center gap-6 bg-black px-6 py-4 font-mono text-xs uppercase tracking-widest text-beige transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-4">Sign in to get started <ArrowUpRight size={16} aria-hidden="true" /></button></div>
      <div className="border-t border-beige-darker bg-beige p-7 sm:p-10 md:border-l md:border-t-0"><p className="font-mono text-xs uppercase tracking-widest text-ink-muted">Choose your networks</p><div className="mt-5 divide-y divide-beige-darker">{[['Base', 'ETH · USDC'], ['Arc', 'USDC'], ['Tempo', 'alphaUSD'], ['Solana', 'SOL · USDC']].map(([name, assets]) => <div key={name} className="flex items-center justify-between gap-4 py-4"><span className="font-serif text-2xl font-bold">{name}</span><span className="font-mono text-xs text-ink-muted">{assets}</span></div>)}</div><p className="mt-5 text-xs leading-relaxed text-ink-muted">Test networks only. Wallets need test funds before making payments.</p></div>
    </section>}
    {ready && !authenticated && <details id="browser-demo" className="group mt-10 border-y border-beige-darker">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-6 [&::-webkit-details-marker]:hidden"><div><span className="font-serif text-xl font-bold">Just exploring?</span><p className="mt-1 text-sm text-ink-muted">Try a local browser wallet. No account needed.</p></div><ChevronDown className="shrink-0 transition-transform group-open:rotate-180" size={18} aria-hidden="true" /></summary>
      <div className="pb-8"><GuestWallets /></div>
    </details>}
  </main></>
}
