import type { ConnectionInput } from '@shared/types'
import { Field, Input } from '@/ui/input'

interface Props {
  form: ConnectionInput
  patch: (change: Partial<ConnectionInput>) => void
  /** A token is already held for this connection. */
  held: boolean
}

/** The fields of a Databricks connection: the workspace, the SQL warehouse that runs queries, and a token. */
export function DatabricksFields({ form, patch, held }: Props) {
  return (
    <>
      <Field label="Workspace host" hint="the workspace's web address, without https://">
        <Input value={form.host ?? ''} onChange={(e) => patch({ host: e.target.value })} placeholder="adb-1234567890123456.7.azuredatabricks.net" spellCheck={false} />
      </Field>
      <Field label="Warehouse HTTP path" hint='from the SQL warehouse, under "Connection details"'>
        <Input value={form.httpPath ?? ''} onChange={(e) => patch({ httpPath: e.target.value })} placeholder="/sql/1.0/warehouses/abc123def456" className="font-mono text-[12px]" spellCheck={false} />
      </Field>
      <Field label="Personal access token" hint={held ? 'held, leave blank to keep' : undefined}>
        <Input type="password" autoComplete="new-password" value={form.password ?? ''} onChange={(e) => patch({ password: e.target.value || undefined })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Catalog" hint="its tables are listed; blank for the default"><Input value={form.database ?? ''} onChange={(e) => patch({ database: e.target.value })} spellCheck={false} /></Field>
        <Field label="Schema" hint="optional; its tables need no prefix"><Input value={form.schema ?? ''} onChange={(e) => patch({ schema: e.target.value })} spellCheck={false} /></Field>
      </div>
    </>
  )
}
