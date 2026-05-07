import Link from 'next/link'
import Image from 'next/image'

const features = [
  'wallets',
  'payments',
  'policies',
  'privacy',
  'yield',
]

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-beige text-ink">
      <section className="relative min-h-screen px-6 py-6 sm:px-10 lg:px-16">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(42,38,32,0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgba(42,38,32,0.055)_1px,transparent_1px)] bg-size-[48px_48px]" />
        <div className="absolute inset-y-0 right-0 w-[58%] bg-[radial-gradient(circle_at_60%_35%,rgba(153,201,255,0.34),rgba(245,240,232,0)_58%)]" />
        <div className="absolute -right-10 top-0 hidden select-none font-serif text-[32rem] font-black leading-none text-black/[0.035] lg:block">
          A
        </div>

        <div className="relative z-10 flex min-h-[calc(100vh-3rem)] flex-col border border-beige-darker/90 bg-beige/45 backdrop-blur-[1px]">
          <header className="flex items-center justify-between border-b border-beige-darker/80 px-5 py-4 sm:px-8">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center bg-black font-serif text-xl font-black text-beige">
                A
              </span>
              <span className="font-mono text-sm uppercase tracking-[0.28em] text-black sm:text-base">
                Agentis
              </span>
            </Link>

            <span className="hidden font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-muted sm:block">
              alpha
            </span>
          </header>

          <div className="grid flex-1 items-center gap-12 px-5 py-14 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20 lg:px-16 lg:py-20">
            <div>
              <div className="animate-fade-up mb-8 inline-flex items-center gap-3 border border-beige-darker bg-beige/70 px-4 py-2 opacity-0">
                <Image src="/solana-logo.png" alt="" width={28} height={18} className="h-4 w-auto" />
                <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-muted">
                  built on Solana
                </span>
              </div>

              <h1
                className="animate-fade-up max-w-5xl font-serif font-black leading-[0.88] tracking-[-0.035em] text-black opacity-0 [animation-delay:80ms]"
                style={{ fontSize: 'clamp(4.25rem, 11vw, 10rem)' }}
              >
                Financial
                <br />
                infrastructure
                <br />
                <span className="italic text-ink-muted">for agents.</span>
              </h1>

              <p className="animate-fade-up mt-8 max-w-2xl font-sans text-lg font-light leading-relaxed text-ink-muted opacity-0 [animation-delay:160ms] sm:text-xl">
                Agentis gives AI agents wallets, payments, policy enforcement, privacy, and yield on Solana.
              </p>

              <div className="animate-fade-up mt-10 flex flex-col items-start gap-4 opacity-0 [animation-delay:240ms] sm:flex-row sm:items-center sm:gap-6">
                <span className="font-mono text-base uppercase tracking-[0.3em] text-black sm:text-lg">
                  coming soon
                </span>
                <a
                  href="https://x.com/agentis_hq"
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted transition-colors hover:text-black sm:border sm:border-beige-darker sm:bg-beige/70 sm:px-5 sm:py-3 sm:hover:border-ink-muted"
                >
                  follow @agentis_hq
                </a>
              </div>
            </div>

            <aside className="animate-fade-up border border-beige-darker bg-[#f8f4ed]/70 p-6 opacity-0 shadow-[10px_10px_0_rgba(42,38,32,0.06)] [animation-delay:320ms] sm:p-8">
              <div className="mb-10 flex items-start justify-between gap-8">
                <div>
                  <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-ink-muted">
                    status
                  </p>
                  <p className="mt-3 font-serif text-3xl font-black text-black">
                    Alpha
                  </p>
                </div>
                <div className="h-3 w-3 rounded-full bg-accent shadow-[0_0_24px_rgba(200,169,110,0.5)]" />
              </div>

              <div className="space-y-4">
                {features.map((feature) => (
                  <div
                    key={feature}
                    className="flex items-center justify-between border-t border-beige-darker/80 pt-4"
                  >
                    <span className="font-mono text-xs uppercase tracking-[0.18em] text-black">
                      {feature}
                    </span>
                    <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
                      live / in progress
                    </span>
                  </div>
                ))}
              </div>
            </aside>
          </div>

          <footer className="flex flex-col gap-3 border-t border-beige-darker/80 px-5 py-4 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <span>agentis.systems</span>
            <span>Colosseum build · 2026</span>
          </footer>
        </div>
      </section>
    </main>
  )
}
