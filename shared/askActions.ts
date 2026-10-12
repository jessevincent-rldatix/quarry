import type { AskAction, AskActionKind } from './types.ts'

/** The word the model starts a line with when its answer is something for Quarry to do. */
export const ACTION_MARK = 'DO'
/** More than this in one answer is the model running away, not the user asking. */
export const MAX_ACTIONS = 3

/** The places `show` can name. */
export const PLACES = ['editor', 'builder', 'map', 'templates', 'profiler', 'library', 'schema', 'history', 'connections', 'search'] as const
export type Place = typeof PLACES[number]

/** Every action, with whether it names something and how the model is told about it. */
export const ACTIONS: Record<AskActionKind, { named: boolean; help: string }> = {
  'open-query': { named: true, help: 'opens a saved query from the library' },
  'open-template': { named: true, help: 'opens a template' },
  'preview-table': { named: true, help: 'opens the first rows of a table or view' },
  'use-connection': { named: true, help: 'points the open tab at another connection' },
  'switch-tab': { named: true, help: 'goes to an open tab' },
  show: { named: true, help: `shows a part of the workbench: ${PLACES.join(', ')}` },
  'new-tab': { named: false, help: 'opens an empty tab' },
  'close-tab': { named: false, help: 'closes the open tab' },
  'close-all-tabs': { named: false, help: 'closes every open tab' },
  run: { named: false, help: 'runs the query in the open tab' },
  format: { named: false, help: 'tidies the layout of the query in the open tab' },
  save: { named: false, help: 'saves the open tab' },
}

/**
 * Separates action lines from the start of an answer. Lines that carry the mark are never shown,
 * even when the action is unknown or one too many, since they are not written for the reader.
 */
export function readActions(answer: string): { answer: string; actions: AskAction[] } {
  const actions: AskAction[] = []
  const line = new RegExp(`^\\s*\\**${ACTION_MARK}\\**[ \\t]+([a-z-]+)[ \\t]*(?::[ \\t]*(.*?))?[ \\t]*(\\r?\\n|$)`)
  let rest = answer
  for (let match = line.exec(rest); match; match = line.exec(rest)) {
    rest = rest.slice(match[0].length)
    const kind = match[1] as AskActionKind
    const name = (match[2] ?? '').replace(/^["'“<]+|["'”>.]+$/g, '').trim()
    const known = Object.hasOwn(ACTIONS, kind) ? ACTIONS[kind] : undefined
    if (known && actions.length < MAX_ACTIONS && (!known.named || name)) actions.push({ kind, name: known.named ? name : '' })
  }
  return { answer: actions.length || rest !== answer ? rest.trimStart() : answer, actions }
}
