import { useState } from 'react'
import { useStore } from '@/store'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/ui/dialog'
import { Field, Input, Select } from '@/ui/input'
import { close } from './close'

const parseTags = (text: string) => [...new Set(text.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))]

/** Save a tab as a new query, or edit the name, folder and tags of a saved one. */
export function QueryDialog({ tabId, queryId }: { tabId?: string; queryId?: string }) {
  const folders = useStore((s) => s.folders)
  const state = useStore.getState()
  const query = state.queries.find((q) => q.id === queryId)
  const tab = state.tabs.find((t) => t.id === tabId)
  const source = query ?? state.queries.find((q) => q.id === tab?.queryId)
  const [name, setName] = useState(query?.name ?? (tab && !/^Untitled \d+$/.test(tab.title) ? (source ? `${tab.title} copy` : tab.title) : ''))
  const [folderId, setFolderId] = useState(source?.folderId ?? '')
  const [newFolder, setNewFolder] = useState('')
  const [tags, setTags] = useState(source?.tags.map((t) => `#${t}`).join(' ') ?? '')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    const folder = folderId === '__new__' ? (newFolder.trim() ? state.addFolder(newFolder.trim()) : null) : folderId || null
    const details = { name: name.trim(), folderId: folder, tags: parseTags(tags) }
    if (query) state.updateQuery(query.id, details)
    else if (tabId) state.saveTab(tabId, details)
    close()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent title={query ? 'Query details' : 'Save query'}>
        <form onSubmit={submit} className="contents">
          <DialogBody>
            <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Orders by status" /></Field>
            <Field label="Folder">
              <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                <option value="">No folder</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                <option value="__new__">New folder…</option>
              </Select>
            </Field>
            {folderId === '__new__' && <Field label="New folder name"><Input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} /></Field>}
            <Field label="Tags" hint="separate with spaces">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#reporting #weekly" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={close}>Cancel</Button>
            <Button size="sm" type="submit" disabled={!name.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
