import { Check, ChevronDown, Command, Lock, Settings2 } from 'lucide-react'
import { cn, kbd } from '@/lib/utils'
import { useConnection, useStore } from '@/store'
import { ConnectionDot, connectionPaint } from '@/ui/connection-color'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/ui/dialog'
import { Pill } from '@/ui/input'
import { VoiceButton } from '../voice/VoiceButton'

const DIALECT_NAME = { sqlite: 'SQLite', mssql: 'SQL Server', postgres: 'PostgreSQL', mysql: 'MySQL', snowflake: 'Snowflake', databricks: 'Databricks' }

/** The dark bar across the top: name, search and the connection of the current tab. */
export function Chrome() {
  const connections = useStore((s) => s.connections)
  const connection = useConnection()
  const paint = connectionPaint(connection?.color)
  const { set, setConnection, setDialog } = useStore.getState()
  return (
    <header className="relative flex min-h-9 shrink-0 flex-wrap items-center gap-2 bg-chrome px-2 text-white">
      <div className="px-2 py-1 font-semibold">Quarry</div>
      <button onClick={() => set({ paletteOpen: true })}
              className="mx-auto flex h-6 w-[420px] max-w-[42vw] items-center justify-center gap-2 rounded-md bg-chrome-deep px-3 text-[12px] text-chrome-text hover:text-white">
        <Command className="size-3" />Search &amp; commands
        <kbd className="ml-1 rounded bg-chrome px-1 text-[10px]">{kbd('K')}</kbd>
      </button>
      <VoiceButton />
      {connection?.readOnly && <Pill className="flex items-center gap-1 bg-var-bg text-var-ink"><Lock className="size-3" />Read-only</Pill>}
      <Menu>
        {/* A marked connection fills the whole button, since a small dark dot is easy to miss on the dark bar. */}
        <MenuTrigger className={cn('flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px]', paint ? paint.button : 'bg-chrome-deep hover:bg-black/30')}>
          {paint ? <ConnectionDot color={connection?.color} className="ring-2 ring-white" /> : <span className="size-[7px] rounded-full bg-accent" />}
          {connection?.name ?? 'No connection'}
          {connection && <span className={paint ? 'text-white/85' : 'text-chrome-text'}>{DIALECT_NAME[connection.dialect]}</span>}
          <ChevronDown className={cn('size-3', paint ? 'text-white/85' : 'text-chrome-text')} />
        </MenuTrigger>
        <MenuContent align="end" className="min-w-[220px]">
          <MenuLabel>Connections</MenuLabel>
          {connections.map((c) => (
            <MenuItem key={c.id} onSelect={() => setConnection(c.id)}>
              <ConnectionDot color={c.color} reserve />
              <span className="flex-1">{c.name}</span>
              <span className="text-[11px] text-ink-mute">{DIALECT_NAME[c.dialect]}</span>
              {c.id === connection?.id && <Check className="text-accent-deep" />}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onSelect={() => setDialog({ kind: 'connections' })}><Settings2 />Manage connections…</MenuItem>
        </MenuContent>
      </Menu>
    </header>
  )
}
