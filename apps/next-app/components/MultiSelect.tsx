'use client'

import * as Popover from '@radix-ui/react-popover'
import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'

export default function MultiSelect({ label, values, onChange, options, disabled = false }: {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  const id = useId()
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  return <div className="min-w-0">
    <label htmlFor={id}>{label}</label>
    <Popover.Root>
      <Popover.Trigger ref={setTrigger} id={id} disabled={disabled || options.length === 0} className="mt-2 flex w-full items-center justify-between gap-3 border border-beige-darker bg-[#faf7f1] p-3 text-left font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40">
        <span className="truncate">{options.filter(option => values.includes(option.value)).map(option => option.label).join(', ') || 'Choose networks'}</span><ChevronDown size={16} className="shrink-0" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal container={trigger?.closest('dialog') ?? undefined}>
        <Popover.Content aria-label={label} align="start" sideOffset={4} collisionPadding={16} className="z-50 max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] overflow-y-auto border border-beige-darker bg-[#faf7f1] font-mono text-sm text-ink shadow-lg">
          {options.map(option => <label key={option.value} className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-black hover:text-beige focus-within:bg-black focus-within:text-beige">
            <input type="checkbox" className="accent-black" checked={values.includes(option.value)} disabled={disabled} onChange={event => onChange(event.target.checked ? [...values, option.value] : values.filter(value => value !== option.value))} />
            <span>{option.label}</span>
          </label>)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>
}
