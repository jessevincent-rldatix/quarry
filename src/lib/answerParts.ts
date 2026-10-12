export type AnswerPart = { kind: 'text'; text: string } | { kind: 'sql'; text: string }

/** Splits a model's answer into prose and its fenced code blocks, so the SQL can be given buttons. */
export function answerParts(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = []
  const fence = /```[\w-]*[ \t]*\r?\n([\s\S]*?)(?:```|$)/g
  let last = 0
  for (let match = fence.exec(answer); match; match = fence.exec(answer)) {
    const before = answer.slice(last, match.index).trim()
    if (before) parts.push({ kind: 'text', text: before })
    if (match[1].trim()) parts.push({ kind: 'sql', text: match[1].trim() })
    last = match.index + match[0].length
  }
  const rest = answer.slice(last).trim()
  if (rest) parts.push({ kind: 'text', text: rest })
  return parts
}
