import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/ui/dialog'
import { Field, Input } from '@/ui/input'
import { close } from './close'

interface Props {
  title: string
  label: string
  value: string
  /** Return `{ error }` to refuse the value and keep the dialog open. Any other return value closes it. */
  onSubmit: (value: string) => { error: string } | void
}

/** Asks for one line of text, such as a folder name. */
export function PromptDialog({ title, label, value: initial, onSubmit }: Props) {
  const [value, setValue] = useState(initial)
  const [problem, setProblem] = useState('')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!value.trim()) return
    const refused = onSubmit(value.trim())
    if (refused?.error) setProblem(refused.error)
    else close()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent title={title} className="w-[380px]">
        <form className="contents" onSubmit={submit}>
          <DialogBody>
            <Field label={label}><Input autoFocus value={value} onChange={(e) => { setValue(e.target.value); setProblem('') }} /></Field>
            {problem && <p className="text-[12.5px] text-red-800">{problem}</p>}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={close}>Cancel</Button>
            <Button size="sm" type="submit" disabled={!value.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
