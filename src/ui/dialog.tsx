import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogClose = DialogPrimitive.Close

export function DialogContent({ title, description, className, children }: {
  title: string; description?: string; className?: string; children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,61,56,0.25)]" />
      <DialogPrimitive.Content
        className={cn('fixed left-1/2 top-[10vh] z-50 flex max-h-[80vh] w-[480px] max-w-[94vw] -translate-x-1/2 flex-col rounded-xl border border-line bg-white shadow-2xl', className)}
      >
        <div className="flex items-start gap-3 border-b border-line-soft px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-[15px] font-semibold text-brand">{title}</DialogPrimitive.Title>
            {description
              ? <DialogPrimitive.Description className="mt-0.5 text-[12.5px] text-ink-mute">{description}</DialogPrimitive.Description>
              : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close aria-label="Close" className="rounded p-1 text-ink-mute hover:bg-black/[0.06]">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export const DialogBody = ({ className, ...props }: React.ComponentProps<'div'>) =>
  <div className={cn('scrollbars-visible flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4', className)} {...props} />

export const DialogFooter = ({ className, ...props }: React.ComponentProps<'div'>) =>
  <div className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-line-soft px-5 py-3', className)} {...props} />

// ── Dropdown menu ────────────────────────────────────────────────────────────
export const Menu = MenuPrimitive.Root
export const MenuTrigger = MenuPrimitive.Trigger

export function MenuContent({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={4}
        align="start"
        className={cn('z-50 min-w-[180px] rounded-lg border border-line bg-white py-1 shadow-xl', className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  )
}

export function MenuItem({ className, danger, ...props }: React.ComponentProps<typeof MenuPrimitive.Item> & { danger?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-panel [&_svg]:size-3.5 [&_svg]:shrink-0',
        danger ? 'text-red-700' : 'text-ink',
        className,
      )}
      {...props}
    />
  )
}

export const MenuSeparator = () => <MenuPrimitive.Separator className="my-1 h-px bg-line-soft" />
export const MenuLabel = ({ children }: { children: React.ReactNode }) =>
  <MenuPrimitive.Label className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-mute">{children}</MenuPrimitive.Label>
