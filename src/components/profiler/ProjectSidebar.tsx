import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import { useStore } from '@/store'
import { useProfiler } from '@/store/profilerStore'
import { Button } from '@/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/ui/dialog'
import { SectionLabel, Select } from '@/ui/input'

/** Left column of the profiler: which project, and its recordings newest first. */
export function ProjectSidebar() {
  const projects = useProfiler((s) => s.projects)
  const projectId = useProfiler((s) => s.projectId)
  const recordings = useProfiler((s) => s.recordings)
  const openId = useProfiler((s) => s.recording?.id)
  const project = projects.find((p) => p.id === projectId)
  const profiler = useProfiler.getState()
  const { setDialog } = useStore.getState()

  const rename = (id: string, current: string) => setDialog({
    kind: 'prompt', title: 'Rename recording', label: 'Name', value: current, onSubmit: (name) => { void profiler.renameRecording(id, name) },
  })
  const remove = (id: string, name: string) => setDialog({
    kind: 'confirm', danger: true, action: 'Delete', title: `Delete recording "${name}"?`, body: 'Its requests and query timings are removed. This cannot be undone.',
    onConfirm: () => void profiler.deleteRecording(id),
  })

  return (
    <aside aria-label="Projects and recordings" className="flex w-full shrink-0 flex-col gap-2 border-r border-line bg-panel p-2.5 md:w-[250px]">
      <div className="flex items-center gap-1">
        <SectionLabel className="flex-1 px-1">Project</SectionLabel>
        <Button variant="ghost" size="xs" className="text-accent-deep" onClick={() => profiler.set({ editing: { name: '', repoPath: '' } })}><Plus className="size-3.5" />New</Button>
      </div>
      {projects.length > 0 && (
        <div className="flex items-center gap-1">
          <Select aria-label="Project" value={projectId} onChange={(e) => void profiler.selectProject(e.target.value)} className="h-8 text-[12.5px]">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {project && (
            <Menu>
              <MenuTrigger aria-label="Project actions" className="shrink-0 rounded p-1.5 hover:bg-black/10"><MoreHorizontal className="size-4" /></MenuTrigger>
              <MenuContent align="end">
                <MenuItem onSelect={() => profiler.set({ editing: { id: project.id, name: project.name, repoPath: project.repoPath, backendUrl: project.backendUrl } })}><Pencil />Edit, or re-read routes</MenuItem>
                <MenuItem danger onSelect={() => setDialog({
                  kind: 'confirm', danger: true, action: 'Delete project', title: `Delete project "${project.name}"?`,
                  body: `The project and its ${recordings.length} recording${recordings.length === 1 ? '' : 's'} are removed from this machine. The backend itself is not touched.`,
                  onConfirm: () => void profiler.deleteProject(project.id),
                })}><Trash2 />Delete project</MenuItem>
              </MenuContent>
            </Menu>
          )}
        </div>
      )}
      {project && <p className="px-1 text-[11.5px] text-ink-mute">{project.routes.length ? `${project.routes.length} routes read from ${project.routesFrom || 'swagger.json'}` : 'No routes read. Add the backend address or folder to see coverage.'}</p>}

      <SectionLabel className="mt-2 px-1">Recordings</SectionLabel>
      <div className="scrollbars-visible -mx-1 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1">
        {recordings.map((r) => (
          <div key={r.id} className={cn('group flex items-center rounded-md hover:bg-mint-hover/40', r.id === openId && 'bg-mint hover:bg-mint')}>
            <button onClick={() => void profiler.openRecording(r.id)} className="flex min-w-0 flex-1 flex-col px-2 py-1.5 text-left">
              <span className={cn('truncate text-[12.5px]', r.id === openId && 'font-medium text-brand')}>{r.name}</span>
              <span className="text-[11px] text-ink-mute">{r.requests.toLocaleString()} requests · {timeAgo(r.startedAt)}</span>
            </button>
            <Menu>
              <MenuTrigger aria-label={`Actions for ${r.name}`} className="mr-1 shrink-0 rounded p-0.5 opacity-0 hover:bg-black/10 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal className="size-4" /></MenuTrigger>
              <MenuContent align="end">
                <MenuItem onSelect={() => rename(r.id, r.name)}><Pencil />Rename</MenuItem>
                <MenuItem danger onSelect={() => remove(r.id, r.name)}><Trash2 />Delete</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        ))}
        {project && recordings.length === 0 && <div className="px-1.5 py-2 text-[12.5px] text-ink-mute">No recordings yet. Press Record, then use the app.</div>}
      </div>
    </aside>
  )
}
