import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { MSSQL, MySQL, PostgreSQL, SQLDialect, SQLite, sql } from '@codemirror/lang-sql'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder } from '@codemirror/view'
import type { Dialect, SchemaTable } from '@shared/types'
import { columnCompletions, completionSchema, errorLine, highlight, setErrorLine, smartTab, templateVars, theme } from './extensions'

// The editor has no built-in Snowflake or Databricks: each is described by its quoting and comment rules.
const Snowflake = SQLDialect.define({ backslashEscapes: true, slashComments: true, doubleDollarQuotedStrings: true, identifierQuotes: '"', caseInsensitiveIdentifiers: true })
const Databricks = SQLDialect.define({ backslashEscapes: true, doubleQuotedStrings: true, identifierQuotes: '`', caseInsensitiveIdentifiers: true })

const DIALECTS: Record<Dialect, SQLDialect> = { sqlite: SQLite, mssql: MSSQL, postgres: PostgreSQL, mysql: MySQL, snowflake: Snowflake, databricks: Databricks }

export interface SqlEditorHandle {
  focus: () => void
  /** Replaces the selection, or inserts at the cursor, adding a space where names would otherwise run together. */
  insert: (text: string) => void
  setText: (text: string) => void
  /** Marks a line (1-based) as the source of an error and scrolls to it, or clears the mark with null. */
  markError: (line: number | null) => void
  /** What Run would run right now: the selection if there is one, otherwise everything. For the run key pressed outside the editor. */
  runTarget: () => RunTarget
}

const selectionTarget = (editor: EditorView): RunTarget => {
  const { from, to } = editor.state.selection.main
  return from === to ? undefined : { text: editor.state.sliceDoc(from, to), line: editor.state.doc.lineAt(from).number }
}

// Ctrl+I opens Ask everywhere; without this the editor would also grow the selection on the same key.
const editorKeys = defaultKeymap.filter((binding) => binding.key !== 'Mod-i')

/** What to run: the selected text or one statement, with the line it starts on, or undefined for everything. */
export type RunTarget = { text: string; line: number } | undefined

interface Props {
  ref?: Ref<SqlEditorHandle>
  value: string
  dialect: Dialect
  tables: SchemaTable[]
  onChange: (value: string) => void
  onRun: (target: RunTarget) => void
  /** Run only the statement the cursor is in. */
  onRunStatement: (offset: number) => void
  onSave: () => void
  onFormat: () => void
  onCursor?: (line: number, column: number) => void
}

export function SqlEditor({ ref, value, dialect, tables, onChange, onRun, onRunStatement, onSave, onFormat, onCursor }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const language = useRef(new Compartment())
  // The editor is created once, so its callbacks read the latest props through this ref.
  const latest = useRef({ onChange, onRun, onRunStatement, onSave, onFormat, onCursor })
  latest.current = { onChange, onRun, onRunStatement, onSave, onFormat, onCursor }

  const languageExtension = () => {
    const support = sql({ dialect: DIALECTS[dialect], schema: completionSchema(tables), upperCaseKeywords: true })
    return [support, support.language.data.of({ autocomplete: columnCompletions(tables) })]
  }

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(), closeBrackets(),
          autocompletion(), templateVars, errorLine, theme, syntaxHighlighting(highlight),
          EditorState.tabSize.of(2),
          placeholder('Write SQL here. Use {{name}} for a fill-in variable.'),
          language.current.of(languageExtension()),
          Prec.highest(keymap.of([
            { key: 'Mod-Shift-Enter', run: (v) => { latest.current.onRunStatement(v.state.selection.main.head); return true } },
            // Outside the editor the same key is handled by useGlobalShortcuts, which skips events from in here.
            { key: 'Mod-Enter', run: (v) => { latest.current.onRun(selectionTarget(v)); return true } },
            { key: 'Mod-s', run: () => { latest.current.onSave(); return true } },
            { key: 'Shift-Alt-f', run: () => { latest.current.onFormat(); return true } },
          ])),
          keymap.of([...smartTab, ...closeBracketsKeymap, ...editorKeys, ...historyKeymap, ...completionKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString())
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head
              const line = update.state.doc.lineAt(head)
              latest.current.onCursor?.(line.number, head - line.from + 1)
            }
          }),
        ],
      }),
    })
    view.current = editor
    return () => editor.destroy()
    // Created once per mount; the parent remounts it (by key) when the tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: language.current.reconfigure(languageExtension()) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialect, tables])

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    insert: (text) => {
      const editor = view.current
      if (!editor) return
      const { from } = editor.state.selection.main
      const before = editor.state.sliceDoc(Math.max(0, from - 1), from)
      editor.dispatch(editor.state.replaceSelection(/[\w;)\]"`]/.test(before) ? ` ${text}` : text))
      editor.focus()
    },
    setText: (text) => {
      const editor = view.current
      if (editor && editor.state.doc.toString() !== text) {
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } })
      }
    },
    markError: (line) => {
      const editor = view.current
      if (!editor) return
      const valid = line !== null && line >= 1 && line <= editor.state.doc.lines
      editor.dispatch({
        effects: [setErrorLine.of(line), ...(valid ? [EditorView.scrollIntoView(editor.state.doc.line(line).from, { y: 'center' })] : [])],
      })
    },
    runTarget: () => (view.current ? selectionTarget(view.current) : undefined),
  }), [])

  return <div ref={host} className="scrollbars-visible h-full min-h-0 overflow-hidden" />
}
