import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/ui/dialog'
import { close } from './close'

/** Shows the SQL exactly as it will be sent, with the variables filled in. */
export function PreviewDialog({ sql, errors = [] }: { sql: string; errors?: string[] }) {
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent title="Final SQL" description="What is sent to the database once the variables are filled in." className="w-[640px]">
        <DialogBody>
          {errors.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-900">
              <p className="font-medium">This will not run yet. The variables below are still shown as written.</p>
              <ul className="mt-1 list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          <pre className="scrollbars-visible overflow-auto rounded-lg border border-line-soft bg-editor p-3 font-mono text-[12.5px] leading-5">{sql}</pre>
        </DialogBody>
        <DialogFooter><Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(sql)}>Copy</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
