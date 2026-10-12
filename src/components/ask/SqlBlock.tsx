import { CornerDownLeft, FilePlus2, Play, Replace } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/ui/button'
import { editorBridge } from '../editor/editorBridge'

/** SQL from an answer, with ways to put it to use. Nothing runs until you press Run. */
export function SqlBlock({ sql }: { sql: string }) {
  const open = (run: boolean) => {
    const { openSql, runTab, set, activeConnectionId } = useStore.getState()
    // Ask answers about the connection in front of the person, so that is where its SQL opens.
    const id = openSql({ sql, connectionId: activeConnectionId })
    set({ view: 'editor' })
    if (run) void runTab(id)
  }
  const insert = () => {
    useStore.getState().set({ view: 'editor' })
    editorBridge.current?.insert(sql)
  }
  const replace = () => {
    const { set, replaceTabSql, activeTabId } = useStore.getState()
    set({ view: 'editor' })
    replaceTabSql(activeTabId, sql)
  }
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-editor">
      <pre className="scrollbars-visible max-h-64 overflow-auto p-2.5 font-mono text-[12px] leading-[18px]">{sql}</pre>
      <div className="flex flex-wrap gap-1 border-t border-line-soft bg-panel px-1.5 py-1">
        <Button variant="ghost" size="xs" onClick={insert}><CornerDownLeft className="size-3.5" />Insert</Button>
        <Button variant="ghost" size="xs" title="Replace the whole query in the open tab with this one. Nothing is run." onClick={replace}><Replace className="size-3.5" />Replace query</Button>
        <Button variant="ghost" size="xs" onClick={() => open(false)}><FilePlus2 className="size-3.5" />New tab</Button>
        <Button variant="ghost" size="xs" onClick={() => open(true)}><Play className="size-3.5 text-accent-deep" />Run in new tab</Button>
      </div>
    </div>
  )
}
