import { useMemo } from 'react'
import type { RecordingSummary } from '@shared/profiler'
import { summarise } from '@shared/profilerAnalysis'
import { useProfiler } from '@/store/profilerStore'

/** The open recording, and the baseline if one is chosen, reduced to one line per endpoint. */
export function useRecordingSummary(): { summary: RecordingSummary | null; baseline: RecordingSummary | null } {
  const recording = useProfiler((s) => s.recording)
  const earlier = useProfiler((s) => s.baseline)
  const routes = useProfiler((s) => s.projects.find((p) => p.id === s.projectId)?.routes)
  const summary = useMemo(() => (recording ? summarise(recording.items, routes) : null), [recording, routes])
  const baseline = useMemo(() => (earlier ? summarise(earlier.items, routes) : null), [earlier, routes])
  return { summary, baseline }
}
