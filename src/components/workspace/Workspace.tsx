import { useEffect, useRef, useState } from 'react'
import { formatSql } from '@/lib/formatSql'
import { statementAt } from '@/lib/statements'
import { useActiveTab, useConnection, useDialect, useStore, useTables } from '@/store'
import { editorBridge } from '../editor/editorBridge'
import { SqlEditor, type SqlEditorHandle } from '../editor/SqlEditor'
import { ResultsPanel } from '../results/ResultsPanel'
import { EditorToolbar } from './EditorToolbar'
import { TabBar } from './TabBar'
import { VariablesBar } from './VariablesBar'

/** The editing screen: tabs, toolbar, editor, variables and results, with a draggable split. */
export function Workspace() {
  const tab = useActiveTab()
  const dialect = useDialect()
  const tables = useTables()
  const connection = useConnection()
  const nonce = useStore((s) => s.editorNonce)
  const errorLine = useStore((s) => (tab ? s.runs[tab.id]?.errorLine : undefined))
  const runAt = useStore((s) => (tab ? s.runs[tab.id]?.at : undefined))
  const editor = useRef<SqlEditorHandle>(null)
  const container = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(48)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [notice, setNotice] = useState('')
  const { updateTab, runTab, saveTab } = useStore.getState()

  useEffect(() => {
    editorBridge.current = editor.current
    editor.current?.focus()
  }, [tab?.id, nonce])

  // Mark the line the database blamed after each run of this tab.
  useEffect(() => {
    editor.current?.markError(errorLine ?? null)
  }, [errorLine, runAt, tab?.id])

  if (!tab) return null

  const format = () => {
    try {
      editor.current?.setText(formatSql(tab.sql, dialect))
      setNotice('')
    } catch {
      setNotice('Could not format: the SQL has a syntax error.')
      setTimeout(() => setNotice(''), 4000)
    }
  }

  const startSplitDrag = (event: React.PointerEvent) => {
    event.preventDefault()
    const box = container.current!.getBoundingClientRect()
    const move = (e: PointerEvent) => setSplit(Math.min(85, Math.max(15, ((e.clientY - box.top) / box.height) * 100)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-editor">
      <TabBar />
      <EditorToolbar tab={tab} onFormat={format} notice={notice} />
      <div ref={container} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-col" style={{ height: `${split}%` }}>
          <div className="min-h-0 flex-1">
            <SqlEditor
              key={tab.id}
              ref={editor}
              value={tab.sql}
              dialect={dialect}
              tables={tables}
              onChange={(sql) => updateTab(tab.id, { sql })}
              onRun={(target) => void runTab(tab.id, target)}
              onRunStatement={(offset) => void runTab(tab.id, statementAt(useStore.getState().tabs.find((t) => t.id === tab.id)?.sql ?? '', offset, dialect))}
              onSave={() => saveTab(tab.id)}
              onFormat={format}
              onCursor={(line, column) => setCursor({ line, column })}
            />
          </div>
          <VariablesBar tab={tab} />
        </div>
        <div onPointerDown={startSplitDrag} role="separator" aria-orientation="horizontal" aria-label="Resize results"
             className="h-1 shrink-0 cursor-row-resize border-t border-line bg-panel-header hover:bg-accent/50" />
        <div className="min-h-0 flex-1">
          <ResultsPanel tab={tab} onGoToLine={(line) => editor.current?.markError(line)} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 border-t border-line-soft bg-panel px-3 py-0.5 text-[11px] text-ink-mute">
        <span className="ml-auto">Ln {cursor.line}, Col {cursor.column}</span>
        <span>{connection?.name}</span>
      </div>
    </div>
  )
}
