'use client'

import { usePrivy } from '@privy-io/react-auth'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'

export default function Navbar({ showCrumb }: { showCrumb?: string }) {
  const { ready, authenticated, user, login, logout } = usePrivy()

  return (
    <nav className="flex items-center justify-between px-6 py-5 sm:px-12 sm:py-6 border-b border-beige-darker">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-black flex items-center justify-center font-serif text-beige text-lg font-black cursor-pointer">
            A
          </div>
          <span className="font-mono text-base tracking-[0.15em] text-black uppercase">Agentis</span>
        </Link>
        {showCrumb && (
          <span className="font-mono text-[0.65rem] text-ink-muted tracking-widest leading-none translate-y-px">/ {showCrumb}</span>
        )}
      </div>

      <div className="flex items-center gap-3 sm:gap-6">
        <a
          href="https://docs.agentis.systems"
          target="_blank"
          rel="noreferrer"
          className="hidden items-center gap-1.5 sm:inline-flex font-mono text-xs text-ink-muted tracking-widest hover:text-ink transition-colors"
        >
          docs
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
        </a>
        <Link href="/dashboard" className="hidden sm:block font-mono text-xs text-ink-muted tracking-widest hover:text-ink transition-colors">
          dashboard
        </Link>
        {ready && authenticated ? (
          <>
            <Link href="/dashboard/profile" className="font-mono text-xs text-ink-muted tracking-wide hover:text-ink transition-colors">
              {user?.google?.email ?? (user?.wallet?.address ? user.wallet.address.slice(0, 6) + '...' + user.wallet.address.slice(-4) : 'anon')}
            </Link>
            <button
              onClick={logout}
              className="font-mono text-xs text-ink-muted tracking-widest border border-beige-darker px-4 py-1.5 hover:border-ink-muted transition-colors cursor-pointer"
            >
              sign out
            </button>
          </>
        ) : (
          <>
            <button
              onClick={login}
              className="bg-black text-beige font-mono text-xs tracking-widest px-5 py-2 hover:bg-ink transition-colors cursor-pointer"
            >
              sign in
            </button>
          </>
        )}
      </div>
    </nav>
  )
}
