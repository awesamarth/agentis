'use client'

import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'

export default function Dropdown({ label, value, onChange, options, disabled = false, className = '' }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  return <div className={`min-w-0 ${className}`}>
    <label htmlFor={id}>{label}</label>
    <Select.Root value={value} onValueChange={onChange} disabled={disabled || options.length === 0}>
      <Select.Trigger ref={setTrigger} id={id} className="mt-2 flex w-full items-center justify-between gap-3 border border-beige-darker bg-[#f8f4ed] p-3 text-left font-mono text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-40 [&>span:first-child]:truncate">
        <Select.Value placeholder="Choose an option" />
        <Select.Icon className="shrink-0"><ChevronDown size={16} aria-hidden="true" /></Select.Icon>
      </Select.Trigger>
      {/* Keep modal menus in the native dialog's top layer, outside its scroll area. */}
      <Select.Portal container={trigger?.closest('dialog') ?? undefined}>
        <Select.Content data-agentis-dropdown="" position="popper" sideOffset={4} collisionPadding={16} className="z-50 max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden border border-beige-darker bg-[#f8f4ed] font-mono text-sm text-ink shadow-lg">
          <Select.Viewport>
            {options.map(option => <Select.Item key={option.value} value={option.value} className="relative flex cursor-pointer select-none items-center py-3 pr-9 pl-3 outline-none data-[highlighted]:bg-black data-[highlighted]:text-beige">
              <Select.ItemText>{option.label}</Select.ItemText>
              <Select.ItemIndicator className="absolute right-3"><Check size={14} aria-hidden="true" /></Select.ItemIndicator>
            </Select.Item>)}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  </div>
}
