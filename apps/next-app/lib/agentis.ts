'use client'

import { useMemo } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { AgentisClient } from '@agentis-hq/sdk'

const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001'

export function useAgentisClient(message = 'Sign in again') {
  const { getAccessToken } = usePrivy()
  return useMemo(() => new AgentisClient({
    baseUrl,
    token: async () => {
      const token = await getAccessToken()
      if (!token) throw new Error(message)
      return token
    },
  }), [getAccessToken, message])
}
