import { useState } from 'react'
import type { Dialect } from '@shared/types'
import { MY_TEMPLATES, type Template } from '@/lib/builtins'
import { parseVars } from '@/lib/template'
import { cn, uid } from '@/lib/utils'
import { useDialect, useStore } from '@/store'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/ui/dialog'
import { Field, Input, Pill, SectionLabel, Textarea } from '@/ui/input'
import { close } from './close'

type Version = 'default' | Dialect

const VERSIONS: { id: Version; label: string }[] = [
  { id: 'default', label: 'Any database' },
  { id: 'mssql', label: 'SQL Server' },
  { id: 'postgres', label: 'PostgreSQL' },
  { id: 'mysql', label: 'MySQL' },
  { id: 'sqlite', label: 'SQLite' },
  { id: 'snowflake', label: 'Snowflake' },
  { id: 'databricks', label: 'Databricks' },
]

const STARTER = 'SELECT *\nFROM {{table:ident}}\nWHERE {{column:ident}} = {{value}};'

/** Create or edit one of your own templates, with different SQL per database where it has to differ. */
export function TemplateDialog({ template, sql: initialSql }: { template?: Template; sql?: string }) {
  const dialect = useDialect()
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [versions, setVersions] = useState<Template['sql']>(template?.sql ?? { default: initialSql ?? STARTER })
  // Open on the version the current connection would use.
  const [version, setVersion] = useState<Version>(template?.sql[dialect] ? dialect : 'default')
  const sql = versions[version] ?? ''
  const vars = parseVars(sql, version === 'default' ? dialect : version)
  const written = Object.fromEntries(Object.entries(versions).filter(([, text]) => text?.trim())) as Template['sql']
  const valid = name.trim() !== '' && Object.keys(written).length > 0

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid) return
    useStore.getState().saveTemplate({ id: template?.id ?? uid(), name: name.trim(), description: description.trim(), category: MY_TEMPLATES, sql: written })
    useStore.getState().set({ view: 'templates' })
    close()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent title={template ? 'Edit template' : 'New template'} description="Write {{name}} wherever a value should be filled in later." className="w-[640px]">
        <form onSubmit={submit} className="contents">
          <DialogBody>
            <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Find rows by value" /></Field>
            <Field label="Description" hint="optional"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="SQL version">
                <SectionLabel className="mr-1">SQL for</SectionLabel>
                {VERSIONS.map((v) => (
                  <button key={v.id} type="button" role="tab" aria-selected={version === v.id} onClick={() => setVersion(v.id)}
                          className={cn('flex h-6 items-center gap-1 rounded-md px-2 text-[12px]', version === v.id ? 'bg-brand text-white' : 'text-ink hover:bg-black/[0.05]')}>
                    {v.label}
                    {written[v.id] && <span className={cn('size-1.5 rounded-full', version === v.id ? 'bg-white' : 'bg-accent')} />}
                  </button>
                ))}
              </div>
              <Textarea rows={9} spellCheck={false} aria-label="SQL" value={sql} onChange={(e) => setVersions({ ...versions, [version]: e.target.value })}
                        placeholder={version === 'default' ? 'Used on every database that has no version of its own.' : 'Leave empty to use the "Any database" version here.'} />
              <p className="text-[12px] text-ink-mute">
                {version === 'default'
                  ? 'This version runs everywhere unless a database has its own. A dot marks the versions that are written.'
                  : 'Only needed where the SQL differs, for example TOP on SQL Server and LIMIT elsewhere.'}
                {!written.default && ' With no "Any database" version, the template is offered only on the databases it is written for.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-mute">
              <SectionLabel>Variables</SectionLabel>
              {vars.length ? vars.map((v) => <Pill key={v.name} className="bg-var-bg text-var-ink">{v.name}: {v.type}</Pill>) : <span>none in this version</span>}
            </div>
            <p className="rounded-lg border border-line-soft bg-panel p-2.5 text-[12px] text-ink-mute">
              Add a type after a colon and a default after an equals sign: <code className="font-mono text-var-ink">{'{{limit:number=100}}'}</code>.
              Types: <b>text</b> (quoted for you, the default), <b>number</b>, <b>date</b>, <b>ident</b> (a table or column name), <b>list</b> (for IN), <b>raw</b> (inserted as typed).
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={close}>Cancel</Button>
            <Button size="sm" type="submit" disabled={!valid}>Save template</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
