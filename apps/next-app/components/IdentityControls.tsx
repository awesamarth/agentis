'use client'
import { useEffect, useRef, useState } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AgentisClient, type AgentisAgent, type IdentityStep } from '@agentis-hq/sdk'
import { createPublicClient, createWalletClient, custom, http, parseEther, formatEther, type Address, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import Dropdown from './Dropdown'

export const ensDescription = 'ENSv2 namespace + ERC-8004 identity on Ethereum Sepolia. Wallet records enable payments on your other testnets. Identity does not grant spending permission.'
const button = 'border border-beige-darker px-4 py-2.5 text-base font-medium hover:border-ink disabled:opacity-40'
const field = 'mt-1 w-full border border-beige-darker bg-beige p-3 text-base'
const chain = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com', { timeout: 15000, retryCount: 0 }) })
export default function IdentityControls({ agent, initialParent = '', initialLabel = '', initialOperation = '', showDescription = true }: { agent: AgentisAgent; initialParent?: string; initialLabel?: string; initialOperation?: string; showDescription?: boolean }) {
  const { user, getAccessToken, connectWallet } = usePrivy(), { wallets: connected } = useWallets(), cache = useQueryClient()
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw Error('Sign in again'); return token } })
  const wallets = useQuery({ queryKey: ['wallets', user?.id], queryFn: () => client.wallets.list() })
  const wallet = wallets.data?.find(w => w.agentId === agent.id && w.enabled && w.chainId === 'eip155:11155111')
  const identity = useQuery({ queryKey: ['identity', user?.id, agent.id, wallet?.id], enabled: !!wallet, retry: false, queryFn: () => client.identity.show(wallet!.id) })
  const [parent, setParent] = useState(initialParent), [label, setLabel] = useState(initialLabel || agent.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')), [description, setDescription] = useState('')
  const [record, setRecord] = useState<'endpoint' | 'description'>('endpoint'), [value, setValue] = useState(''), [notice, setNotice] = useState('')
  const [selectedStep, setStep] = useState<IdentityStep | null>(null), [setupFlow, setSetupFlow] = useState(true)
  const dialog = useRef<HTMLDialogElement>(null), requestKey = useRef('')
  const requestedOperation = useQuery({ queryKey: ['identity-review', user?.id, wallet?.id, initialOperation], enabled: !!wallet && !!initialOperation, retry: false, queryFn: async () => { const operation = await client.operations.get(initialOperation); if (operation.walletId !== wallet!.id || !operation.identity) throw Error('Operation does not belong to this identity wallet'); return operation } })
  const step = selectedStep ?? (requestedOperation.data ? { complete: false, owner: identity.data?.owner ?? '', label: 'Review identity operation', operation: requestedOperation.data } : null)
  useEffect(() => { if (requestedOperation.data && !dialog.current?.open) dialog.current?.showModal() }, [requestedOperation.data])
  const refresh = () => Promise.all(['identity', 'wallets', 'agents', 'operations'].map(key => cache.invalidateQueries({ queryKey: [key] })))
  function present(next: IdentityStep) { setStep(next); if (next.complete) { dialog.current?.close(); setNotice('ENSv2 and ERC-8004 identity configured.'); void refresh() } else dialog.current?.showModal() }
  const enable = useMutation({ mutationFn: () => client.agents.update(agent.id, { name: agent.name, limits: agent.limits, mode: agent.mode, allowedRecipients: agent.allowedRecipients, plugins: [...new Set([...agent.plugins, 'ens' as const])], selection: { networks: [...new Set([...agent.networks, 'sepolia'])], defaultNetwork: agent.defaultNetwork }, enableExecution: true }), onSuccess: refresh })
  const setup = useMutation({ mutationFn: () => client.identity.setup({ walletId: wallet!.id, parent, label, description }), onSuccess: next => { setSetupFlow(true); present(next) } })
  const resume = useMutation({ mutationFn: () => client.identity.next(wallet!.id), onSuccess: next => { setSetupFlow(true); present(next) } })
  const delegate = useMutation({ mutationFn: (grant: boolean) => client.identity.delegation(wallet!.id, record, grant), onSuccess: next => { setSetupFlow(false); present(next) } })
  const update = useMutation({ mutationFn: () => { if (!requestKey.current) requestKey.current = crypto.randomUUID(); return client.identity.update({ walletId: wallet!.id, key: record, value }, { idempotencyKey: requestKey.current }) }, onSuccess: operation => { setSetupFlow(false); present({ complete: false, owner: identity.data!.owner, label: `Update ${record}`, operation }); requestKey.current = '' } })
  const submit = useMutation({ mutationFn: async () => {
    if (!step) return
    if (step.transaction) {
      const selected = connected.find(w => w.address.toLowerCase() === step.owner.toLowerCase())
      if (!selected) throw Error(`Connect the namespace owner wallet ${step.owner} first.`)
      await selected.switchChain(sepolia.id)
      const signer = createWalletClient({ account: step.owner as Address, chain: sepolia, transport: custom(await selected.getEthereumProvider()) })
      const storedKey = `agentis-identity-pending:${agent.id}`, pending = sessionStorage.getItem(storedKey)
      let hash = pending as Hex | null
      if (!hash) {
        const transaction = await signer.prepareTransactionRequest({ to: step.transaction.to as Address, data: step.transaction.data as Hex, value: BigInt(step.transaction.value), type: 'eip1559' })
        if (transaction.gas * transaction.maxFeePerGas > parseEther('0.002')) throw Error('Estimated Sepolia gas exceeds the 0.002 ETH setup cap')
        hash = await signer.sendTransaction(transaction)
        sessionStorage.setItem(storedKey, hash)
      }
      const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 60000 })
      sessionStorage.removeItem(storedKey)
      if (receipt.status !== 'success') throw Error('Namespace transaction reverted. Refresh the setup before retrying.')
    } else if (step.operation) {
      let operation = await client.operations.get(step.operation.id)
      if (operation.status === 'failed' && operation.error === 'Preparation failed before submission' && !operation.transactionHash) { present(await client.identity.retry(wallet!.id, operation.id)); return }
      if (operation.status === 'pending_approval') operation = await client.operations.approve(operation.id, operation.operationHash)
      if (['failed', 'denied', 'expired', 'rejected'].includes(operation.status)) throw Error(operation.error ?? `Operation ${operation.status}`)
      for (let i = 0; i < 25 && operation.status !== 'confirmed'; i++) { await new Promise(resolve => setTimeout(resolve, 2000)); operation = await client.operations.get(operation.id); if (['failed', 'denied', 'expired', 'rejected'].includes(operation.status)) throw Error(operation.error ?? operation.status) }
      if (operation.status !== 'confirmed') throw Error('Still confirming. Use Check status; do not create another request.')
    }
    await refresh()
    if (setupFlow) present(await client.identity.next(wallet!.id)); else { dialog.current?.close(); setNotice('Identity change confirmed.') }
  } })
  const busy = enable.isPending || setup.isPending || resume.isPending || delegate.isPending || update.isPending || submit.isPending
  const error = enable.error ?? setup.error ?? resume.error ?? delegate.error ?? update.error
  return <div className="space-y-4">
    {showDescription && <p className="text-base leading-relaxed text-ink-muted">{ensDescription}</p>}
    {(!wallet || !agent.plugins.includes('ens')) ? <><p className="text-base leading-relaxed text-ink-muted">Setup adds Ethereum Sepolia and the ENS plugin to this agent, preserving its existing wallets and limits. Changing networks invalidates its unsubmitted payment approvals.</p><button className={`${button} bg-black text-beige`} disabled={busy} onClick={() => enable.mutate()}>Enable ENS + Sepolia</button></> : <>
      {identity.data ? <div className="space-y-2 border border-beige-darker p-4 text-base"><p className="font-serif text-xl font-bold">{identity.data.name}</p><p className="break-all text-sm">Sepolia gas wallet: {identity.data.wallet}</p><p className="text-base leading-relaxed text-ink-muted">Fund this wallet with Sepolia ETH before approving identity writes.</p>{identity.data.registration && <p>ERC-8004 #{identity.data.registration.agentId} · ENS association {identity.data.associated ? 'present' : 'pending'}</p>}<p>{identity.data.description}</p><p className="break-all">{identity.data.endpoint}</p><button className={button} disabled={busy} onClick={() => { submit.reset(); resume.mutate() }}>Continue / check setup</button></div> : <fieldset className="space-y-3" disabled={busy}><label className="block text-base">Your ENSv2 parent name<input className={field} placeholder="yourname.eth" value={parent} onChange={e => setParent(e.target.value)} /></label><label className="block text-base">Agent subname<input className={field} value={label} onChange={e => setLabel(e.target.value)} /></label><label className="block text-base">Description<input className={field} value={description} onChange={e => setDescription(e.target.value)} /></label><p className="text-base leading-relaxed text-ink-muted">You keep namespace ownership. Setup publishes this agent’s wallet addresses and delegates only its endpoint and description records to its Sepolia wallet. ERC-8004 registration uses the agent’s normal gas budgets and approval mode.</p><button className={`${button} bg-black text-beige`} onClick={() => setup.mutate()}>Review identity setup</button></fieldset>}
      {identity.data?.verified && <fieldset className="space-y-3" disabled={busy}><Dropdown label="Delegated record" value={record} options={[{ value: 'endpoint', label: 'Service endpoint' }, { value: 'description', label: 'Description' }]} onChange={v => { setRecord(v as typeof record); requestKey.current = '' }} /><p className="text-base">Permission: {identity.data.delegation[record] ? 'Delegated' : 'Not delegated'}</p><input aria-label="Record value" className={field} value={value} onChange={e => { setValue(e.target.value); requestKey.current = '' }} placeholder={record === 'endpoint' ? 'https://your-service.example/mcp' : 'Agent description'} /><div className="flex flex-wrap gap-2"><button className={button} onClick={() => update.mutate()}>Request record update</button><button className={button} onClick={() => delegate.mutate(true)}>Delegate record</button><button className={button} onClick={() => delegate.mutate(false)}>Revoke record</button></div></fieldset>}
    </>}
    {notice && <p role="status" className="text-base">{notice}</p>}{error && <p role="alert" className="text-base text-red-700">{error.message}</p>}
    <dialog ref={dialog} aria-labelledby={`identity-title-${agent.id}`} onCancel={event => { if (submit.isPending) event.preventDefault() }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto border border-beige-darker bg-beige p-6 text-ink shadow-xl backdrop:bg-black/50">
      <h2 id={`identity-title-${agent.id}`} className="font-serif text-2xl font-bold">{step?.label}</h2><p className="mt-3 text-base leading-relaxed">Ethereum Sepolia only. {step?.transaction ? 'Sign with the namespace owner wallet; the agent receives no namespace ownership or address-editing permission.' : 'This agent operation uses its existing approval mode and USD fee budget.'}</p>
      {step?.transaction && <p className="mt-3 break-all font-mono text-sm">Owner: {step.owner}<br />Contract: {step.transaction.to}</p>}
      {step?.operation && <a className="mt-3 block text-base underline" href={`/operations/${step.operation.id}`}>View operation · {step.operation.status}</a>}
      {step?.operation && <p className="mt-3 text-base">Maximum gas budget: {formatEther(BigInt(step.operation.maxFeeAtomic))} Sepolia ETH. {step.operation.status === 'failed' ? 'No transaction was submitted. Retry creates a replacement for you to review before approval.' : ''}</p>}
      {submit.error && <p role="alert" className="mt-4 text-base text-red-700">{submit.error.message}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-3"><button className={button} disabled={submit.isPending} onClick={() => dialog.current?.close()}>Close</button>{step?.transaction && <button className={button} disabled={submit.isPending} onClick={() => connectWallet()}>Connect owner wallet</button>}<button className={`${button} bg-black text-beige`} disabled={submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? 'Confirming…' : step?.transaction ? 'Sign this step' : step?.operation?.status === 'failed' ? 'Retry preparation' : 'Approve / check status'}</button></div>
    </dialog>
  </div>
}
