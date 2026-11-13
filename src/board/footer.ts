import { LIMITS, footerItemsSchema, type FooterItem } from 'kehikot-module-protocol'

import type { Job } from '../../job/shape.ts'
import { COLUMNS, columnOf } from './columns.ts'
import { decisionItems } from './header.ts'

/**
 * What Build Pipeline puts in its container's footer (`kehikot.footer`, protocol 2.38.0): what the board
 * holds now, and the job selected on it, so a container folded to its header and footer still says
 * them. It is the line the page drew along its top (which board, which epic, how many wait for
 * you) and the notes under it (what an act said, what went wrong), in one row the host draws.
 *
 * Approve and merge, and Send back, act on the selected job, so they sit here beside it rather than
 * in the header; neither is pressable by an agent, as before. The header keeps the Board switch and
 * Settings.
 */
export interface FooterState {
  /** The board's line: `Jobs · greetings · 2 waiting for you`. */
  summary: string
  /** The job open on the Jobs board, or null. */
  open: Job | null
  busy: boolean
  said: string | null
  trouble: string | null
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

export function footerItems({ summary, open, busy, said, trouble }: FooterState): FooterItem[] {
  const items: unknown[] = [{ kind: 'text', id: 'summary', text: cut(summary, LIMITS.FOOTER_TEXT), tooltip: cut(summary, LIMITS.FOOTER_TOOLTIP) }]
  if (trouble) items.push({ kind: 'text', id: 'trouble', text: cut(trouble, LIMITS.FOOTER_TEXT), level: 'critical', tooltip: cut(trouble, LIMITS.FOOTER_TOOLTIP) })
  else if (said) items.push({ kind: 'text', id: 'said', text: cut(said, LIMITS.FOOTER_TEXT), optional: true, tooltip: cut(said, LIMITS.FOOTER_TOOLTIP) })
  if (open) {
    const column = COLUMNS.find((one) => one.id === columnOf(open.stage))?.label ?? open.stage
    items.push({
      kind: 'text',
      id: 'job',
      text: cut(`${open.title} · ${column}`, LIMITS.FOOTER_TEXT),
      align: 'end',
      level: open.stage === 'failed' ? 'critical' : open.stage === 'waiting' ? 'warn' : 'normal',
      tooltip: cut(`${open.title}: ${column}.${open.waiting?.said ? ` ${open.waiting.said}` : ''}`, LIMITS.FOOTER_TOOLTIP),
    })
    for (const item of decisionItems(open, busy)) items.push({ ...(item as object), align: 'end' })
  }
  return footerItemsSchema.parse(items)
}
