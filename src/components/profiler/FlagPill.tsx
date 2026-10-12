import type { Flag } from '@shared/profiler'
import { FLAGS } from '@/lib/profilerFormat'
import { cn } from '@/lib/utils'

/** A short label for one kind of problem. Hover says exactly what it means. */
export function FlagPill({ flag }: { flag: Flag }) {
  const { label, meaning, tone } = FLAGS[flag]
  return <span title={meaning} className={cn('rounded px-1.5 py-px text-[11px] font-medium', tone)}>{label}</span>
}
