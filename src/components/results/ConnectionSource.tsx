import type { ConnectionColor } from '@shared/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

const DOT: Record<ConnectionColor, string> = {
  red: 'bg-red-500', amber: 'bg-amber-500', green: 'bg-emerald-500', blue: 'bg-blue-500', violet: 'bg-violet-500',
}

/** Names the database the rows on screen came from, and says so when the tab has since been pointed elsewhere. */
export function ConnectionSource({ sourceId, tabConnectionId }: { sourceId: string; tabConnectionId: string }) {
  const connections = useStore((s) => s.connections)
  const source = connections.find((c) => c.id === sourceId)
  const current = connections.find((c) => c.id === tabConnectionId)
  const moved = sourceId !== tabConnectionId
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', moved && 'font-medium text-var-ink')}>
      {source?.color && <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[source.color])} />}
      <span className="truncate">
        from {source?.name ?? 'a connection that has been removed'}
        {moved && ` (this tab now points at ${current?.name ?? 'a connection that has been removed'})`}
      </span>
    </span>
  )
}
