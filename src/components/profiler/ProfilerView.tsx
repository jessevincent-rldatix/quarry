import { useEffect } from 'react'
import { useRecordingSummary } from '@/hooks/useRecordingSummary'
import { useProfiler } from '@/store/profilerStore'
import { Button } from '@/ui/button'
import { EndpointDetail } from './EndpointDetail'
import { EndpointTable } from './EndpointTable'
import { NotReached } from './NotReached'
import { ProjectDialog } from './ProjectDialog'
import { ProjectSidebar } from './ProjectSidebar'
import { RecordBar } from './RecordBar'
import { ReportToolbar } from './ReportToolbar'
import { SummaryCards } from './SummaryCards'

/** The profiler screen: record how a backend behaves under real use, then see which endpoints and queries cost the most. */
export function ProfilerView() {
  const loaded = useProfiler((s) => s.loaded)
  const error = useProfiler((s) => s.error)
  const project = useProfiler((s) => s.projects.find((p) => p.id === s.projectId))
  const recording = useProfiler((s) => s.recording)
  const endpointKey = useProfiler((s) => s.endpointKey)
  const editing = useProfiler((s) => s.editing)
  const { summary, baseline } = useRecordingSummary()
  const selected = summary?.endpoints.find((e) => e.key === endpointKey)

  useEffect(() => { void useProfiler.getState().load() }, [])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-wrap overflow-y-auto bg-editor md:flex-nowrap md:overflow-hidden">
      <ProjectSidebar />
      <div className="flex min-w-0 flex-1 basis-[480px] flex-col md:min-h-0">
        <RecordBar />
        {error && <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-[12.5px] text-red-900">{error}</div>}
        <main className="scrollbars-visible flex min-h-0 flex-1 flex-col gap-4 p-5 md:overflow-y-auto">
          {!loaded ? (
            <p className="text-ink-mute">Loading…</p>
          ) : !project ? (
            <div className="m-auto flex max-w-[460px] flex-col items-start gap-3">
              <h1 className="text-[18px] font-semibold text-brand">Profile a backend</h1>
              <p className="text-ink-mute">
                Record what a backend does while you use the app normally. Every request is listed with the queries it ran and how long each took, so slow endpoints, repeated queries and slow queries stand out.
              </p>
              <Button onClick={() => useProfiler.getState().set({ editing: { name: '', repoPath: '' } })}>Create a project</Button>
            </div>
          ) : !recording || !summary ? (
            <div className="m-auto flex max-w-[520px] flex-col gap-2 text-ink-mute">
              <h1 className="text-[18px] font-semibold text-brand">{project.name}</h1>
              <p>No recording open. To make one:</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Start the backend on the branch that reports its queries, with <code className="font-mono text-ink">dotnet run</code>.</li>
                <li>Press <b className="text-ink">Record</b> above.</li>
                <li>Use the app as you normally would, then press <b className="text-ink">Stop</b>.</li>
              </ol>
            </div>
          ) : (
            <>
              <div>
                <h1 className="text-[18px] font-semibold text-brand">{recording.name}</h1>
                <p className="text-ink-mute">{project.name} · recorded {new Date(recording.startedAt).toLocaleString()}</p>
              </div>
              <SummaryCards summary={summary} />
              <ReportToolbar summary={summary} />
              {summary.endpoints.length === 0
                ? <p className="rounded-[10px] border border-dashed border-line p-6 text-center text-ink-mute">This recording has no completed requests. Check the backend was sending traces while it ran.</p>
                : <EndpointTable summary={summary} baseline={baseline} />}
              {selected && <EndpointDetail endpoint={selected} />}
              <NotReached routes={summary.notReached} declared={project.routes.length} />
            </>
          )}
        </main>
      </div>
      {editing && <ProjectDialog key={editing.id ?? 'new'} />}
    </div>
  )
}
