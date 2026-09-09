'use client'
import { useEffect, useState } from 'react'
import { ArrowUpRight, Plus, Wallet } from 'lucide-react'
import { parseAmount } from './amount-input'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'

const STORAGE = 'agentis_guest_agents'
const RPC = 'https://api.devnet.solana.com'
type Guest = { id: string; name: string; walletAddress: string; _guest: true; _secretKeyBytes: string; createdAt: string }

export default function GuestWallets({ selectedId }: { selectedId?: string }) {
  const [wallets, setWallets] = useState<Guest[]>([])
  const [name, setName] = useState('Demo agent')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('0.00001')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { queueMicrotask(() => {
    try { setWallets(JSON.parse(localStorage.getItem(STORAGE) ?? '[]').filter((wallet: Guest) => wallet._guest)) }
    catch { setMessage('Could not read local demo wallets. Do not clear storage if you need their keys.') }
  }) }, [])
  async function create() {
    setBusy(true)
    try {
      const keypair = await Keypair.generate()
      const wallet: Guest = { id: crypto.randomUUID(), name: name.trim() || 'Demo agent', walletAddress: keypair.publicKey.toBase58(), _guest: true, _secretKeyBytes: JSON.stringify(Array.from(keypair.secretKey)), createdAt: new Date().toISOString() }
      const next = [wallet, ...wallets]
      localStorage.setItem(STORAGE, JSON.stringify(next))
      setWallets(next)
      setMessage('Demo wallet created. Fund with devnet SOL only.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Creation failed') }
    finally { setBusy(false) }
  }
  async function send(wallet: Guest) {
    setBusy(true)
    setMessage('Preparing a devnet transaction… Do not retry if submission outcome is unclear.')
    try {
      const lamports = parseAmount(amount, 9)
      if (lamports < 1n || lamports > 10_000_000n) throw new Error('Enter an amount above zero and at most 0.01 SOL')
      const bytes = JSON.parse(wallet._secretKeyBytes)
      if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new Error('Invalid local key material')
      const signer = await Keypair.fromSecretKey(new Uint8Array(bytes))
      if (signer.publicKey.toBase58() !== wallet.walletAddress) throw new Error('Wallet key/address mismatch')
      const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(to), lamports: BigInt(lamports) }))
      const signature = await sendAndConfirmTransaction(new Connection(RPC, 'confirmed'), transaction, [signer])
      setMessage(`Confirmed on Solana devnet: ${signature}`)
    } catch (error) { setMessage(`${error instanceof Error ? error.message : 'Send failed'}. If submitted, check the devnet explorer before another send.`) }
    finally { setBusy(false) }
  }
  const inputClass = 'mt-2 w-full border border-beige-darker bg-beige px-4 py-3 text-sm outline-none focus:border-ink disabled:opacity-50'
  const visible = wallets.filter(wallet => !selectedId || wallet.id === selectedId)
  return <section className="border border-beige-darker bg-[#faf7f1] p-5 sm:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-serif text-2xl font-bold">Browser wallets</h2><span className="border border-beige-darker px-3 py-1 font-mono text-[10px] uppercase tracking-widest">Solana devnet</span></header>
    <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">A simple SOL transfer demo, separate from your hosted account. Use test funds only.</p>
    <details className="mt-3 text-xs text-ink-muted"><summary className="cursor-pointer underline decoration-beige-darker underline-offset-4">How these wallets are stored</summary><p className="mt-2 max-w-xl leading-relaxed">Private keys stay in this browser’s localStorage. Clearing browser data loses them; scripts on this site can access them. These wallets do not have hosted-wallet protection. Never send mainnet funds here.</p></details>
    {!selectedId && <div className="mt-7 flex flex-col items-end gap-3 sm:flex-row"><label className="w-full flex-1 text-xs font-medium">Wallet name<input className={inputClass} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><button className="flex w-full items-center justify-center gap-2 border border-ink px-5 py-3 font-mono text-xs uppercase tracking-wider hover:bg-beige-dark disabled:opacity-40 sm:w-auto" disabled={busy} onClick={create}><Plus size={15} aria-hidden="true" /> Create wallet</button></div>}
    {visible.length > 0 ? <><div className="mt-8 grid gap-4 border-t border-beige-darker pt-6 sm:grid-cols-[1fr_160px]"><label className="text-xs font-medium">Recipient address<input className={`${inputClass} font-mono`} placeholder="Solana address" value={to} disabled={busy} onChange={event => setTo(event.target.value)} /></label><label className="text-xs font-medium">Amount · SOL<input className={`${inputClass} font-mono`} inputMode="decimal" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} /></label></div><p className="mt-2 text-xs text-ink-muted">Maximum 0.01 SOL per demo payment.</p><div className="mt-6 grid gap-4 sm:grid-cols-2">{visible.map(wallet => <article className="min-w-0 border border-beige-darker bg-beige p-5" key={wallet.id}><div className="flex items-center gap-3"><Wallet size={18} aria-hidden="true" /><h3 className="truncate font-serif text-xl font-bold">{wallet.name}</h3></div><p className="mt-4 break-all font-mono text-xs leading-relaxed text-ink-muted">{wallet.walletAddress}</p><div className="mt-5 flex flex-wrap items-center justify-between gap-3"><button className="bg-black px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-beige hover:bg-ink disabled:opacity-40" disabled={busy || !to} onClick={() => send(wallet)}>{busy ? 'Sending…' : 'Send SOL'}</button><a className="inline-flex items-center gap-1 text-xs underline underline-offset-4" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/address/${encodeURIComponent(wallet.walletAddress)}?cluster=devnet`}>Explorer <ArrowUpRight size={12} aria-hidden="true" /></a></div></article>)}</div></> : <p className="mt-7 border-t border-beige-darker pt-6 text-sm text-ink-muted">{selectedId ? 'This browser wallet was not found on this device.' : 'Create a wallet above to try your first test transfer.'}</p>}
    {message && <p role="status" className="mt-5 break-all border-l-2 border-ink pl-4 text-sm leading-relaxed">{message}</p>}
  </section>
}
