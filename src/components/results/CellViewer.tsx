import { useCallback, useMemo } from 'react'
import { ClipboardCopy } from 'lucide-react'
import type { Cell } from '@shared/types'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/ui/dialog'

/** Shows one cell's full value. JSON is laid out for reading. */
export function CellViewer({ cell, column, onClose }: { cell: Cell; column: string; onClose: () => void }) {
  const text = cell === null ? '' : String(cell)
  const pretty = useMemo(() => {
    if (typeof cell !== 'string' || !/^\s*[[{]/.test(cell)) return text
    try { return JSON.stringify(JSON.parse(cell), null, 2) } catch { return text }
  }, [cell, text])
  // Focus goes to the value, not to the Close button the dialog would pick: the value can then be scrolled with
  // the keyboard, and the Enter that opened the viewer cannot land on a button. The dialog leaves focus alone
  // when it is already inside.
  const takeFocus = useCallback((element: HTMLElement | null) => element?.focus(), [])
  // Enter on the value closes the viewer. Enter on a button (Copy, Close) still presses that button.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter' || event.target !== event.currentTarget) return
    event.preventDefault()
    if (!event.repeat) onClose()
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={column} description={cell === null ? 'No value' : `${text.length.toLocaleString()} characters`} className="w-[640px]">
        <DialogBody>
          {cell === null
            ? <p ref={takeFocus} tabIndex={-1} onKeyDown={onKeyDown} className="italic text-ink-mute outline-none">NULL: this cell has no value.</p>
            : <pre ref={takeFocus} tabIndex={0} onKeyDown={onKeyDown} aria-label={`Value of ${column}`}
                   className="scrollbars-visible max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line-soft bg-editor p-3 font-mono text-[12.5px]">{pretty}</pre>}
        </DialogBody>
        {cell !== null && (
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(text)}><ClipboardCopy className="size-3.5" />Copy value</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
