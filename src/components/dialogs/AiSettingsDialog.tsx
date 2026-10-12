import { useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import type { AiSettings } from '@shared/types'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/ui/dialog'
import { Field, Input } from '@/ui/input'
import { close } from './close'

const DEFAULTS: AiSettings = { host: '', chatEndpoint: 'databricks-claude-sonnet-4-6', embedEndpoint: 'gte-large-en', saveToken: false }

/** Where Ask sends its questions: a Databricks workspace and its two serving endpoints. */
export function AiSettingsDialog() {
  const ai = useStore((s) => s.ai)
  const [form, setForm] = useState<AiSettings>(ai?.settings.host ? ai.settings : { ...DEFAULTS, ...ai?.settings, chatEndpoint: ai?.settings.chatEndpoint || DEFAULTS.chatEndpoint, embedEndpoint: ai?.settings.embedEndpoint || DEFAULTS.embedEndpoint })
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'error'; text?: string }>({ kind: 'idle' })
  const patch = (change: Partial<AiSettings>) => { setForm((f) => ({ ...f, ...change })); setStatus({ kind: 'idle' }) }

  const save = async (test: boolean) => {
    setStatus({ kind: 'busy' })
    try {
      await api.saveAiSettings({ ...form, host: form.host.trim().replace(/\/+$/, ''), token: token || undefined })
      setToken('')
      await useStore.getState().loadAi()
      if (!test) { close(); return }
      const { answer } = await api.testAi()
      setStatus({ kind: 'ok', text: `The chat endpoint answered: ${answer.slice(0, 120)}` })
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message })
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent title="AI settings" description="Ask sends your question, table and column names, and the query you choose to include. Rows from your database are never sent." className="w-[560px]">
        <DialogBody>
          <Field label="Databricks workspace host" hint="without https://">
            <Input value={form.host} onChange={(e) => patch({ host: e.target.value.replace(/^https?:\/\//i, '') })} placeholder="adb-1234567890123456.7.azuredatabricks.net" className="font-mono text-[12px]" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Chat endpoint" hint="answers questions">
              <Input value={form.chatEndpoint} onChange={(e) => patch({ chatEndpoint: e.target.value.trim() })} className="font-mono text-[12px]" />
            </Field>
            <Field label="Embedding endpoint" hint="builds the index">
              <Input value={form.embedEndpoint} onChange={(e) => patch({ embedEndpoint: e.target.value.trim() })} className="font-mono text-[12px]" />
            </Field>
          </div>
          <Field label="Access token" hint={ai?.hasToken ? 'held, leave blank to keep' : 'a Databricks personal access token'}>
            <Input type="password" autoComplete="new-password" value={token} onChange={(e) => { setToken(e.target.value); setStatus({ kind: 'idle' }) }} />
          </Field>
          <label className="flex items-start gap-2 rounded-lg border border-line-soft bg-panel p-3 text-[12.5px]">
            <input type="checkbox" className="mt-0.5 accent-brand" checked={form.saveToken} onChange={(e) => patch({ saveToken: e.target.checked })} />
            <span><span className="font-medium">Remember the token</span> <span className="text-ink-mute">Stores it encrypted in your user folder (.quarry). Off: it is kept in memory and asked for again after a restart.</span></span>
          </label>
          <p className="text-[12px] text-ink-mute">Leave the embedding endpoint empty to skip the index. Ask then picks tables by matching words in your question.</p>
          {status.kind === 'error' && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-[12.5px] text-red-800">{status.text}</div>}
          {status.kind === 'ok' && <div className="flex items-start gap-2 text-[12.5px] text-emerald-800"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{status.text}</div>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={status.kind === 'busy' || !form.host.trim()} onClick={() => void save(true)}>
            {status.kind === 'busy' && <Loader2 className="size-3.5 animate-spin" />}Save and test
          </Button>
          <Button size="sm" disabled={status.kind === 'busy' || !form.host.trim()} onClick={() => void save(false)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
