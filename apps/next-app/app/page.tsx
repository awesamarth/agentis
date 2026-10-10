'use client'

import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'
import PluginShowcase from '@/components/landing/PluginShowcase'

const capabilities = [
  {
    label: 'Agent wallets',
    title: 'A wallet for each agent. A clear view for you.',
    body: 'Keep each agent’s funds, spending limits and payment history separate. See balances across its networks in one place.',
    detail: 'Independent agents · shared limits across their wallets',
  },
  {
    label: 'Paid APIs',
    title: 'Let your agent pay for the tools it needs.',
    body: 'Buy access to search, data and image generation through APIs that accept x402 or MPP. Your agent gets the response; you get the payment record.',
    detail: 'x402 · MPP · payment history',
  },
  {
    label: 'Service discovery',
    title: 'Find a service. See how to pay.',
    body: 'Search a catalog of paid services and inspect their endpoints and payment options before your agent makes a request.',
    detail: 'Discovery doesn’t make a purchase',
  },
  {
    label: 'Transfers',
    title: 'Send money without handing over the wallet.',
    body: 'Let agents send supported tokens to the recipients you allow. Choose their networks and spending limits, and review payments in Ask mode.',
    detail: 'Your wallets · your recipients · your limits',
  },
]

const connections = [
  { name: 'MCP', description: 'Connect your AI assistant to Agentis.', href: 'https://docs.agentis.systems/docs/mcp' },
  { name: 'CLI', description: 'Use Agentis from your terminal or agent harness.', href: 'https://docs.agentis.systems/docs/cli' },
  { name: 'SDK', description: 'Add wallets and payments to your application.', href: 'https://docs.agentis.systems/docs/sdk' },
]

const eyebrow = 'font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-muted'

function AgentWalletVisual() {
  return (
    <figure aria-label="Example agent wallet with illustrative balances and payments" className="relative mx-auto w-full max-w-lg">
      <div aria-hidden="true" className="absolute inset-0 translate-x-3 translate-y-3 bg-black/[0.06]" />
      <div className="relative border-2 border-ink bg-[#f8f4ed] p-1">
        <div className="border border-beige-darker p-5 sm:p-7">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-beige-darker pb-5">
            <div>
              <p className={eyebrow}>Agent wallet</p>
              <p className="mt-2 font-serif text-2xl font-bold text-black sm:text-3xl">research-agent</p>
            </div>
            <span className="border border-ink px-3 py-2 font-mono text-[0.65rem] uppercase tracking-wide">Ask mode</span>
          </header>
          <div className="py-6">
            <p className={eyebrow}>Wallet balance</p>
            <p className="mt-3 font-mono text-5xl font-medium tracking-tight text-black sm:text-6xl">$128.40</p>
            <p className="mt-3 text-xs text-ink-muted">Across this agent’s mainnet wallets</p>
          </div>
          <div className="border border-beige-darker bg-white/70 p-4">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span>Daily spending</span>
              <span className="font-mono text-xs">$5.10 <span className="text-ink-muted">/ $25.00</span></span>
            </div>
            <div aria-hidden="true" className="mt-3 h-1.5 bg-beige-darker"><div className="h-full w-[20.4%] bg-ink" /></div>
          </div>
          <div className="mt-6 divide-y divide-beige-darker border-y border-beige-darker">
            {[
              { title: 'Web search', detail: 'Results received', amount: '$0.02' },
              { title: 'Image generation', detail: 'Image link received', amount: '$0.01' },
            ].map(item => <div key={item.title} className="flex items-center justify-between gap-4 py-3.5">
              <div><p className="text-sm">{item.title}</p><p className="mt-1 text-xs text-ink-muted">{item.detail}</p></div>
              <span className="font-mono text-sm">{item.amount}</span>
            </div>)}
          </div>
          <div className="mt-5 flex items-center justify-between gap-4 border-l-2 border-ink pl-3">
            <div><p className="text-sm">Send USDC</p><p className="mt-1 text-xs text-ink-muted">Waiting for your approval</p></div>
            <span className="font-mono text-sm">$5.00</span>
          </div>
          <p className="mt-5 font-mono text-[0.6rem] uppercase tracking-wider text-ink-muted">Example activity · illustrative amounts</p>
        </div>
      </div>
    </figure>
  )
}

export default function LandingPage() {
  const { ready, authenticated, login } = usePrivy()
  const router = useRouter()

  return (
    <main className="min-h-screen bg-beige text-ink">
      <Navbar />
      <section className="relative overflow-hidden px-6 py-14 sm:px-10 sm:py-20 lg:px-12">
        <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(to_right,rgba(42,38,32,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(42,38,32,0.045)_1px,transparent_1px)] bg-size-[52px_52px]" />
        <div aria-hidden="true" className="absolute -right-16 top-8 hidden select-none font-serif text-[30rem] font-black leading-none text-black/[0.035] xl:block">A</div>
        <div className="relative mx-auto grid max-w-350 items-center gap-14 lg:min-h-[calc(100svh-16rem)] lg:grid-cols-[1.2fr_1fr] lg:gap-12 xl:gap-20">
          <div>
            <div className="animate-fade-up mb-6 inline-flex items-center gap-3 border border-beige-darker bg-beige/80 px-4 py-2 opacity-0">
              <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center bg-black font-serif text-sm font-black text-beige">A</span>
              <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-muted">Wallets & payments for AI agents</span>
            </div>
            <h1 className="animate-fade-up max-w-none font-serif text-5xl font-black leading-[0.92] tracking-normal text-black opacity-0 [animation-delay:80ms] sm:text-6xl md:text-[4.7rem] lg:text-[5.7rem] xl:text-[6.65rem] 2xl:text-[7.25rem]">
              <span className="block">The complete</span>
              <span className="block">financial stack</span>
              <span className="block italic text-ink-muted">for AI agents.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg font-light leading-relaxed text-ink-muted sm:text-xl">
              Let your AI agents pay for services and send money. You set the spending limits and decide when approval is needed.
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <button disabled={!ready} onClick={() => authenticated ? router.push('/dashboard') : login()} className="cursor-pointer bg-black px-7 py-4 font-mono text-xs uppercase tracking-[0.16em] text-beige transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-wait disabled:opacity-60">
                {authenticated ? 'Open dashboard' : 'Get started'} <span aria-hidden="true">↗</span>
              </button>
              <a href="#how-it-works" className="border border-beige-darker px-7 py-4 text-center font-mono text-xs uppercase tracking-[0.16em] transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-4">See how it works <span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <AgentWalletVisual />
        </div>
      </section>

      <section aria-label="Wallet networks" className="border-y border-beige-darker bg-[#f8f4ed] px-6 sm:px-10 lg:px-16">
        <ul className="mx-auto grid max-w-7xl grid-cols-2 border-x border-beige-darker md:grid-cols-5">
          {[
            { name: 'Base', assets: 'ETH · USDC' },
            { name: 'Ethereum', assets: 'ETH · USDC' },
            { name: 'Tempo', assets: 'OUSD · USDC.e · pathUSD' },
            { name: 'Solana', assets: 'SOL · USDC' },
            { name: 'Arc', assets: 'USDC' },
          ].map((network, index) => <li key={network.name} className={`px-5 py-8 text-center ${index < 4 ? 'md:border-r md:border-beige-darker' : ''} ${index % 2 === 0 ? 'border-r border-beige-darker md:border-r' : ''}`}>
            <p className="font-serif text-2xl font-black leading-none text-black sm:text-3xl xl:text-4xl">{network.name}</p>
            <p className="mt-3 font-mono text-[0.62rem] uppercase tracking-[0.15em] text-ink-muted">{network.assets}</p>
          </li>)}
        </ul>
      </section>

      <section id="capabilities" className="scroll-mt-8 px-6 py-16 sm:px-10 sm:py-20 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 border-b border-beige-darker pb-10">
            <p className={eyebrow}>What your agent can do</p>
            <h2 className="mt-8 max-w-[72rem] font-serif text-5xl font-black leading-[0.94] tracking-normal text-black sm:text-6xl lg:text-7xl xl:text-[5.75rem]">Put its budget to work.</h2>
          </div>
          <div className="grid auto-rows-fr items-stretch gap-5 md:grid-cols-2">
            {capabilities.map(item => <article key={item.label} className="border border-beige-darker bg-[#f8f4ed]/70 p-6 shadow-[6px_6px_0_rgba(42,38,32,0.045)] sm:p-8">
              <p className={eyebrow}>{item.label}</p>
              <h3 className="mt-6 max-w-xl font-serif text-4xl font-black leading-[0.96] tracking-normal text-black sm:text-5xl">{item.title}</h3>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">{item.body}</p>
              <p className="mt-7 border-t border-beige-darker pt-4 font-mono text-xs leading-relaxed text-ink-muted">{item.detail}</p>
            </article>)}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-8 border-y border-beige-darker bg-[#f8f4ed] px-6 py-16 sm:px-10 sm:py-20 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1.35fr] lg:gap-16">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">You make the rules</p>
              <h2 className="mt-5 max-w-3xl font-serif text-5xl font-black leading-[1.02] tracking-[-0.02em] text-black sm:text-6xl lg:text-[4rem]">Give it a budget.<br />Choose how it spends.</h2>
              <div className="mt-10 space-y-7">
                <div><h3 className="font-serif text-3xl font-bold">One agent. One spending budget.</h3><p className="mt-3 max-w-xl text-lg leading-relaxed text-ink-muted">Set limits per payment, per hour, per day and overall, in USD. Your agent’s enabled wallets share those limits across networks.</p></div>
                <div><h3 className="font-serif text-3xl font-bold">Access you can take back.</h3><p className="mt-3 max-w-xl text-lg leading-relaxed text-ink-muted">Choose which wallets and networks a connected tool can use. Pause new payments or revoke its access when you need to.</p></div>
                <p className="border-l-2 border-ink pl-4 text-base leading-relaxed text-ink-muted">Agents can request payments—not raise their own limits or approve themselves. Pausing won’t undo a payment already sent.</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { name: 'Ask', title: 'You approve the payment.', body: 'Review who gets paid, how much and the fees before it goes through.', example: '“Send $5 USDC” → waiting for you' },
                { name: 'Auto', title: 'Your agent keeps moving.', body: 'Let payments proceed within your rules, without an Agentis approval prompt each time.', example: 'Within limits → ready to pay' },
              ].map(mode => <article key={mode.name} className="flex flex-col border-2 border-ink bg-beige p-1">
                <div className="flex h-full flex-col border border-beige-darker p-5 sm:p-6">
                  <p className="font-mono text-sm uppercase tracking-[0.18em]">{mode.name} mode</p>
                  <h3 className="mt-5 font-serif text-4xl font-bold leading-tight">{mode.title}</h3>
                  <p className="mt-4 flex-1 text-lg leading-relaxed text-ink-muted">{mode.body}</p>
                  <p className="mt-7 border-t border-beige-darker pt-4 font-mono text-xs leading-relaxed">{mode.example}</p>
                </div>
              </article>)}
              <p className="text-sm leading-relaxed text-ink-muted sm:col-span-2">For card purchases, Agentcard or your bank may still ask for approval.</p>
            </div>
          </div>
        </div>
      </section>

      <PluginShowcase />

      <section id="connect" className="px-6 pb-16 sm:px-10 sm:pb-20 lg:px-12">
        <div className="mx-auto max-w-7xl border-2 border-ink bg-black p-1 text-beige shadow-[10px_10px_0_rgba(42,38,32,0.08)]">
          <div className="grid gap-10 border border-beige/25 p-6 sm:p-10 lg:grid-cols-[1.3fr_1fr] lg:items-center lg:gap-14">
            <div className="@container min-w-0">
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-beige/60">Connect your agent</p>
              <h2 className="mt-6 font-serif text-[min(3.75rem,8cqw)] font-black leading-[1.02]">
                <span className="block whitespace-nowrap">Dashboard for humans.</span>
                <span className="block whitespace-nowrap">SDK and MCP for agents.</span>
                <span className="block whitespace-nowrap italic text-beige/70">CLI for both.</span>
              </h2>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-beige/75">Set up your agent, choose its wallets and spending rules, then connect the tools it uses. Manage approvals and follow its activity from your dashboard.</p>
              <Link href="/dashboard" className="mt-7 inline-block border border-beige/40 px-6 py-3 font-mono text-xs uppercase tracking-wider transition-colors hover:bg-beige hover:text-black focus-visible:outline-2 focus-visible:outline-offset-4">Open dashboard <span aria-hidden="true">↗</span></Link>
            </div>
            <div className="space-y-3">
              {connections.map(connection => <a key={connection.name} href={connection.href} target="_blank" rel="noopener noreferrer" className="group block border border-beige/25 p-5 transition-colors hover:border-beige/70 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-4">
                <div className="flex items-center justify-between gap-4"><h3 className="font-mono text-sm tracking-wide">{connection.name}</h3><span aria-hidden="true" className="text-beige/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">↗</span></div>
                <p className="mt-2 text-sm leading-relaxed text-beige/70">{connection.description}</p>
              </a>)}
              <a href="https://docs.agentis.systems" target="_blank" rel="noopener noreferrer" className="inline-block pt-2 font-mono text-xs text-beige/70 underline underline-offset-4 hover:text-beige">Browse all documentation <span aria-hidden="true">↗</span></a>
            </div>
          </div>
        </div>
      </section>
      <footer className="flex flex-col gap-3 border-t border-beige-darker px-6 py-6 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-12">
        <span>agentis.systems</span><span>Wallets & payments for AI agents · 2026</span>
      </footer>
    </main>
  )
}
