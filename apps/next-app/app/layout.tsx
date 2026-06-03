import type { Metadata } from 'next'
import './globals.css'
import Providers from './providers'

export const metadata: Metadata = {
  metadataBase: new URL('https://agentis.systems'),
  title: 'Agentis - Financial Infrastructure for Agents',
  description: 'Wallets, payments, policy enforcement, privacy, and yield for AI agents on Solana.',
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: 'Agentis - Financial Infrastructure for Agents',
    description: 'Wallets, payments, policy enforcement, privacy, and yield for AI agents on Solana.',
    url: 'https://agentis.systems',
    siteName: 'Agentis',
    images: [
      {
        url: '/agentis-twitter-header.png',
        width: 1200,
        height: 630,
        alt: 'Agentis - Complete financial infrastructure for AI agents on Solana',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Agentis - Financial Infrastructure for Agents',
    description: 'Wallets, payments, policy enforcement, privacy, and yield for AI agents on Solana.',
    images: [
      {
        url: '/agentis-twitter-header.png',
        width: 1200,
        height: 630,
        alt: 'Agentis - Complete financial infrastructure for AI agents on Solana',
      },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
