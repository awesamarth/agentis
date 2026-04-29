import { getMetrics } from './ledger'

export function startHeartbeat() {
  const apiUrl = process.env.AGENTIS_API_URL
  const id = process.env.AGENTIS_FACILITATOR_ID
  const secret = process.env.AGENTIS_HEARTBEAT_SECRET
  if (!apiUrl || !id || !secret) {
    console.warn('[heartbeat] disabled: missing Agentis heartbeat env')
    return
  }

  const send = async () => {
    try {
      const metrics = getMetrics()
      await fetch(`${apiUrl}/facilitators/${id}/heartbeat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentis-heartbeat-secret': secret,
        },
        body: JSON.stringify({
          publicUrl: process.env.AGENTIS_PUBLIC_URL || null,
          version: 'agentis-facilitator/0.1.0',
          supported: ['x402', process.env.NETWORK ?? 'solana-devnet'],
          feeBps: Number(process.env.FACILITATOR_FEE_BPS ?? 500),
          ...metrics,
        }),
      })
    } catch (err) {
      console.warn('[heartbeat] failed', err instanceof Error ? err.message : err)
    }
  }

  void send()
  setInterval(send, 30_000).unref()
}
