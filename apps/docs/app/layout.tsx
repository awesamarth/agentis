import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { RootProvider } from 'fumadocs-ui/provider/next'
import './global.css'

export const metadata: Metadata = {
  title: 'Agentis Docs',
  description: 'Developer documentation for Agentis wallets, payments, policy, privacy, yield, CLI, SDK, and MCP.',
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-fd-background font-sans text-fd-foreground">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
