import { useState } from 'react'
import { ClipboardCopy, Download } from 'lucide-react'
import type { RecordingSummary } from '@shared/profiler'
import { download } from '@/lib/export'
import { toHtmlReport, toMarkdownReport } from '@/lib/profilerExport'
import { useProfiler } from '@/store/profilerStore'
import { Button } from '@/ui/button'
import { Input, Select } from '@/ui/input'

/** Narrow the endpoint list, pick a recording to compare against, and take the report elsewhere. */
export function ReportToolbar({ summary }: { summary: RecordingSummary }) {
  const filter = useProfiler((s) => s.filter)
  const onlyFlagged = useProfiler((s) => s.onlyFlagged)
  const recording = useProfiler((s) => s.recording)!
  const recordings = useProfiler((s) => s.recordings)
  const baselineId = useProfiler((s) => s.baseline?.id ?? '')
  const project = useProfiler((s) => s.projects.find((p) => p.id === s.projectId)?.name ?? 'Project')
  const [copied, setCopied] = useState(false)
  const { set, setBaseline } = useProfiler.getState()
  const others = recordings.filter((r) => r.id !== recording.id)
  const fileName = `${project} ${recording.name}`.replace(/[^\w-]+/g, '_')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={filter} onChange={(e) => set({ filter: e.target.value })} placeholder="Filter endpoints" aria-label="Filter endpoints" className="h-8 w-56 text-[12.5px]" />
      <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" className="accent-brand" checked={onlyFlagged} onChange={(e) => set({ onlyFlagged: e.target.checked })} />Only flagged</label>
      {others.length > 0 && (
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-mute">Compare with
          <Select value={baselineId} onChange={(e) => void setBaseline(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Baseline recording">
            <option value="">nothing</option>
            {others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </label>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="xs" onClick={() => { void navigator.clipboard.writeText(toMarkdownReport(project, recording, summary)); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
          <ClipboardCopy className="size-3.5" />{copied ? 'Copied' : 'Copy as Markdown'}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => download(`${fileName}.html`, toHtmlReport(project, recording, summary), 'text/html')}><Download className="size-3.5" />Export report</Button>
      </div>
    </div>
  )
}
