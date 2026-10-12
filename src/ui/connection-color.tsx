import type { ConnectionColor } from '@shared/types'
import { cn } from '@/lib/utils'

/**
 * The one place a connection's colour becomes classes, so the tabs, the Run button and the dots
 * cannot drift apart. The class names are written out in full because Tailwind only finds whole names.
 * Colour is never the only cue: wherever these are used the connection's name is shown beside them.
 */
export const CONNECTION_COLOR: Record<ConnectionColor, { label: string; fill: string; tint: string; button: string }> = {
  red: { label: 'Red', fill: 'bg-conn-red', tint: 'bg-conn-red/15', button: 'bg-conn-red text-white hover:bg-conn-red/90' },
  amber: { label: 'Amber', fill: 'bg-conn-amber', tint: 'bg-conn-amber/15', button: 'bg-conn-amber text-white hover:bg-conn-amber/90' },
  green: { label: 'Green', fill: 'bg-conn-green', tint: 'bg-conn-green/15', button: 'bg-conn-green text-white hover:bg-conn-green/90' },
  blue: { label: 'Blue', fill: 'bg-conn-blue', tint: 'bg-conn-blue/15', button: 'bg-conn-blue text-white hover:bg-conn-blue/90' },
  violet: { label: 'Violet', fill: 'bg-conn-violet', tint: 'bg-conn-violet/15', button: 'bg-conn-violet text-white hover:bg-conn-violet/90' },
}

/** The classes for a colour, or undefined for a connection that has none. */
export const connectionPaint = (color: ConnectionColor | undefined) => (color ? CONNECTION_COLOR[color] : undefined)

/**
 * The dot beside a connection's name. With `reserve`, a connection without a colour still takes
 * up the space, so names in a list stay lined up.
 */
export function ConnectionDot({ color, reserve, className }: { color: ConnectionColor | undefined; reserve?: boolean; className?: string }) {
  if (!color) return reserve ? <span aria-hidden className={cn('size-2 shrink-0', className)} /> : null
  return <span role="img" aria-label={`Marked ${CONNECTION_COLOR[color].label.toLowerCase()}`} className={cn('size-2 shrink-0 rounded-full', CONNECTION_COLOR[color].fill, className)} />
}
