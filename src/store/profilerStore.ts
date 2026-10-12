import { create } from 'zustand'
import type { Project, RecorderStatus, Recording, RecordingInfo } from '@shared/profiler'
import { profilerApi } from '@/lib/profilerApi'

export type EndpointSort = 'median' | 'p95' | 'db' | 'queries' | 'calls' | 'route'

interface ProfilerState {
  loaded: boolean
  error: string
  status: RecorderStatus | null
  projects: Project[]
  projectId: string
  recordings: RecordingInfo[]
  recording: Recording | null
  /** An earlier recording to measure the open one against. */
  baseline: Recording | null
  endpointKey: string
  sort: EndpointSort
  filter: string
  onlyFlagged: boolean
  /** The project being created (empty id) or edited, while its dialog is open. */
  editing: { id?: string; name: string; repoPath: string; backendUrl?: string } | null

  set: (patch: Partial<ProfilerState>) => void
  load: () => Promise<void>
  refreshStatus: () => Promise<void>
  selectProject: (id: string) => Promise<void>
  openRecording: (id: string) => Promise<void>
  setBaseline: (id: string) => Promise<void>
  saveProject: (input: { id?: string; name: string; repoPath: string; backendUrl?: string }) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  start: (name: string) => Promise<void>
  stop: () => Promise<void>
  renameRecording: (id: string, name: string) => Promise<void>
  deleteRecording: (id: string) => Promise<void>
}

const failure = (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) })

/** Kept apart from the main store: nothing here is saved by the browser, the server owns it all. */
export const useProfiler = create<ProfilerState>((set, get) => ({
  loaded: false, error: '', status: null, projects: [], projectId: '', recordings: [], recording: null, baseline: null,
  endpointKey: '', sort: 'median', filter: '', onlyFlagged: false, editing: null,

  set: (patch) => set(patch),

  async load() {
    try {
      const [projects, status] = await Promise.all([profilerApi.projects(), profilerApi.status()])
      set({ projects, status, loaded: true, error: '' })
      const wanted = status.active?.projectId ?? get().projectId
      const project = projects.find((p) => p.id === wanted) ?? projects[0]
      if (project) await get().selectProject(project.id)
    } catch (err) {
      set({ ...failure(err), loaded: true })
    }
  },

  async refreshStatus() {
    try { set({ status: await profilerApi.status() }) } catch { /* the next poll will try again */ }
  },

  async selectProject(id) {
    set({ projectId: id, recordings: [], recording: null, baseline: null, endpointKey: '' })
    try {
      const recordings = await profilerApi.recordings(id)
      set({ recordings })
      if (recordings[0]) await get().openRecording(recordings[0].id)
    } catch (err) {
      set(failure(err))
    }
  },

  async openRecording(id) {
    try {
      const recording = await profilerApi.recording(get().projectId, id)
      // Comparing a recording with itself says nothing.
      set({ recording, endpointKey: '', error: '', baseline: get().baseline?.id === id ? null : get().baseline })
    } catch (err) {
      set(failure(err))
    }
  },

  async setBaseline(id) {
    if (!id) { set({ baseline: null }); return }
    try { set({ baseline: await profilerApi.recording(get().projectId, id) }) } catch (err) { set(failure(err)) }
  },

  async saveProject(input) {
    const project = await profilerApi.saveProject(input)
    set({ projects: await profilerApi.projects(), editing: null })
    if (get().projectId !== project.id) await get().selectProject(project.id)
  },

  async deleteProject(id) {
    await profilerApi.deleteProject(id)
    const projects = await profilerApi.projects()
    set({ projects, projectId: '', recordings: [], recording: null, baseline: null })
    if (projects[0]) await get().selectProject(projects[0].id)
  },

  async start(name) {
    try {
      await profilerApi.start(get().projectId, name)
      set({ error: '' })
    } catch (err) {
      set(failure(err))
    }
    await get().refreshStatus()
  },

  async stop() {
    try {
      const stopping = profilerApi.stop()
      void get().refreshStatus()
      const info = await stopping
      set({ recordings: await profilerApi.recordings(info.projectId), error: '' })
      await get().openRecording(info.id)
    } catch (err) {
      set(failure(err))
    }
    await get().refreshStatus()
  },

  async renameRecording(id, name) {
    await profilerApi.renameRecording(get().projectId, id, name)
    set({ recordings: await profilerApi.recordings(get().projectId) })
    if (get().recording?.id === id) set({ recording: { ...get().recording!, name } })
  },

  async deleteRecording(id) {
    await profilerApi.deleteRecording(get().projectId, id)
    const recordings = await profilerApi.recordings(get().projectId)
    set({ recordings, baseline: get().baseline?.id === id ? null : get().baseline })
    if (get().recording?.id === id) {
      set({ recording: null })
      if (recordings[0]) await get().openRecording(recordings[0].id)
    }
  },
}))
