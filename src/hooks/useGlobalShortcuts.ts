import { useEffect } from 'react'
import { editorBridge } from '@/components/editor/editorBridge'
import { useStore } from '@/store'

/**
 * App-wide keys.
 *   Ctrl+K search, Ctrl+I Ask, Alt+N new tab: anywhere.
 *   Ctrl+Enter run the active tab: in the editor view, when focus is outside the editor.
 *   Alt+W close the tab, Alt+1..8 jump to a tab, Alt+9 the last tab, Alt+PageDown / Alt+PageUp next and
 *   previous tab: in the editor view, with no dialog open.
 * The tab keys use Alt because a web page is never given Ctrl+W, Ctrl+Tab or Ctrl+1..9; the browser keeps
 * those for its own tabs. None of the Alt keys here has a meaning in Chrome or Edge on Windows.
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const { set, paletteOpen, askOpen, newTab, view, dialog, tabs, activeTabId, activateTab, closeTab, closeTabs, runTab } = useStore.getState()
      // AltGr arrives as Ctrl+Alt and types characters (AltGr+2 is @ on many layouts), so the Alt keys want Alt alone.
      const alt = event.altKey && !mod && !event.shiftKey
      // The tab bar is only on screen in the editor view, and a dialog or the palette owns the keyboard while open.
      const editing = view === 'editor' && !dialog && !paletteOpen

      if (mod && key === 'k') {
        event.preventDefault()
        set({ paletteOpen: !paletteOpen })
      } else if (mod && key === 'i') {
        event.preventDefault()
        set({ askOpen: !askOpen })
      } else if (event.altKey && event.shiftKey && !mod && key === 'w' && editing) {
        event.preventDefault()
        // Asks once if any tab holds unsaved work.
        closeTabs(tabs.map((t) => t.id))
      } else if (alt && key === 'n') {
        event.preventDefault()
        newTab()
        set({ view: 'editor' })
      } else if (mod && key === 'enter' && !event.shiftKey && !event.altKey) {
        const target = event.target instanceof Element ? event.target : null
        // The editor has its own run key (and has already handled this event); a multi-line box keeps Enter for itself.
        const elsewhere = target?.closest('.cm-editor, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]')
        if (!editing || event.defaultPrevented || event.repeat || elsewhere) return
        event.preventDefault()
        void runTab(activeTabId, editorBridge.current?.runTarget())
      } else if (alt && editing) {
        const index = tabs.findIndex((t) => t.id === activeTabId)
        // Digits are read by position on the keyboard, so they work on layouts where the top row needs Shift.
        const digit = /^Digit([1-9])$/.exec(event.code)?.[1]
        const step = event.key === 'PageDown' ? 1 : event.key === 'PageUp' ? -1 : 0
        if (key === 'w') {
          event.preventDefault()
          // Through closeTab, so a tab with unsaved work still asks first.
          closeTab(activeTabId)
        } else if (digit) {
          event.preventDefault()
          const tab = digit === '9' ? tabs[tabs.length - 1] : tabs[Number(digit) - 1]
          if (tab && tab.id !== activeTabId) activateTab(tab.id)
        } else if (step && index !== -1) {
          event.preventDefault()
          if (tabs.length > 1) activateTab(tabs[(index + step + tabs.length) % tabs.length].id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
