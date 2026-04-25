'use client'

import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function Navbar({ showCrumb }: { showCrumb?: string }) {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const router = useRouter()

  return (
    <nav className="flex items-center justify-between px-12 py-6 border-b border-beige-darker">
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

      <div className="flex items-center gap-6">
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
            <a href="/dashboard" className="font-mono text-xs text-ink-muted tracking-widest hover:text-ink transition-colors">
              try without login →
            </a>
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
