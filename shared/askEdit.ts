/** The line the model is asked to start with when its answer is a changed version of the editor's query. */
export const EDIT_MARK = 'EDIT'

/**
 * Separates the edit mark from an answer. When the answer starts with the mark and holds a SQL
 * block, that block is the replacement for the editor's query; the answer is returned without the
 * mark either way, so it never shows.
 */
export function readEdit(answer: string): { answer: string; replacement?: string } {
  const marked = new RegExp(`^\\s*\\**${EDIT_MARK}\\**[:.]?[ \\t]*(\\r?\\n|$)`).exec(answer)
  if (!marked) return { answer }
  const rest = answer.slice(marked[0].length).trimStart()
  const block = /```(?:sql)?[ \t]*\r?\n([\s\S]*?)```/i.exec(rest)
  const replacement = block?.[1].trim()
  return replacement ? { answer: rest, replacement } : { answer: rest }
}
