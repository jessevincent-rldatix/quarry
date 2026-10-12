import fs from 'node:fs'
import path from 'node:path'
import type { Project, ProjectRoute, Recording, RecordingInfo } from '../../shared/profiler.ts'

const METHODS = ['get', 'post', 'put', 'delete', 'patch']

/** Reads every route out of an OpenAPI (Swagger) document. */
export function routesFromSwagger(document: unknown): ProjectRoute[] {
  const paths = (document as { paths?: Record<string, Record<string, unknown>> }).paths ?? {}
  return Object.entries(paths).flatMap(([route, operations]) =>
    METHODS.filter((method) => operations?.[method]).map((method) => ({ method: method.toUpperCase(), route })))
}

/** Looks for the backend's swagger.json: at the top of the repo, or one folder down. */
export function findSwagger(repoPath: string): string | null {
  const candidates = ['swagger.json', 'openapi.json', 'src/swagger.json', 'docs/swagger.json']
  return candidates.map((name) => path.join(repoPath, name)).find((file) => fs.existsSync(file)) ?? null
}

/**
 * Projects and their recordings, kept as plain files:
 *   projects/<project>/project.json
 *   projects/<project>/recordings/<recording>.json
 */
export function createProfilerStorage(dataDir: string) {
  const root = path.join(dataDir, 'projects')
  fs.mkdirSync(root, { recursive: true })
  // Ids become folder names, so only accept the characters this module itself generates.
  const safe = (id: string) => {
    if (!/^[a-z0-9]+$/i.test(id)) throw new Error('Unknown id.')
    return id
  }
  const projectDir = (id: string) => path.join(root, safe(id))
  const recordingFile = (projectId: string, id: string) => path.join(projectDir(projectId), 'recordings', `${safe(id)}.json`)
  const read = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value))
    fs.renameSync(`${file}.tmp`, file)
  }
  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

  return {
    projects(): Project[] {
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'project.json')))
        .map((entry) => read<Project>(path.join(root, entry.name, 'project.json')))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    project(id: string): Project {
      return read<Project>(path.join(projectDir(id), 'project.json'))
    },
    async saveProject(input: { id?: string; name: string; repoPath: string; backendUrl?: string }): Promise<Project> {
      const name = input.name.trim()
      if (!name) throw new Error('Give the project a name.')
      const repoPath = input.repoPath.trim()
      const backendUrl = (input.backendUrl ?? '').trim().replace(/\/+$/, '')
      if (backendUrl && !/^https?:\/\//i.test(backendUrl)) throw new Error('The backend address must start with http:// or https://')
      if (repoPath && !fs.existsSync(repoPath)) throw new Error(`Folder not found: ${repoPath}`)
      let routes: ProjectRoute[] = []
      let routesFrom = ''
      if (backendUrl) {
        // The running backend describes itself exactly; a file in the repo may lag behind the code.
        try {
          const response = await fetch(`${backendUrl}/swagger/v1/swagger.json`, { signal: AbortSignal.timeout(8000) })
          if (response.ok) { routes = routesFromSwagger(await response.json()); routesFrom = 'the running backend' }
        } catch { /* not running right now: fall back to the file */ }
      }
      if (routes.length === 0 && repoPath) {
        const swagger = findSwagger(repoPath)
        if (swagger) { routes = routesFromSwagger(read(swagger)); routesFrom = path.basename(swagger) }
      }
      const existing = input.id ? this.project(input.id) : null
      // Keep the routes already known when nothing could be read this time.
      if (routes.length === 0 && existing) { routes = existing.routes; routesFrom = existing.routesFrom ?? '' }
      const project: Project = { id: existing?.id ?? newId(), name, repoPath, backendUrl, routes, routesFrom, createdAt: existing?.createdAt ?? Date.now() }
      write(path.join(projectDir(project.id), 'project.json'), project)
      return project
    },
    deleteProject(id: string): void {
      fs.rmSync(projectDir(id), { recursive: true, force: true })
    },
    recordings(projectId: string): RecordingInfo[] {
      const dir = path.join(projectDir(projectId), 'recordings')
      if (!fs.existsSync(dir)) return []
      return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => {
        const { items: _items, ...info } = read<Recording>(path.join(dir, name))
        return info
      }).sort((a, b) => b.startedAt - a.startedAt)
    },
    recording(projectId: string, id: string): Recording {
      return read<Recording>(recordingFile(projectId, id))
    },
    saveRecording(recording: Recording): void {
      write(recordingFile(recording.projectId, recording.id), recording)
    },
    renameRecording(projectId: string, id: string, name: string): void {
      const recording = this.recording(projectId, id)
      write(recordingFile(projectId, id), { ...recording, name: name.trim() || recording.name })
    },
    deleteRecording(projectId: string, id: string): void {
      fs.rmSync(recordingFile(projectId, id), { force: true })
    },
  }
}

export type ProfilerStorage = ReturnType<typeof createProfilerStorage>
