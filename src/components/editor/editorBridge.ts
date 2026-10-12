import type { SqlEditorHandle } from './SqlEditor'

/** Lets other panels (schema, search, Ask) type into whichever editor is showing. */
export const editorBridge: { current: SqlEditorHandle | null } = { current: null }
