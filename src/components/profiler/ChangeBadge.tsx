import { cn } from '@/lib/utils'

/** How a timing moved since the baseline. Small shifts are noise and stay quiet. */
export function ChangeBadge({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined) return <span className="text-[11px] text-ink-mute">new</span>
  const change = before > 0 ? (now - before) / before : 0
  if (Math.abs(change) < 0.1 || Math.abs(now - before) < 5) return <span className="text-[11px] text-ink-mute">same</span>
  return <span className={cn('text-[11px] font-medium', change < 0 ? 'text-emerald-700' : 'text-red-700')}>{change < 0 ? '' : '+'}{Math.round(change * 100)}%</span>
}
