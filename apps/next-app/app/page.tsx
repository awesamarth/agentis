'use client'

import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'

const moneyStack = [
  { label: 'request', detail: 'one SDK integration' },
  { label: 'approve', detail: 'human-controlled access' },
  { label: 'limit', detail: 'bounded delegation' },
  { label: 'execute', detail: 'explicit capabilities' },
  { label: 'track', detail: 'operations and receipts' },
]

const productSections = [
  {
    kicker: 'agent wallets',
    title: 'Every agent starts with a money account.',
    body: 'Keep the agent’s delegated wallet access separate from the human who owns it. Privy wallet linking is available; hosted execution is undergoing verification.',
    items: ['user-owned wallets', 'scoped executor grants', 'dashboard and CLI control'],
  },
  {
    kicker: 'payments',
    title: 'Agents can pay for work without leaving policy behind.',
    body: 'The rewrite routes financial operations through one authorization and receipt lifecycle. Local Anvil transfers work; x402 and MPP plugins are being migrated.',
    items: ['explicit operation state', 'approval requests', 'stable retry keys'],
  },
  {
    kicker: 'policy',
    title: 'Budgets are enforced before money moves.',
    body: 'Agents cannot change their own permissions or approve themselves. The foundation reserves budgets transactionally and rejects operations outside their grants.',
    items: ['budget reservations', 'pause and revoke', 'owner-only approvals'],
  },
  {
    kicker: 'privacy',
    title: 'Privacy belongs in an optional capability.',
    body: 'Umbra will return as a plugin behind the same execution boundary—not a separate signing path. It is unavailable in the current rewrite preview.',
    items: ['optional plugin', 'explicit permissions', 'migration pending'],
  },
  {
    kicker: 'yield',
    title: 'Financial integrations extend the core.',
    body: 'Jupiter treasury capabilities and secondary Link payments are planned plugins. No mainnet execution is enabled in this preview.',
    items: ['Jupiter plugin', 'Link secondary', 'migration pending'],
  },
  {
    kicker: 'interfaces',
    title: 'Use the same wallet from dashboard, CLI, SDK, and MCP.',
    body: 'Humans can operate through the dashboard. Agents can call through the SDK or MCP server, while the CLI works for both scripts and manual operations.',
    items: ['dashboard', 'CLI and SDK', 'MCP'],
  },
]

function AgentWalletVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[34rem] 2xl:max-w-[36rem]">
      <div className="absolute left-5 top-5 h-full w-full bg-black/[0.06]" />
      <div className="relative border border-beige-darker bg-[#f8f4ed] p-5 shadow-[10px_10px_0_rgba(42,38,32,0.06)] xl:p-6">
        <div className="flex items-start justify-between gap-5 border-b border-beige-darker pb-4">
          <div>
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-muted">
              agent wallet
            </p>
            <p className="mt-2 font-serif text-3xl font-black leading-none text-black xl:text-4xl">
              research-agent
            </p>
            <p className="mt-2 font-mono text-[0.7rem] text-ink-muted">
              7MoLfx...9L1Ws
            </p>
          </div>
          <span className="border border-beige-darker bg-white px-3 py-2 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-muted">
            policy active
          </span>
        </div>

        <div className="py-5 xl:py-6">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-ink-muted">
            available balance
          </p>
          <p className="mt-2 font-mono text-5xl font-medium leading-none text-black xl:text-6xl">
            $128.40
          </p>
          <p className="mt-2 font-mono text-[0.7rem] text-ink-muted">
            Across Base, Arc, Tempo &amp; Solana
          </p>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {['pay', 'limit', 'approve', 'track'].map(action => (
            <div
              key={action}
              className="min-w-0 border border-beige-darker bg-white px-2 py-3 text-center font-mono text-sm text-black"
            >
              {action}
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-2.5 border-t border-beige-darker pt-4 font-mono text-[0.72rem]">
          <div className="grid grid-cols-[5rem_1fr_4rem] items-center gap-4">
            <span className="text-ink-muted">PAID</span>
            <span className="text-center text-black">x402 API request</span>
            <span className="text-right text-black">$0.01</span>
          </div>
          <div className="grid grid-cols-[5rem_1fr_4rem] items-center gap-4">
            <span className="text-ink-muted">BUDGET</span>
            <span className="text-center text-black">daily limit remaining</span>
            <span className="text-right text-black">$24.99</span>
          </div>
          <div className="grid grid-cols-[5rem_1fr_4rem] items-center gap-4">
            <span className="text-ink-muted">APPROVAL</span>
            <span className="text-center text-black">transfer request</span>
            <span className="text-right text-black">Pending</span>
          </div>
          <div className="grid grid-cols-[5rem_1fr_4rem] items-center gap-4">
            <span className="text-ink-muted">RECEIPT</span>
            <span className="text-center text-black">payment confirmed</span>
            <span className="text-right text-black" aria-label="Confirmed">✓</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  const { ready, authenticated, login } = usePrivy()
  const router = useRouter()

  return (
    <main className="min-h-screen bg-beige text-ink">
      <Navbar />

      <section className="relative overflow-hidden px-6 py-10 sm:px-10 lg:px-12 2xl:px-10">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(42,38,32,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(42,38,32,0.045)_1px,transparent_1px)] bg-size-[52px_52px]" />
        <div className="absolute -right-16 top-8 hidden select-none font-serif text-[30rem] font-black leading-none text-black/[0.035] xl:block">
          A
        </div>

        <div className="relative mx-auto max-w-350">
          <div className="grid min-h-[calc(100vh-5.5rem)] grid-cols-1 items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(26rem,0.72fr)] md:gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(31rem,0.72fr)] xl:gap-16 2xl:grid-cols-[minmax(0,1fr)_minmax(34rem,0.74fr)] 2xl:gap-24">
            <div>
              <div className="animate-fade-up mb-6 inline-flex items-center gap-3 border border-beige-darker bg-beige/80 px-4 py-2 opacity-0">
                <span className="flex h-7 w-7 items-center justify-center bg-black font-serif text-sm font-black text-beige">
                  A
                </span>
                <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-muted">
                  Built for agents that move money
                </span>
              </div>

              <h1 className="animate-fade-up max-w-none font-serif text-5xl font-black leading-[0.92] tracking-normal text-black opacity-0 [animation-delay:80ms] sm:text-6xl md:text-[4.7rem] lg:text-[5.7rem] xl:text-[6.65rem] 2xl:text-[7.25rem]">
                <span className="block">The complete</span>
                <span className="block">financial stack</span>
                <span className="block italic text-ink-muted">for AI agents.</span>
              </h1>

              <p className="animate-fade-up mt-6 max-w-[42rem] font-sans text-base font-light leading-relaxed text-ink-muted opacity-0 [animation-delay:160ms] sm:text-lg xl:max-w-[46rem] xl:text-xl">
                Let agents make payments within your limits, ask for approval when needed, and track every transaction.
              </p>

              <div className="animate-fade-up mt-8 flex flex-col gap-4 opacity-0 [animation-delay:240ms] sm:flex-row sm:items-center">
                {ready && !authenticated && (
                  <>
                    <button
                      onClick={login}
                      className="bg-black px-8 py-4 hover:cursor-pointer font-mono text-xs uppercase tracking-[0.2em] text-beige transition-colors hover:bg-ink"
                    >
                      sign in
                    </button>
                    <Link
                      href="/dashboard"
                      className="border border-beige-darker bg-beige/70 px-8 py-4 text-center font-mono text-xs uppercase tracking-[0.2em] text-ink-muted transition-colors hover:border-ink-muted hover:text-black"
                    >
                      try dashboard
                    </Link>
                  </>
                )}
                {ready && authenticated && (
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="bg-black px-8 py-4 font-mono text-xs uppercase tracking-[0.2em] text-beige transition-colors hover:bg-ink"
                  >
                    open dashboard
                  </button>
                )}
              </div>
            </div>

            <div className="animate-fade-up opacity-0 [animation-delay:320ms]">
              <AgentWalletVisual />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-beige-darker bg-[#f8f4ed] px-6 sm:px-10 lg:px-16">
        <div className="mx-auto grid max-w-7xl grid-cols-2 border-x border-beige-darker md:grid-cols-5">
          {moneyStack.map((item, index) => (
            <div
              key={item.label}
              className={`px-5 py-8 text-center ${index < moneyStack.length - 1 ? 'md:border-r md:border-beige-darker' : ''} ${index % 2 === 0 ? 'border-r border-beige-darker md:border-r' : ''}`}
            >
              <p className="font-serif text-4xl font-black leading-none text-black">{item.label}</p>
              <p className="mt-3 font-mono text-[0.62rem] uppercase tracking-[0.15em] text-ink-muted">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 py-20 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 border-b border-beige-darker pb-10">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-ink-muted">
              what Agentis includes
            </p>
            <h2 className="mt-8 max-w-[72rem] font-serif text-5xl font-black leading-[0.94] tracking-normal text-black sm:text-6xl lg:text-7xl xl:text-[5.75rem]">
              One platform for the money side of agents.
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {productSections.map(section => (
              <article
                key={section.kicker}
                className="border border-beige-darker bg-[#f8f4ed]/70 p-7 shadow-[8px_8px_0_rgba(42,38,32,0.045)] sm:p-8"
              >
                <p className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-ink-muted">
                  {section.kicker}
                </p>
                <h3 className="mt-6 max-w-xl font-serif text-4xl font-black leading-[0.96] tracking-normal text-black sm:text-5xl">
                  {section.title}
                </h3>
                <p className="mt-6 max-w-2xl font-sans text-base font-light leading-relaxed text-ink-muted sm:text-lg">
                  {section.body}
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-3">
                  {section.items.map(item => (
                    <div
                      key={item}
                      className="flex min-h-20 items-center justify-center border border-beige-darker bg-white px-4 py-4 text-center font-mono text-[0.68rem] uppercase tracking-[0.12em] text-black"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 pb-20 sm:px-10 lg:px-16">
        <div className="mx-auto grid max-w-7xl gap-10 border border-beige-darker bg-black p-8 text-beige shadow-[12px_12px_0_rgba(42,38,32,0.08)] sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-beige/55">
              operating surfaces
            </p>
            <h2 className="mt-6 max-w-4xl font-serif text-5xl font-black leading-[0.92] tracking-normal sm:text-7xl">
              Dashboard for humans. SDK and MCP for agents. CLI for both.
            </h2>
            <p className="mt-7 max-w-2xl font-sans text-lg font-light leading-relaxed text-beige/70">
              One SDK for operation requests, approval links and receipts. The current foundation executes locally; hosted signing and financial plugins are being verified.
            </p>
            <Link
              href="https://docs.agentis.systems"
              target="_blank"
              rel="noreferrer noopener"
              className="group mt-8 inline-flex items-center gap-3 border border-beige/30 px-6 py-4 font-mono text-xs uppercase tracking-[0.18em] text-beige transition-colors hover:border-beige/70 hover:bg-beige hover:text-black"
            >
              go to docs
              <span aria-hidden="true" className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
                ↗
              </span>
            </Link>
          </div>
          <div className="grid gap-3 font-mono text-xs uppercase tracking-[0.18em] sm:grid-cols-2 lg:w-80">
            {['dashboard', 'CLI', 'SDK', 'MCP', 'SKILL.md'].map(label => (
              <div key={label} className="border border-beige/25 px-5 py-4 text-beige/80">
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="flex flex-col gap-3 border-t border-beige-darker px-6 py-6 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-12">
        <span>agentis.systems</span>
        <span>ETHOnline rewrite · 2026</span>
      </footer>
    </main>
  )
}
