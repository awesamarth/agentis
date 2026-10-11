'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

const button = 'px-4 py-2.5 font-mono text-xs uppercase tracking-widest disabled:opacity-40'

/** App-styled confirmation; callers retain the exact action and authorization checks. */
export default function ConfirmationDialog({ open, title, description, children, confirmLabel, pending = false, disabled = false, destructive = false, error, onConfirm, onClose }: {
  open: boolean; title: string; description: string; children?: ReactNode; confirmLabel: string
  pending?: boolean; disabled?: boolean; destructive?: boolean; error?: string
  onConfirm: () => Promise<unknown>; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null), submitting = useRef(false), id = useId()
  const [working, setWorking] = useState(false)
  const busy = pending || working
  useEffect(() => {
    const element = dialog.current
    if (open && !element?.open) element?.showModal()
    if (!open && element?.open) element.close()
  }, [open])
  async function submit() {
    if (!open || disabled || busy || submitting.current) return
    submitting.current = true; setWorking(true)
    try { await onConfirm(); onClose() }
    catch { /* The caller's mutation error stays visible; never automatically retry. */ }
    finally { submitting.current = false; setWorking(false) }
  }
  return <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} onClose={onClose} onCancel={event => {
    event.preventDefault()
    if (!busy && !submitting.current) onClose()
  }} onClick={event => {
    if (busy || submitting.current || event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
  }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto border border-beige-darker bg-beige p-6 text-ink shadow-xl backdrop:bg-black/50 sm:p-8">
    <header className="flex items-start justify-between gap-4"><h2 id={`${id}-title`} className="font-serif text-2xl font-bold">{title}</h2><button type="button" aria-label="Close confirmation" disabled={busy} onClick={onClose} className="p-1 text-2xl disabled:opacity-40">×</button></header>
    {children && <div className="my-5 border border-beige-darker bg-white p-4">{children}</div>}
    <p id={`${id}-description`} className="mt-5 text-sm leading-relaxed text-ink-muted">{description}</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    <footer className="mt-6 flex justify-end gap-3 border-t border-beige-darker pt-5">
      <button type="button" autoFocus disabled={busy} onClick={onClose} className={`${button} border border-beige-darker hover:border-ink`}>Cancel</button>
      <button type="button" disabled={busy || disabled} onClick={() => void submit()} className={`${button} ${destructive ? 'bg-red-700 text-white hover:bg-red-800' : 'bg-black text-beige hover:bg-ink'}`}>{busy ? 'Working…' : confirmLabel}</button>
    </footer>
  </dialog>
}
