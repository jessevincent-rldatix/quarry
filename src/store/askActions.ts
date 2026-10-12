import { PLACES, type Place } from '@shared/askActions'
import { readOnlyViolation } from '@shared/readonly'
import type { AskAction, AskWorkspace } from '@shared/types'
import { BUILTIN_TEMPLATES, templateSql } from '@/lib/builtins'
import { closest } from '@/lib/closest'
import { formatSql } from '@/lib/formatSql'
import { prepareRun } from '@/lib/run'
import { previewSql, tableKey } from '@/lib/sqlBuilder'
import { kbd } from '@/lib/utils'
import type { Panel, State, View } from './types'

/** What became of one action: a line to show under the answer. */
export interface ActionOutcome {
  ok: boolean
  text: string
}

const VIEWS: Partial<Record<Place, View>> = { editor: 'editor', builder: 'builder', map: 'map', templates: 'templates', profiler: 'profiler' }
const PANELS: Partial<Record<Place, Panel>> = { library: 'library', schema: 'schema', history: 'history' }
const PLACE_NAME: Record<Place, string> = {
  editor: 'the editor', builder: 'the Builder', map: 'the Map', templates: 'Templates', profiler: 'the Profiler',
  library: 'the Library', schema: 'the Schema', history: 'History', connections: 'Connections', search: 'Search',
}

const done = (text: string): ActionOutcome => ({ ok: true, text })
const not = (text: string): ActionOutcome => ({ ok: false, text })

const allTemplates = (state: State) => [...state.templates, ...BUILTIN_TEMPLATES]

/** The names Ask is given so it can be asked to open or show things. */
export const workspaceNames = (state: State): AskWorkspace => ({
  queries: state.queries.map((q) => q.name),
  templates: allTemplates(state).map((t) => t.name),
  tabs: state.tabs.map((t) => t.title),
  connections: state.connections.map((c) => c.name),
})

/**
 * Carries out one thing Ask asked for, through the same store actions the buttons use, so every
 * check they make (unsaved changes, risky writes) still applies. Running is narrower than the
 * Run button: only a query that reads is run, because a request can be misheard or misread.
 */
export function perform(action: AskAction, get: () => State): ActionOutcome {
  const state = get()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  const connection = state.connections.find((c) => c.id === state.activeConnectionId)

  switch (action.kind) {
    case 'open-query': {
      const query = closest(action.name, state.queries, (q) => q.name)
      if (!query) return not(`There is no saved query called “${action.name}”.`)
      state.openQuery(query.id)
      return done(`Opened “${query.name}”.`)
    }
    case 'open-template': {
      const template = closest(action.name, allTemplates(state), (t) => t.name)
      if (!template) return not(`There is no template called “${action.name}”.`)
      if (connection && templateSql(template, connection.dialect, state.schemas[connection.id]?.tables) === null) return not(`The template “${template.name}” is not written for this kind of database.`)
      state.set({ view: 'templates', templatePick: { id: template.id, values: {} } })
      return done(`Opened the template “${template.name}”.`)
    }
    case 'preview-table': {
      const tables = state.schemas[state.activeConnectionId]?.tables ?? []
      // A name given with its schema is matched whole first, so "sales.orders" is not taken for "audit.orders".
      const table = tables.find((t) => tableKey(t).toLowerCase() === action.name.toLowerCase()) ?? closest(action.name, tables, (t) => t.name)
      if (!table || !connection) return not(`There is no table called “${action.name}” on ${connection?.name ?? 'this connection'}.`)
      const id = state.openSql({ title: table.name, sql: previewSql(table, connection.dialect), connectionId: connection.id })
      void get().runTab(id)
      return done(`Opened the first rows of ${tableKey(table)}.`)
    }
    case 'use-connection': {
      const target = closest(action.name, state.connections, (c) => c.name)
      if (!target) return not(`There is no connection called “${action.name}”.`)
      state.setConnection(target.id)
      return done(`This tab now uses ${target.name}.`)
    }
    case 'switch-tab': {
      const target = closest(action.name, state.tabs, (t) => t.title)
      if (!target) return not(`There is no open tab called “${action.name}”.`)
      state.activateTab(target.id)
      return done(`Went to the tab “${target.title}”.`)
    }
    case 'show': {
      const place = closest(action.name, [...PLACES], (p) => p)
      if (!place) return not(`Quarry has nothing called “${action.name}” to show.`)
      if (VIEWS[place]) state.set({ view: VIEWS[place] })
      else if (PANELS[place]) state.set({ view: 'editor', panel: PANELS[place] })
      else if (place === 'connections') state.setDialog({ kind: 'connections' })
      else state.set({ paletteOpen: true })
      return done(`Showing ${PLACE_NAME[place]}.`)
    }
    case 'new-tab':
      state.newTab()
      return done('Opened a new tab.')
    case 'close-tab': {
      if (!tab) return not('There is no tab to close.')
      state.closeTab(tab.id)
      // An unsaved tab is not closed: closeTab asks first.
      return get().tabs.some((t) => t.id === tab.id) ? not(`“${tab.title}” has unsaved changes, so Quarry is asking before closing it.`) : done(`Closed “${tab.title}”.`)
    }
    case 'close-all-tabs': {
      const count = state.tabs.length
      state.closeTabs(state.tabs.map((t) => t.id))
      // With unsaved work in any of them, closeTabs asks first and nothing has closed yet.
      return get().dialog?.kind === 'confirm' ? not('Some tabs have unsaved changes, so Quarry is asking before closing them.') : done(`Closed ${count === 1 ? 'the tab' : `all ${count} tabs`}.`)
    }
    case 'run': {
      const prepared = tab && connection ? prepareRun(tab, connection) : null
      if (!tab || !connection || !prepared) return not('There is no query in the open tab to run.')
      if (readOnlyViolation(prepared.sql, connection.dialect)) return not(`Did not run “${tab.title}”: it does more than read. Run it yourself with ${kbd('Enter')}.`)
      state.set({ view: 'editor' })
      void state.runTab(tab.id)
      return done(`Ran “${tab.title}” on ${connection.name}.`)
    }
    case 'format': {
      if (!tab?.sql.trim() || !connection) return not('There is no query in the open tab to tidy.')
      try {
        state.replaceTabSql(tab.id, formatSql(tab.sql, connection.dialect))
      } catch {
        return not('Could not tidy the query: it has a syntax error.')
      }
      return done(`Tidied the query in “${tab.title}”.`)
    }
    case 'save': {
      if (!tab) return not('There is no tab to save.')
      state.saveTab(tab.id)
      return tab.queryId ? done(`Saved “${tab.title}”.`) : done('Asking for a name to save it under.')
    }
  }
}
