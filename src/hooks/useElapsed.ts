import { useEffect, useState } from 'react'

/** Seconds since `startedAt`, ticking while `running` is true. */
export function useElapsed(running: boolean, startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [running])
  return running && startedAt ? Math.max(0, (now - startedAt) / 1000) : 0
}
