'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'

export default function Home() {
  const { ready, authenticated, login } = usePrivy()
  const router = useRouter()

  return (
    <main className="min-h-screen bg-beige flex flex-col">
      <Navbar />

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-24 text-center">

        {/* Stamp */}
        <div className="animate-fade-up flex flex-col items-center gap-2 mb-7 [animation-delay:0ms] opacity-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-black flex items-center justify-center font-serif text-beige text-sm font-black">
              A
            </div>
            <span className="font-mono text-base tracking-[0.15em] text-black uppercase">
              Agentis
            </span>
          </div>
          <span className="font-mono text-[0.65rem] tracking-widest text-ink-muted opacity-75 uppercase">
            built on Solana · for autonomous agents
          </span>
        </div>

        {/* Headline */}
        <h1
          className="animate-fade-up font-serif font-black text-black leading-[0.92] tracking-[-0.03em] mb-6 max-w-4xl [animation-delay:80ms] opacity-0"
          style={{ fontSize: 'clamp(3rem, 7vw, 5.8rem)' }}
        >
          The financial OS
          <br />
          <span className="italic text-ink-muted">for AI agents.</span>
        </h1>

        {/* Subheading */}
        <p className="animate-fade-up font-sans text-lg text-ink-muted max-w-lg leading-relaxed mb-12 font-light [animation-delay:160ms] opacity-0">
          Wallets, payments, policy enforcement, privacy, and token swaps —
          one platform for agents to hold, spend, and earn on Solana.
        </p>

        {/* CTAs */}
        <div className="animate-fade-up flex gap-4 items-center flex-wrap justify-center [animation-delay:240ms] opacity-0">
          {ready && !authenticated && (
            <button
              onClick={login}
              className="bg-black text-beige font-mono text-sm tracking-widest px-8 py-3.5 hover:bg-ink transition-colors cursor-pointer"
            >
              get started
            </button>
          )}
          {ready && authenticated && (
            <button
              onClick={() => router.push('/dashboard')}
              className="bg-black text-beige font-mono text-sm tracking-widest px-8 py-3.5 hover:bg-ink transition-colors cursor-pointer"
            >
              go to dashboard →
            </button>
          )}
          {ready && !authenticated && (
            <a
              href="/dashboard"
              className="font-mono text-sm tracking-widest text-ink px-8 py-3.5 border border-beige-darker hover:border-ink-muted transition-colors"
            >
              explore dashboard →
            </a>
          )}
        </div>

        {/* Feature strip */}
        <div className="animate-fade-up w-full max-w-3xl mt-24 border-t border-b border-beige-darker flex [animation-delay:360ms] opacity-0">
          {[
            { label: 'wallets', desc: 'local / managed' },
            { label: 'payments', desc: 'MPP / x402' },
            { label: 'policies', desc: 'backend / on-chain' },
            { label: 'privacy', desc: 'via Umbra' },
            { label: 'yield', desc: 'via Jupiter Earn' },
          ].map((f, i) => (
            <div key={f.label} className={`flex-1 py-6 px-4 text-center ${i < 4 ? 'border-r border-beige-darker' : ''}`}>
              <div className="font-mono text-[0.7rem] tracking-[0.08em] text-black mb-1">{f.label}</div>
              <div className="font-sans text-xs text-ink-muted font-light">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="flex justify-between items-center px-12 py-6 border-t border-beige-darker">
        <span className="font-mono text-[0.7rem] text-ink-muted tracking-widest">agentis.xyz</span>
        <span className="font-mono text-[0.7rem] text-ink-muted tracking-widest">© 2026</span>
      </footer>

    </main>
  )
}
