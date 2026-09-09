'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}><PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ['google', 'github', 'wallet'],
        appearance: {
          theme: 'light',
          accentColor: '#c8a96e',
          logo: undefined,
          walletChainType: 'ethereum-and-solana',
          walletList: ['detected_solana_wallets', 'phantom', 'solflare', 'backpack', 'wallet_connect'],
        },
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors(),
          },
        },
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
          solana: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      {children}
    </PrivyProvider></QueryClientProvider>
  )
}
