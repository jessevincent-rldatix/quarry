import type { ConnectionInput, SnowflakeAuth } from '@shared/types'
import { Field, Input, Select } from '@/ui/input'

const AUTH_LABEL: Record<SnowflakeAuth, string> = {
  password: 'Password or access token',
  sso: 'Single sign-on in the browser',
  keypair: 'Key pair',
}

interface Props {
  form: ConnectionInput
  patch: (change: Partial<ConnectionInput>) => void
  /** A password, token or passphrase is already held for this connection. */
  held: boolean
}

/** The fields of a Snowflake connection: the account, how to sign in, and where queries run. */
export function SnowflakeFields({ form, patch, held }: Props) {
  const auth = form.auth ?? 'password'
  const keep = held ? 'held, leave blank to keep' : undefined
  return (
    <>
      <Field label="Account" hint="the part of the web address before .snowflakecomputing.com">
        <Input value={form.host ?? ''} onChange={(e) => patch({ host: e.target.value })} placeholder="myorg-myaccount" spellCheck={false} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="User"><Input value={form.user ?? ''} autoComplete="off" onChange={(e) => patch({ user: e.target.value })} /></Field>
        <Field label="Sign in with">
          <Select value={auth} onChange={(e) => patch({ auth: e.target.value as SnowflakeAuth })}>
            {(Object.keys(AUTH_LABEL) as SnowflakeAuth[]).map((a) => <option key={a} value={a}>{AUTH_LABEL[a]}</option>)}
          </Select>
        </Field>
      </div>
      {auth === 'password' && (
        <Field label="Password or access token" hint={keep}>
          <Input type="password" autoComplete="new-password" value={form.password ?? ''} onChange={(e) => patch({ password: e.target.value || undefined })} />
        </Field>
      )}
      {auth === 'sso' && (
        <p className="text-[12.5px] text-ink-mute">Testing or connecting opens your browser to sign in with your company login. Quarry waits for it, then keeps the session.</p>
      )}
      {auth === 'keypair' && (
        <div className="grid grid-cols-[1fr_180px] gap-3">
          <Field label="Private key file" hint="full path to the .p8 or .pem file">
            <Input value={form.keyFile ?? ''} onChange={(e) => patch({ keyFile: e.target.value })} placeholder="C:\keys\rsa_key.p8" className="font-mono text-[12px]" spellCheck={false} />
          </Field>
          <Field label="Passphrase" hint={keep ?? 'if the key has one'}>
            <Input type="password" autoComplete="new-password" value={form.password ?? ''} onChange={(e) => patch({ password: e.target.value || undefined })} />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Warehouse" hint="runs the queries"><Input value={form.warehouse ?? ''} onChange={(e) => patch({ warehouse: e.target.value })} spellCheck={false} /></Field>
        <Field label="Role" hint="blank for your default"><Input value={form.role ?? ''} onChange={(e) => patch({ role: e.target.value })} spellCheck={false} /></Field>
        <Field label="Database" hint="its tables are listed"><Input value={form.database ?? ''} onChange={(e) => patch({ database: e.target.value })} spellCheck={false} /></Field>
        <Field label="Schema" hint="optional; its tables need no prefix"><Input value={form.schema ?? ''} onChange={(e) => patch({ schema: e.target.value })} spellCheck={false} /></Field>
      </div>
    </>
  )
}
