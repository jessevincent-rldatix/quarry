import { useEffect, useRef, useState } from 'react'
import { Eraser, Loader2, SendHorizontal, Settings2, Sparkles, X } from 'lucide-react'
import { kbd } from '@/lib/utils'
import { useActiveTab, useConnection, useStore } from '@/store'
import { Button } from '@/ui/button'
import { useVoice } from '@/store/voiceStore'
import { HearingBubble } from '../voice/HearingBubble'
import { AskMessageView } from './AskMessageView'
import { IndexStatus } from './IndexStatus'

const STARTERS = ['Which tables hold customer or account data?', 'Write a query that counts rows per month.', 'Explain what the query in the editor does.']

/** A side panel for asking questions about the connected database and the query being written. */
export function AskPanel() {
  const ai = useStore((s) => s.ai)
  const messages = useStore((s) => s.askMessages)
  const busy = useStore((s) => s.askBusy)
  const connection = useConnection()
  const tab = useActiveTab()
  const failed = useStore((s) => (tab ? Boolean(s.runs[tab.id]?.error ?? s.runs[tab.id]?.response?.error) : false))
  const heard = useVoice((s) => s.heard)
  const hearing = useVoice((s) => s.phase === 'hearing')
  const [question, setQuestion] = useState('')
  const [withSql, setWithSql] = useState(true)
  const [withError, setWithError] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const { set, setDialog, ask } = useStore.getState()

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages.length, busy, heard, hearing])
  useEffect(() => { input.current?.focus() }, [])

  const send = (text: string) => {
    if (!text.trim() || busy) return
    setQuestion('')
    void ask(text.trim(), { sql: withSql && Boolean(tab?.sql.trim()), error: withError && failed })
  }

  return (
    <aside aria-label="Ask" className="flex w-[360px] shrink-0 flex-col border-l border-line bg-white max-lg:w-[300px] max-md:w-full max-md:border-l-0 max-md:border-t">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-panel-header px-2.5">
        <Sparkles className="size-3.5 text-accent-deep" />
        <span className="font-medium">Ask</span>
        <span className="truncate text-[12px] text-ink-mute">{connection?.name}</span>
        <div className="ml-auto flex items-center">
          {messages.length > 0 && <Button variant="ghost" size="xs" title="Clear the conversation" onClick={() => set({ askMessages: [] })}><Eraser className="size-3.5" /></Button>}
          <Button variant="ghost" size="xs" title="AI settings" onClick={() => setDialog({ kind: 'ai-settings' })}><Settings2 className="size-3.5" /></Button>
          <Button variant="ghost" size="xs" title={`Close (${kbd('I')})`} onClick={() => set({ askOpen: false })}><X className="size-3.5" /></Button>
        </div>
      </div>

      {!ai?.configured ? (
        <div className="flex flex-1 flex-col items-start gap-3 p-4">
          <p className="font-medium">Connect a model to ask questions</p>
          <p className="text-ink-mute">
            Ask uses a chat model served from your Databricks workspace. It is told the names and types of your tables and columns, your question, and the query you choose to include. Rows from your database are never sent.
          </p>
          <Button size="sm" onClick={() => setDialog({ kind: 'ai-settings' })}><Settings2 className="size-3.5" />Set up</Button>
        </div>
      ) : (
        <>
          <IndexStatus />
          <div className="scrollbars-visible flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
            {messages.length === 0 && !hearing && !heard && (
              <div className="flex flex-col items-start gap-1.5 text-ink-mute">
                <p>Ask about this database, or for help with the query in the editor.</p>
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-md border border-line-soft bg-panel px-2 py-1 text-left text-[12.5px] text-ink hover:bg-mint-hover/40">{s}</button>
                ))}
              </div>
            )}
            {messages.map((m, i) => <AskMessageView key={i} message={m} />)}
            <HearingBubble />
            {busy && <div className="flex items-center gap-2 text-ink-mute"><Loader2 className="size-3.5 animate-spin text-accent-deep" />Thinking</div>}
            <div ref={end} />
          </div>
          <form className="flex shrink-0 flex-col gap-1.5 border-t border-line bg-panel p-2" onSubmit={(e) => { e.preventDefault(); send(question) }}>
            <textarea ref={input} rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(question) } }}
                      className="scrollbars-visible w-full resize-none rounded-md border border-line bg-white p-2 text-[13px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-mute">
              <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-brand" checked={withSql} onChange={(e) => setWithSql(e.target.checked)} />Include the editor query</label>
              {failed && <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-brand" checked={withError} onChange={(e) => setWithError(e.target.checked)} />and its error</label>}
              <Button size="xs" type="submit" className="ml-auto" disabled={busy || !question.trim()}><SendHorizontal className="size-3.5" />Send</Button>
            </div>
          </form>
        </>
      )}
    </aside>
  )
}
