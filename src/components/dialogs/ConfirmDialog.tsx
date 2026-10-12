import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/ui/dialog'
import { close } from './close'

interface Props {
  title: string
  body: string
  action: string
  danger?: boolean
  onConfirm: () => void
}

/** Asks before something that cannot be undone. */
export function ConfirmDialog({ title, body, action, danger, onConfirm }: Props) {
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent title={title} className="w-[420px]">
        <DialogBody><p className="text-[13px]">{body}</p></DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>Cancel</Button>
          <Button size="sm" variant={danger ? 'destructive' : 'default'} onClick={() => { close(); onConfirm() }}>{action}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
