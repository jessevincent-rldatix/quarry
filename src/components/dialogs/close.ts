import { useStore } from '@/store'

/** Closes whichever dialog is open. */
export const close = () => useStore.getState().setDialog(null)
