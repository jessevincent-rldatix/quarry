import { useState } from 'react'
import { useProfiler } from '@/store/profilerStore'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/ui/dialog'
import { Field, Input } from '@/ui/input'

/** Create or edit a profiling project: a name, and the backend's folder so its routes can be read. */
export function ProjectDialog() {
  const editing = useProfiler((s) => s.editing)!
  const [name, setName] = useState(editing.name)
  const [repoPath, setRepoPath] = useState(editing.repoPath)
  const [backendUrl, setBackendUrl] = useState(editing.backendUrl ?? '')
  const [problem, setProblem] = useState('')
  const close = () => useProfiler.getState().set({ editing: null })

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await useProfiler.getState().saveProject({ id: editing.id, name, repoPath, backendUrl })
    } catch (err) {
      setProblem((err as Error).message)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent title={editing.id ? 'Edit project' : 'New project'} description="A project keeps the recordings of one backend together." className="w-[520px]">
        <form onSubmit={(e) => void submit(e)} className="contents">
          <DialogBody>
            <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Interactive Insight backend" /></Field>
            <Field label="Backend folder" hint="optional">
              <Input value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="C:\Repos\my-backend" className="font-mono text-[12px]" />
            </Field>
            <Field label="Backend address" hint="optional">
              <Input value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} placeholder="http://localhost:5177" className="font-mono text-[12px]" />
            </Field>
            <p className="text-[12px] text-ink-mute">
              Either one lets a recording show which endpoints were never reached. The address is preferred: the running backend lists its routes exactly, while a swagger.json in the folder can be out of date. Saving again re-reads them.
            </p>
            {problem && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-[12.5px] text-red-800">{problem}</div>}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" type="button" onClick={close}>Cancel</Button>
            <Button size="sm" type="submit" disabled={!name.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
