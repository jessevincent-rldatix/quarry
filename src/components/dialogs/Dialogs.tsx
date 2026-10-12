import { useStore } from '@/store'
import { AiSettingsDialog } from './AiSettingsDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { ConnectionsDialog } from './ConnectionsDialog'
import { PreviewDialog } from './PreviewDialog'
import { PromptDialog } from './PromptDialog'
import { QueryDialog } from './QueryDialog'
import { TemplateDialog } from './TemplateDialog'

/** Renders whichever dialog the store says is open. */
export function Dialogs() {
  const dialog = useStore((s) => s.dialog)
  if (!dialog) return null
  switch (dialog.kind) {
    case 'connections': return <ConnectionsDialog />
    case 'ai-settings': return <AiSettingsDialog />
    case 'save': return <QueryDialog key={dialog.tabId} tabId={dialog.tabId} />
    case 'details': return <QueryDialog key={dialog.queryId} queryId={dialog.queryId} />
    case 'template': return <TemplateDialog template={dialog.template} sql={dialog.sql} />
    case 'prompt': return <PromptDialog {...dialog} />
    case 'preview': return <PreviewDialog sql={dialog.sql} errors={dialog.errors} />
    case 'confirm': return <ConfirmDialog {...dialog} />
  }
}
