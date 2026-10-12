import dagre from 'dagre'
import type { SchemaTable } from '@shared/types'
import { id, type Link } from './links'

export const NODE_WIDTH = 230

export const ROW = 22

export const HEADER = 32

export const MAX_ROWS = 14

export function layout(tables: SchemaTable[], links: Link[]): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90, marginx: 24, marginy: 24 })
  graph.setDefaultEdgeLabel(() => ({}))
  const height = (t: SchemaTable) => HEADER + Math.min(t.columns.length, MAX_ROWS) * ROW + (t.columns.length > MAX_ROWS ? ROW : 0)
  for (const t of tables) graph.setNode(id(t.schema, t.name), { width: NODE_WIDTH, height: height(t) })
  // Parent on the left, child on the right, so arrows read "child points at parent".
  for (const l of links) if (l.from !== l.to) graph.setEdge(l.to, l.from)
  dagre.layout(graph)
  // Tables with no links would otherwise form one tall column; wrap them into a grid underneath.
  const linkedIds = new Set(links.flatMap((l) => [l.from, l.to]))
  const positions = new Map<string, { x: number; y: number }>()
  let bottom = 0
  for (const t of tables) {
    const key = id(t.schema, t.name)
    if (!linkedIds.has(key)) continue
    const n = graph.node(key)
    positions.set(key, { x: n.x - n.width / 2, y: n.y - n.height / 2 })
    bottom = Math.max(bottom, n.y + n.height / 2)
  }
  const loose = tables.filter((t) => !linkedIds.has(id(t.schema, t.name)))
  const perRow = Math.max(3, Math.ceil(Math.sqrt(loose.length * 1.6)))
  let x = 24
  let y = bottom + (positions.size ? 70 : 24)
  let rowHeight = 0
  loose.forEach((t, i) => {
    if (i > 0 && i % perRow === 0) { x = 24; y += rowHeight + 28; rowHeight = 0 }
    positions.set(id(t.schema, t.name), { x, y })
    x += NODE_WIDTH + 28
    rowHeight = Math.max(rowHeight, height(t))
  })
  return positions
}
