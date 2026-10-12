import { ChevronDown } from 'lucide-react'
import { isDirty, useStore } from '@/store'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/ui/dialog'

/** Closes several tabs at once. It stays at the end of the tab bar however far the tabs scroll. */
export function TabsMenu() {
  const tabs = useStore((s) => s.tabs)
  const queries = useStore((s) => s.queries)
  const activeTabId = useStore((s) => s.activeTabId)
  const { closeTabs } = useStore.getState()
  const others = tabs.filter((t) => t.id !== activeTabId)
  const clean = tabs.filter((t) => !isDirty(t, queries))
  const ids = (list: typeof tabs) => list.map((t) => t.id)
  return (
    <Menu>
      <MenuTrigger aria-label="Close tabs" title="Close several tabs at once" className="flex w-9 shrink-0 items-center justify-center border-l border-line text-ink-mute hover:bg-black/[0.04] data-[state=open]:bg-black/[0.06]">
        <ChevronDown className="size-4" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onSelect={() => closeTabs(ids(tabs))}>Close all tabs<span className="ml-auto pl-4 text-[11px] text-ink-mute">Alt Shift W</span></MenuItem>
        <MenuItem disabled={others.length === 0} onSelect={() => closeTabs(ids(others))}>Close the other tabs</MenuItem>
        <MenuItem disabled={clean.length === 0 || clean.length === tabs.length} onSelect={() => closeTabs(ids(clean))}>Close tabs with nothing unsaved</MenuItem>
      </MenuContent>
    </Menu>
  )
}
