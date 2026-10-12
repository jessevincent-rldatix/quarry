import { Mic } from 'lucide-react'
import { useVoice } from '@/store/voiceStore'

/** The request being spoken, word by word as it is written down, shown where it will land in the conversation. */
export function HearingBubble() {
  const phase = useVoice((s) => s.phase)
  const heard = useVoice((s) => s.heard)
  if (phase !== 'hearing' && !heard) return null
  return (
    <div role="status" aria-label="Hearing you" className="ml-6 flex items-start gap-1.5 self-end whitespace-pre-wrap rounded-lg border border-dashed border-brand bg-brand/10 px-2.5 py-1.5 text-ink">
      <Mic className="mt-0.5 size-3.5 shrink-0 animate-pulse text-brand" />
      {heard || <span className="text-ink-mute">Listening…</span>}
    </div>
  )
}
