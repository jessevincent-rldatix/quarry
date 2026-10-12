import { acceptCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { indentLess, indentMore, insertTab } from '@codemirror/commands'
import { HighlightStyle } from '@codemirror/language'
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { SchemaTable } from '@shared/types'
import { VAR_PATTERN } from '@/lib/template'

// Arc's code colours: violet keywords, amber strings, sky numbers, muted italic comments.
export const highlight = HighlightStyle.define([
  { tag: t.keyword, color: '#7c3aed', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#b45309' },
  { tag: [t.number, t.bool, t.null], color: '#0369a1' },
  { tag: t.comment, color: '#5f8a82', fontStyle: 'italic' },
  { tag: t.typeName, color: '#0e7c63' },
  { tag: t.operator, color: '#43716b' },
])

export const theme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: '#fbfefd', color: '#134e48' },
  '.cm-content': { fontFamily: 'var(--font-mono)', padding: '12px 0', lineHeight: '22px', caretColor: '#0e4044' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)' },
  '.cm-gutters': { backgroundColor: '#fbfefd', color: '#43716b', border: 'none', borderRight: '1px solid #e3f0ed' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 16px', lineHeight: '22px' },
  '.cm-line': { padding: '0 16px' },
  '.cm-activeLine': { backgroundColor: 'rgba(16, 185, 129, 0.06)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#c9efe8 !important' },
  '.cm-tooltip': { border: '1px solid #d1e7e3', borderRadius: '8px', backgroundColor: 'white', boxShadow: '0 10px 25px rgba(0,0,0,0.12)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete ul li': { padding: '3px 8px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#e4f3f0', color: '#134e48' },
  '.cm-placeholder': { color: '#43716b' },
})

const varDecorator = new MatchDecorator({
  regexp: new RegExp(VAR_PATTERN.source, 'g'),
  decoration: Decoration.mark({ class: 'cm-template-var' }),
})

/** Gives every {{variable}} an amber highlight. */
export const templateVars = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = varDecorator.createDeco(view) }
    update(update: ViewUpdate) { this.decorations = varDecorator.updateDeco(update, this.decorations) }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** The line the database blamed for the last error. Cleared as soon as the text changes. */
export const setErrorLine = StateEffect.define<number | null>()
export const errorLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setErrorLine)) {
        if (effect.value === null || effect.value < 1 || effect.value > tr.state.doc.lines) return Decoration.none
        return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(tr.state.doc.line(effect.value).from)])
      }
    }
    return tr.docChanged ? Decoration.none : marks
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** Tab accepts a suggestion; otherwise it indents the selection, or inserts a tab stop at the cursor. */
export const smartTab = [
  { key: 'Tab', run: acceptCompletion },
  { key: 'Tab', run: (view: EditorView) => (view.state.selection.main.empty ? insertTab(view) : indentMore(view)), shift: indentLess },
]

/** Table and column names for the SQL language's own completion (after `alias.` or `table.`). */
export function completionSchema(tables: SchemaTable[]): Record<string, string[]> {
  const schema: Record<string, string[]> = {}
  for (const table of tables) {
    const columns = table.columns.map((c) => c.name)
    schema[table.name] = columns
    if (table.schema) schema[`${table.schema}.${table.name}`] = columns
  }
  return schema
}

/**
 * Suggests bare column names from the tables the query already mentions, so typing `regis`
 * after `SELECT` finds `registration` without needing an alias first.
 */
export function columnCompletions(tables: SchemaTable[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[A-Za-z_][\w]*/)
    if (!word || (word.text.length < 2 && !context.explicit)) return null
    if (context.state.sliceDoc(word.from - 1, word.from) === '.') return null
    const text = context.state.doc.toString().toLowerCase()
    const mentioned = tables.filter((table) => new RegExp(`\\b${table.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase()}\\b`).test(text))
    if (mentioned.length === 0) return null
    const seen = new Set<string>()
    const options = mentioned.flatMap((table) => table.columns.filter((c) => !seen.has(c.name) && seen.add(c.name)).map((c) => ({
      label: c.name, type: 'property', detail: `${table.name} · ${c.type.toLowerCase()}`, boost: 5,
    })))
    return { from: word.from, options, validFor: /^\w*$/ }
  }
}
