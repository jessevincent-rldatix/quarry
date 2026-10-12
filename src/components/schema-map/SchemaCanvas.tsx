import '@xyflow/react/dist/style.css'
import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { SchemaTable } from '@shared/types'
import { previewSql, tableKey } from '@/lib/sqlBuilder'
import { cn, matches } from '@/lib/utils'
import { useDialect, useStore, useTables } from '@/store'
import { Button } from '@/ui/button'
import { SectionLabel, Select } from '@/ui/input'
import { Background, Controls, type Edge, MarkerType, MiniMap, type Node, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react'
import { TableNode, type TableNodeData } from './TableNode'
import { layout } from './layout'
import { findLinks, id } from './links'

export const nodeTypes = { table: TableNode }

/** "1 table", "4 tables". */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

export function SchemaCanvas() {
  const tables = useTables()
  const dialect = useDialect()
  const connectionId = useStore((s) => s.activeConnectionId)
  const loading = useStore((s) => s.schemas[s.activeConnectionId]?.loading)
  const schemas = useMemo(() => [...new Set(tables.map((t) => t.schema))].sort(), [tables])
  const [schema, setSchema] = useState('*')
  const [search, setSearch] = useState('')
  const [guess, setGuess] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)

  const declared = useMemo(() => tables.some((t) => (t.foreignKeys?.length ?? 0) > 0), [tables])
  // A database that declares no relationships at all gets guesses switched on, since otherwise the canvas has no arrows.
  useEffect(() => { setGuess(!declared && tables.length > 0); setSchema('*'); setFocus(null) }, [connectionId, declared, tables.length])

  const visible = useMemo(() => tables.filter((t) => schema === '*' || t.schema === schema), [tables, schema])
  const links = useMemo(() => findLinks(visible, guess), [visible, guess])
  const positions = useMemo(() => layout(visible, links), [visible, links])

  const onPreview = (t: SchemaTable) => {
    const tabId = useStore.getState().openSql({ title: t.name, sql: previewSql(t, dialect), connectionId: useStore.getState().activeConnectionId })
    void useStore.getState().runTab(tabId)
  }

  const built = useMemo(() => {
    const neighbours = new Set<string>()
    if (focus) {
      neighbours.add(focus)
      for (const l of links) { if (l.from === focus) neighbours.add(l.to); if (l.to === focus) neighbours.add(l.from) }
    }
    const term = search.trim()
    const nodes: Node<TableNodeData>[] = visible.map((t) => {
      const key = id(t.schema, t.name)
      const hit = !term || matches(tableKey(t), term) || t.columns.some((c) => matches(c.name, term))
      return {
        id: key, type: 'table', position: positions.get(key) ?? { x: 0, y: 0 },
        data: { table: t, linked: new Set(links.filter((l) => l.from === key).map((l) => l.column)), dim: !hit || (focus !== null && !neighbours.has(key)), onPreview },
      }
    })
    const edges: Edge[] = links.map((l, i) => {
      const active = focus === null || l.from === focus || l.to === focus
      const colour = l.guessed ? '#b45309' : '#0e7c63'
      return {
        id: `${l.from}|${l.column}|${i}`, source: l.to, target: l.from, type: 'smoothstep',
        label: `${l.column} → ${l.refColumn}`,
        labelStyle: { fontSize: 10, fill: '#43716b' }, labelBgStyle: { fill: '#fbfefd' },
        style: { stroke: colour, strokeWidth: 1.5, strokeDasharray: l.guessed ? '5 4' : undefined, opacity: active ? 1 : 0.12 },
        markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 16, height: 16 },
      }
    })
    return { nodes, edges }
    // onPreview only reads the store, so it does not need to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, links, positions, search, focus])

  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges)
  useEffect(() => { setNodes(built.nodes); setEdges(built.edges) }, [built, setNodes, setEdges])

  const guessed = links.filter((l) => l.guessed).length
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-editor">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-panel px-3 py-1.5">
        <SectionLabel>Schema map</SectionLabel>
        {schemas.length > 1 && (
          <Select aria-label="Schema" className="h-7 w-auto text-[12px]" value={schema} onChange={(e) => { setSchema(e.target.value); setFocus(null) }}>
            <option value="*">All schemas</option>
            {schemas.map((s) => <option key={s} value={s}>{s || '(default)'}</option>)}
          </Select>
        )}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Highlight tables or columns" aria-label="Highlight tables or columns"
               className="h-7 w-56 rounded-md border border-line bg-white px-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" />
        <label className="flex min-h-7 items-center gap-1.5 text-[12px]" title="Draws a dashed arrow where a column is named after another table, such as customer_id and customers.id">
          <input type="checkbox" className="accent-brand" checked={guess} onChange={(e) => setGuess(e.target.checked)} />
          Guess links from column names
        </label>
        <span className="ml-auto flex flex-wrap items-center gap-x-3 text-[12px] text-ink-mute">
          <span>{count(visible.length, 'table')} · {count(links.length - guessed, 'foreign key')}{guess ? ` · ${guessed} guessed` : ''}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-5 bg-accent-deep" />declared</span>
          <span className="flex items-center gap-1"><span className="inline-block w-5 border-t-2 border-dashed border-[#b45309]" />guessed</span>
          <Button variant="ghost" size="xs" onClick={() => void useStore.getState().loadSchema(connectionId, true)}><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />Refresh</Button>
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-ink-mute">{loading ? 'Reading the schema…' : 'No tables found on this connection.'}</div>
        ) : (
          <ReactFlow
            key={`${connectionId}|${schema}|${guess}`}
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => setFocus((current) => (current === node.id ? null : node.id))}
            onPaneClick={() => setFocus(null)}
            fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.05} maxZoom={1.75}
            nodesConnectable={false} edgesFocusable={false} proOptions={{ hideAttribution: true }}
          >
            <Background color="#d1e7e3" gap={20} />
            <Controls showInteractive={false} />
            {visible.length > 12 && <MiniMap pannable zoomable nodeColor="#0e4044" maskColor="rgba(243,250,248,0.7)" />}
          </ReactFlow>
        )}
      </div>
      <div className="shrink-0 border-t border-line-soft bg-panel px-3 py-1 text-[11px] text-ink-mute">
        Click a table to see only what it connects to. Double-click to preview its rows. Drag tables to rearrange; scroll to zoom.
      </div>
    </div>
  )
}
