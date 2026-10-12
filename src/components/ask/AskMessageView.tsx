import { answerParts } from '@/lib/answerParts'
import { Mic } from 'lucide-react'
import { cn, kbd } from '@/lib/utils'
import type { AskMessage } from '@/store'
import { SqlBlock } from './SqlBlock'

/** One turn of the conversation. Answers show which tables the model was told about. */
export function AskMessageView({ message }: { message: AskMessage }) {
  if (message.role === 'user') {
    return (
      <div className="ml-6 flex items-start gap-1.5 self-end whitespace-pre-wrap rounded-lg bg-brand px-2.5 py-1.5 text-white">
        {message.spoken && <Mic className="mt-0.5 size-3.5 shrink-0 opacity-80" aria-label="Spoken" />}
        {message.content}
      </div>
    )
  }
  return (
    <div className={cn('flex flex-col gap-2', message.failed && 'rounded-lg border border-red-200 bg-red-50 p-2.5 text-red-900')}>
      {message.applied && (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[12.5px] text-emerald-900">
          Changed the query in “{message.applied}”. Nothing was run. {kbd('Z')} in the editor brings the old one back.
        </p>
      )}
      {message.actions?.map((action, i) => (
        <p key={i} role="status" className={cn('rounded-md border px-2 py-1 text-[12.5px]', action.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
          {action.text}
        </p>
      ))}
      {answerParts(message.content).map((part, i) =>
        part.kind === 'sql' ? <SqlBlock key={i} sql={part.text} /> : <p key={i} className="whitespace-pre-wrap leading-[19px]">{part.text}</p>)}
      {message.tables && message.tables.length > 0 && (
        <p className="text-[11px] text-ink-mute" title={message.tables.join('\n')}>
          Looked at {message.tables.length} table{message.tables.length === 1 ? '' : 's'}, chosen by {message.semantic ? 'meaning (index)' : 'matching words'}.
        </p>
      )}
    </div>
  )
}
