import { useRef, useState } from 'react'
import { CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react'
import { CONNECTION_COLORS, type ConnectionColor, type ConnectionInfo, type ConnectionInput, type Dialect } from '@shared/types'
import { api } from '@/lib/api'
import { parseConnectionString } from '@/lib/connectionString'
import { cn, uid } from '@/lib/utils'
import { useStore } from '@/store'
import { Button } from '@/ui/button'
import { CONNECTION_COLOR, ConnectionDot } from '@/ui/connection-color'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/ui/dialog'
import { Field, Input, Select } from '@/ui/input'
import { close } from './close'
import { DatabricksFields } from './DatabricksFields'
import { SnowflakeFields } from './SnowflakeFields'

const DIALECT_LABEL: Record<Dialect, string> = {
  mssql: 'SQL Server', postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB', snowflake: 'Snowflake', databricks: 'Databricks', sqlite: 'SQLite file',
}
const DEFAULT_PORT: Partial<Record<Dialect, number>> = { mssql: 1433, postgres: 5432, mysql: 3306 }
/** Reached over HTTPS at an address of their own, so they have no host, port or encryption boxes. */
const isCloud = (dialect: Dialect) => dialect === 'snowflake' || dialect === 'databricks'

type Security = 'encrypt' | 'trustServerCertificate'
// What a server of each type accepts out of the box. SQL Server encrypts by default; a plain Postgres or
// MySQL has no SSL at all, and a connection that asks for it is refused.
const DEFAULT_SECURITY: Record<Dialect, Record<Security, boolean>> = {
  mssql: { encrypt: true, trustServerCertificate: false },
  postgres: { encrypt: false, trustServerCertificate: false },
  mysql: { encrypt: false, trustServerCertificate: false },
  sqlite: { encrypt: false, trustServerCertificate: false },
  snowflake: { encrypt: true, trustServerCertificate: false },
  databricks: { encrypt: true, trustServerCertificate: false },
}
const ENCRYPT = 'Encrypt the connection'
const TRUST = 'Trust the server certificate'

const blank = (): ConnectionInput => ({ id: uid(), name: '', dialect: 'mssql', host: '127.0.0.1', readOnly: true, ...DEFAULT_SECURITY.mssql, savePassword: false })

/** For a failure that one of the two security boxes would fix, says which box. The databases' own messages do not. */
function securityHint(message: string, form: ConnectionInput): string | undefined {
  if (form.dialect === 'sqlite' || isCloud(form.dialect)) return undefined
  const text = message.toLowerCase()
  if (form.encrypt) {
    if (/does not support (ssl|tls|secure)|ssl is not enabled|ssl connection is not supported/.test(text)) return `Untick "${ENCRYPT}": this server does not offer encryption.`
    if (!form.trustServerCertificate && /self[- ]signed|certificate|altnames/.test(text)) return `Tick "${TRUST}": the server's certificate is not one this machine can verify, which is usual for a local or test server.`
  } else if (/insecure transport|no encryption|ssl off|requires? (ssl|encryption|a secure)|must use (ssl|encryption)/.test(text)) {
    return `Tick "${ENCRYPT}": this server only accepts encrypted connections.`
  }
  return undefined
}

type Status = { kind: 'idle' | 'busy' | 'ok' } & { text?: string } | { kind: 'error'; text: string; hint?: string; saved?: boolean }

/** Add, edit, test and remove database connections. */
export function ConnectionsDialog() {
  const connections = useStore((s) => s.connections)
  const activeId = useStore((s) => s.activeConnectionId)
  const first = connections.find((c) => c.id === activeId && !c.builtin)
  const [form, setForm] = useState<ConnectionInput>(first ?? blank())
  const [pasted, setPasted] = useState('')
  const [filled, setFilled] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  // Connections whose last test in this dialog failed: they are saved, and say so in the list until a test passes.
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  // The security boxes the person set themselves, which a change of type must leave alone.
  const touched = useRef(new Set<Security>())
  // The name this dialog filled in from a connection string, so a longer string can replace it but typing is kept.
  const autoName = useRef('')
  const existing = connections.find((c) => c.id === form.id)
  const patch = (change: Partial<ConnectionInput>) => { setForm((f) => ({ ...f, ...change })); setStatus({ kind: 'idle' }) }
  const select = (c: ConnectionInfo | null) => {
    setForm(c ? { ...c } : blank())
    setPasted('')
    setFilled(false)
    setStatus({ kind: 'idle' })
    touched.current = new Set()
    autoName.current = ''
  }
  const isFile = form.dialect === 'sqlite'
  const held = existing?.hasPassword ?? false

  /** The type's defaults for the boxes nobody has set by hand. Only for a connection that is not saved yet. */
  const untouchedDefaults = (dialect: Dialect): Partial<ConnectionInput> => {
    if (existing || dialect === form.dialect) return {}
    return Object.fromEntries(Object.entries(DEFAULT_SECURITY[dialect]).filter(([key]) => !touched.current.has(key as Security)))
  }
  const setSecurity = (key: Security, value: boolean) => { touched.current.add(key); patch({ [key]: value }) }

  /** Fills the fields from a connection string. Returns false when the text is not one. */
  const fill = (text: string) => {
    const parsed = parseConnectionString(text)
    if (!parsed) return false
    const fields: Partial<ConnectionInput> = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined))
    // What the string says about encryption counts as the person's own choice.
    if (fields.encrypt !== undefined) touched.current.add('encrypt')
    if (fields.trustServerCertificate !== undefined) touched.current.add('trustServerCertificate')
    const name = fields.database ?? fields.host ?? ''
    const named = name && (!form.name.trim() || form.name === autoName.current)
    if (named) autoName.current = name
    patch({ ...untouchedDefaults(fields.dialect ?? form.dialect), ...fields, ...(named ? { name } : {}) })
    return true
  }

  const onPasteField = (text: string, inputType: string | undefined) => {
    // A paste or a drop (or, where the browser does not say, several characters at once). The string usually
    // holds a password, so it is not left on screen once its parts are in the fields. Text typed by hand
    // stays until the field is left.
    const pastedIn = inputType?.startsWith('insertFrom') || text.length - pasted.length > 1
    const read = fill(text)
    setPasted(read && pastedIn ? '' : text)
    setFilled(read && pastedIn)
  }
  const clearPasteField = () => {
    if (pasted && parseConnectionString(pasted)) { setPasted(''); setFilled(true) }
  }

  const save = async (andUse: boolean) => {
    if (!form.name.trim()) { setStatus({ kind: 'error', text: 'Give the connection a name.' }); return }
    setPasted('')
    setStatus({ kind: 'busy' })
    try {
      await api.saveConnection({ ...form, name: form.name.trim(), port: form.port || undefined })
      await useStore.getState().refreshConnections()
    } catch (err) {
      setStatus({ kind: 'error', text: `Not saved: ${(err as Error).message}` })
      return
    }
    // Saved from here on. A failed test leaves the entry in place with what was typed, and says so.
    try {
      const { ms } = await api.testConnection(form.id)
      setForm((f) => ({ ...f, password: undefined }))
      setFailed((f) => ({ ...f, [form.id]: false }))
      setStatus({ kind: 'ok', text: `Saved. Connected in ${ms} ms.` })
      if (andUse) {
        useStore.getState().setConnection(form.id)
        void useStore.getState().loadSchema(form.id, true)
        close()
      }
    } catch (err) {
      const text = (err as Error).message
      setFailed((f) => ({ ...f, [form.id]: true }))
      setStatus({ kind: 'error', text, hint: securityHint(text, form), saved: true })
    }
  }

  const remove = () => useStore.getState().setDialog({
    kind: 'confirm', danger: true, action: 'Remove', title: `Remove connection "${form.name}"?`,
    body: 'Its saved details and password are deleted from this machine. The database itself is not touched.',
    onConfirm: async () => {
      await api.deleteConnection(form.id)
      if (useStore.getState().activeConnectionId === form.id) useStore.getState().setConnection('demo')
      await useStore.getState().refreshConnections()
    },
  })

  const colours: (ConnectionColor | undefined)[] = [undefined, ...CONNECTION_COLORS]

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent title="Connections" description="Details stay on this machine. Quarry talks to your database from a local server, never from the cloud." className="w-[760px]">
        <div className="flex min-h-0 flex-1 flex-wrap md:flex-nowrap">
          <div className="flex w-full shrink-0 flex-col gap-px border-r border-line-soft bg-panel p-2 md:w-[210px]">
            {connections.map((c) => (
              <button key={c.id} disabled={c.builtin} onClick={() => select(c)}
                      className={cn('flex min-h-9 flex-col rounded-md px-2 py-1 text-left text-[12.5px] enabled:hover:bg-mint-hover/40', c.id === form.id && 'bg-mint font-medium text-brand')}>
                <span className="flex min-w-0 items-center gap-1.5"><ConnectionDot color={c.color} /><span className="truncate">{c.name}</span></span>
                {failed[c.id]
                  ? <span className="text-[11px] font-medium text-red-800">Saved, not working yet</span>
                  : <span className="text-[11px] font-normal text-ink-mute">{c.builtin ? 'Built-in demo' : DIALECT_LABEL[c.dialect]}</span>}
              </button>
            ))}
            <Button variant="ghost" size="xs" className="mt-1 justify-start text-accent-deep" onClick={() => select(null)}><Plus className="size-3.5" />New connection</Button>
          </div>

          <DialogBody className="flex-1">
            {!existing && !isFile && (
              <Field label="Paste a connection string" hint={filled ? 'read into the fields below, then cleared so its password is not left on screen' : 'optional, fills in the fields below'}>
                <Input value={pasted} onChange={(e) => onPasteField(e.target.value, (e.nativeEvent as InputEvent).inputType)} onBlur={clearPasteField} autoComplete="off" spellCheck={false}
                       placeholder="Server=127.0.0.1,1433;Database=…  or  postgres://user@host/db  or  snowflake://…  or  jdbc:databricks://…" className="font-mono text-[12px]" />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="rldi dev" /></Field>
              <Field label="Type">
                <Select value={form.dialect} onChange={(e) => {
                  const dialect = e.target.value as Dialect
                  // The local address a new connection starts with means nothing to a cloud service.
                  // Nor does a password typed for one kind of database belong in another's token or passphrase box.
                  patch({ ...untouchedDefaults(dialect), dialect, port: undefined, password: undefined, ...(isCloud(dialect) && form.host === '127.0.0.1' ? { host: '' } : {}) })
                }}>
                  {(Object.keys(DIALECT_LABEL) as Dialect[]).map((d) => <option key={d} value={d}>{DIALECT_LABEL[d]}</option>)}
                </Select>
              </Field>
            </div>
            {isFile ? (
              <Field label="Database file" hint="full path; loaded as a snapshot, the file is never written to">
                <Input value={form.file ?? ''} onChange={(e) => patch({ file: e.target.value })} placeholder="C:\data\app.db" className="font-mono text-[12px]" />
              </Field>
            ) : form.dialect === 'snowflake' ? (
              <SnowflakeFields form={form} patch={patch} held={held} />
            ) : form.dialect === 'databricks' ? (
              <DatabricksFields form={form} patch={patch} held={held} />
            ) : (
              <>
                <div className="grid grid-cols-[1fr_110px] gap-3">
                  <Field label="Host"><Input value={form.host ?? ''} onChange={(e) => patch({ host: e.target.value })} /></Field>
                  <Field label="Port"><Input inputMode="numeric" value={form.port ?? ''} placeholder={String(DEFAULT_PORT[form.dialect] ?? '')} onChange={(e) => patch({ port: Number(e.target.value) || undefined })} /></Field>
                </div>
                <Field label="Database"><Input value={form.database ?? ''} onChange={(e) => patch({ database: e.target.value })} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="User"><Input value={form.user ?? ''} autoComplete="off" onChange={(e) => patch({ user: e.target.value })} /></Field>
                  <Field label="Password" hint={existing?.hasPassword ? 'held, leave blank to keep' : undefined}>
                    <Input type="password" autoComplete="new-password" value={form.password ?? ''} onChange={(e) => patch({ password: e.target.value || undefined })} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                  <label className="flex min-h-7 items-center gap-2"><input type="checkbox" className="accent-brand" checked={form.encrypt ?? false} onChange={(e) => setSecurity('encrypt', e.target.checked)} />{ENCRYPT}</label>
                  <label className="flex min-h-7 items-center gap-2"><input type="checkbox" className="accent-brand" checked={form.trustServerCertificate ?? false} onChange={(e) => setSecurity('trustServerCertificate', e.target.checked)} />{TRUST}</label>
                </div>
              </>
            )}
            <div className="flex flex-col gap-1 text-[12px]">
              <div id="connection-colour-label" className="font-medium text-ink">Colour<span className="ml-1.5 font-normal text-ink-mute">marks a database that needs care, such as production: its tabs and Run button are painted in it</span></div>
              <div role="radiogroup" aria-labelledby="connection-colour-label" className="flex flex-wrap gap-1.5">
                {colours.map((color) => (
                  <label key={color ?? 'none'}>
                    <input type="radio" name="connection-colour" className="peer sr-only" checked={form.color === color} onChange={() => patch({ color })} />
                    <span className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white px-2 text-ink peer-checked:border-brand peer-checked:bg-mint/40 peer-checked:font-semibold peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-brand">
                      {color && <span aria-hidden className={cn('size-2.5 rounded-full', CONNECTION_COLOR[color].fill)} />}
                      {color ? CONNECTION_COLOR[color].label : 'None'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 rounded-lg border border-line-soft bg-panel p-3 text-[12.5px]">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 accent-brand" checked={form.readOnly} onChange={(e) => patch({ readOnly: e.target.checked })} />
                <span><span className="font-medium">Read-only</span> <span className="text-ink-mute">Refuses anything that is not a SELECT. A guard against slips, not a substitute for a login with read-only rights.{isCloud(form.dialect) && ' Here the guard is all there is: Quarry cannot also put the session itself in read-only mode, as it does elsewhere.'}</span></span>
              </label>
              {!isFile && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5 accent-brand" checked={form.savePassword ?? false} onChange={(e) => patch({ savePassword: e.target.checked })} />
                  <span><span className="font-medium">{isCloud(form.dialect) ? 'Remember the password or token' : 'Remember the password'}</span> <span className="text-ink-mute">Stores it encrypted in your user folder (.quarry). Off: it is kept in memory and asked for again after a restart.</span></span>
                </label>
              )}
            </div>
            {status.kind === 'error' && (
              <div role="alert" className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 p-2.5 text-[12.5px] text-red-800">
                <span>{status.text}</span>
                {status.hint && <span className="font-semibold">{status.hint}</span>}
                {status.saved && <span>This connection is saved, but it does not work yet. Change the settings and test again, or remove it.</span>}
              </div>
            )}
            {status.kind !== 'error' && existing && failed[existing.id] && (
              <div className="text-[12.5px] text-red-800">This connection is saved, but its last test failed. Test it again after changing the settings.</div>
            )}
            {status.kind === 'ok' && <div className="flex items-center gap-2 text-[12.5px] text-emerald-800"><CheckCircle2 className="size-4" />{status.text}</div>}
          </DialogBody>
        </div>
        <DialogFooter>
          {existing && <Button variant="ghost" size="sm" className="mr-auto text-red-700" onClick={remove}><Trash2 className="size-3.5" />Remove</Button>}
          <Button variant="outline" size="sm" disabled={status.kind === 'busy'} onClick={() => void save(false)}>
            {status.kind === 'busy' && <Loader2 className="size-3.5 animate-spin" />}Save and test
          </Button>
          <Button size="sm" disabled={status.kind === 'busy'} onClick={() => void save(true)}>Save and connect</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
