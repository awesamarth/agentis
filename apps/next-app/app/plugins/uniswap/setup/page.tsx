'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAgentisClient } from '@/lib/agentis'
import Navbar from '@/components/Navbar'
import { UniswapLogo } from '@/components/PluginPicker'

function Review() {
  const id = useSearchParams().get('request') ?? ''
  const { ready, authenticated, login, user } = usePrivy()
  const client = useAgentisClient('Sign in first')
  const request = useQuery({ queryKey: ['uniswap-setup', user?.id, id], enabled: authenticated && !!id, queryFn: () => client.uniswap.dca.setup(id) })
  const wallets = useQuery({ queryKey: ['wallets', user?.id], enabled: authenticated, queryFn: () => client.wallets.list() })
  const decision = useMutation({ mutationFn: (approve: boolean) => client.uniswap.dca.completeSetup(id, approve) })
  const wallet = wallets.data?.find(w => w.id === request.data?.walletId)
  const input = request.data?.input ?? request.data?.currentSchedule
  return <><Navbar /><main className="mx-auto max-w-xl px-6 py-16"><div className="flex items-center gap-3"><UniswapLogo /><h1 className="font-serif text-3xl font-bold">Review schedule request</h1></div>
    {!id ? <p className="mt-6">Missing request ID.</p> : !ready ? <p className="mt-6">Loading…</p> : !authenticated ? <button className="mt-6 bg-black px-5 py-3 text-sm text-beige" onClick={login}>Sign in to review</button> : decision.data ? <p className="mt-6">{decision.data.approved ? 'Confirmed. You can return to your client.' : 'Request declined. No schedule changes were made.'}</p> : request.data ? <div className="mt-6 space-y-5 border border-beige-darker bg-[#faf7f1] p-6"><p className="font-serif text-xl font-bold">{wallet?.agentName ?? 'Agent'} · {request.data.action}</p><p className="break-all font-mono text-xs">{wallet?.address}</p>{input && <><p>{input.kind === 'gas_refill' ? `Refill ETH toward ${input.request.amount} ETH using USDC` : `${input.request.amount} ${input.request.tokenIn} → ${input.request.tokenOut}`}, every {input.intervalMinutes} minutes</p><p className="text-sm">Slippage: {input.request.slippageBps ?? 50} bps · Fee cap per transaction: {input.request.maxFee ?? '0.0001'} ETH</p></>}<p className="text-sm text-ink-muted">This authorizes a recurring schedule change, not just a one-time tool call. Automatic mode runs unattended within this agent’s limits. Ask mode still requires payment approval. Pause or cancel from the agent’s Plugins section.</p>{request.data.completed ? <p>Request already completed or expired.</p> : <div className="flex gap-3"><button disabled={decision.isPending} className="border border-beige-darker px-4 py-2 text-sm disabled:opacity-40" onClick={() => decision.mutate(false)}>Decline</button><button disabled={decision.isPending} className="bg-black px-4 py-2 text-sm text-beige disabled:opacity-40" onClick={() => decision.mutate(true)}>{decision.isPending ? 'Saving…' : 'Confirm schedule change'}</button></div>}</div> : <p className="mt-6">Loading request…</p>}
    {(request.error || decision.error || wallets.error) && <p role="alert" className="mt-5 text-sm">{request.error?.message ?? decision.error?.message ?? wallets.error?.message}</p>}
  </main></>
}
export default function Page() { return <Suspense fallback={<p className="p-8">Loading…</p>}><Review /></Suspense> }
