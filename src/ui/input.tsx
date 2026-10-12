import * as React from 'react'
import { cn } from '@/lib/utils'

const field = 'h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-ink shadow-xs placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand focus-visible:border-brand disabled:cursor-not-allowed disabled:opacity-50'

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(field, className)} {...props} />,
)
Input.displayName = 'Input'

export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(field, 'pr-7', className)} {...props} />,
)
Select.displayName = 'Select'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(field, 'h-auto py-2 font-mono text-[12.5px]', className)} {...props} />,
)
Textarea.displayName = 'Textarea'

/** A labelled form row. The hint sits beside the label in quieter text. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1 text-[12px] font-medium text-ink', className)}>
      <span>{label}{hint && <span className="ml-1.5 font-normal text-ink-mute">{hint}</span>}</span>
      {children}
    </label>
  )
}

/** Arc's small uppercase section heading. */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('text-[10px] font-semibold uppercase tracking-wide text-ink-mute', className)}>{children}</div>
}

export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>{children}</span>
}
