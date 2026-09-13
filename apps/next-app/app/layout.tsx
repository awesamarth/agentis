import type { Metadata } from 'next'
import './globals.css'
import Providers from './providers'

const description = 'Complete financial infrastructure for AI agents. Wallets, payments, spending controls and on-chain identity.'
const socialImage = {
  url: '/agentis-og.png',
  width: 1200,
  height: 630,
  alt: 'Agentis - Complete financial infrastructure for AI agents',
}

export const metadata: Metadata = {
  metadataBase: new URL('https://agentis.systems'),
  title: 'Agentis - Financial Infrastructure for Agents',
  description,
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: 'Agentis - Financial Infrastructure for Agents',
    description,
    url: 'https://agentis.systems',
    siteName: 'Agentis',
    images: [socialImage],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Agentis - Financial Infrastructure for Agents',
    description,
    images: [socialImage],
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
