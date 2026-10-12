import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ProjectRoute } from '@shared/profiler'
import { METHOD_TONE } from '@/lib/profilerFormat'
import { cn } from '@/lib/utils'

/** Routes the backend declares that this recording never hit, so gaps in coverage are visible. */
export function NotReached({ routes, declared }: { routes: ProjectRoute[]; declared: number }) {
  const [open, setOpen] = useState(false)
  if (declared === 0) return null
  const reached = declared - routes.length
  return (
    <div className="rounded-[10px] border border-gray-200 bg-white">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px]">
        {open ? <ChevronDown className="size-3.5 text-ink-mute" /> : <ChevronRight className="size-3.5 text-ink-mute" />}
        <span className="font-medium">Coverage: {reached} of {declared} declared routes reached</span>
        <span className="text-ink-mute">{routes.length ? `${routes.length} not recorded yet` : 'every declared route was recorded'}</span>
      </button>
      {open && routes.length > 0 && (
        <ul className="scrollbars-visible max-h-64 overflow-y-auto border-t border-line-soft px-3 py-2 font-mono text-[12px]">
          {routes.map((r) => (
            <li key={`${r.method} ${r.route}`} className="flex gap-2 py-0.5"><span className={cn('w-11 shrink-0 font-semibold', METHOD_TONE[r.method])}>{r.method}</span><span className="truncate">{r.route}</span></li>
          ))}
        </ul>
      )}
    </div>
  )
}
