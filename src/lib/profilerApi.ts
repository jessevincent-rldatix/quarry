import type { Project, RecorderStatus, Recording, RecordingInfo } from '@shared/profiler'
import { call, json } from './api'

export const profilerApi = {
  status: () => call<RecorderStatus>('/profiler/status'),
  projects: () => call<{ projects: Project[] }>('/profiler/projects').then((r) => r.projects),
  saveProject: (input: { id?: string; name: string; repoPath: string; backendUrl?: string }) => call<Project>('/profiler/projects', json('POST', input)),
  deleteProject: (id: string) => call<{ ok: true }>(`/profiler/projects/${id}`, json('DELETE', {})),
  recordings: (projectId: string) => call<{ recordings: RecordingInfo[] }>(`/profiler/projects/${projectId}/recordings`).then((r) => r.recordings),
  recording: (projectId: string, id: string) => call<Recording>(`/profiler/projects/${projectId}/recordings/${id}`),
  renameRecording: (projectId: string, id: string, name: string) => call<{ ok: true }>(`/profiler/projects/${projectId}/recordings/${id}`, json('POST', { name })),
  deleteRecording: (projectId: string, id: string) => call<{ ok: true }>(`/profiler/projects/${projectId}/recordings/${id}`, json('DELETE', {})),
  start: (projectId: string, name: string) => call<RecordingInfo>('/profiler/record/start', json('POST', { projectId, name })),
  stop: () => call<RecordingInfo>('/profiler/record/stop', json('POST', {})),
}
