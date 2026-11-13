import { LIMITS, headerItemsSchema, type HeaderItem } from 'kehikot-module-protocol'

import type { Job } from '../../job/shape.ts'

/**
 * What Build Pipeline puts in its container's header, as a pure function of the page's state:
 *
 *  - **View**: the Jobs board or the Reviews board (`/review-factory`). An agent may switch it.
 *    Which epics a board shows is not here: it is the container's scope (protocol 2.29.0), the
 *    open epic or the whole project, which the person picks in Build Pipeline's settings in the host.
 *  - **Run**: "Approve and merge…" and "Send back with a note…", for the SELECTED job and only while
 *    it waits for the person. Neither is ever pressed by an agent: approving runs a merge, and the
 *    approve run asks to be confirmed (`confirm`), which the protocol refuses to mark for agents.
 *    Send back opens a note in the page; it is the person's words that go to the builder.
 *
 *  - **View**: Settings, the panel of the board's queue or review settings (a setting, so here
 *    rather than a button on the page).
 *
 * With a host that draws the footer (`footed`), Approve and Send back are not here: they act on the
 * selected job, and sit in the footer beside it (`footer.ts`). Never in both rows.
 *
 * Words are short so the host's menus fit at every width (it folds them to icons, then to one ⋯).
 */

/** `epic` is the Jobs board (its id from when it also meant "this epic"); `reviews` the Reviews board. */
export type View = 'epic' | 'reviews'

/** What an agent pressing the old "All jobs" is told: which epics show is the scope, the person's. */
export const SCOPE_IS_THE_PERSONS =
  'Which epics the board shows is its scope — the open epic or the whole project — and the person picks it in Build Pipeline’s settings.'

const reason = (text: string) => (text.length > LIMITS.REASON ? `${text.slice(0, LIMITS.REASON - 1)}…` : text)

/** Why the selected job cannot be approved or sent back, or null when it can. */
export function decisionRefusal(job: Job | null): string | null {
  if (!job) return 'Select a job on the board first.'
  if (job.stage !== 'waiting') return 'Only a job waiting for you can be approved or sent back.'
  if (job.waiting?.why === 'sent-back') return 'This job was sent back; it is waiting for /factory next.'
  return null
}

/** Approve and Send back for the selected job: the header's, or with a footer the footer's. */
export function decisionItems(selected: Job | null, busy: boolean): unknown[] {
  const refused = decisionRefusal(selected)
  return [
    {
      kind: 'run',
      id: 'approve',
      label: 'Approve and merge…',
      icon: 'check',
      confirm: true,
      state: busy ? 'busy' : 'idle',
      disabled: busy ? null : refused ? reason(refused) : null,
    },
    {
      kind: 'run',
      id: 'send-back',
      label: 'Send back with a note…',
      icon: 'undo',
      disabled: refused ? reason(refused) : null,
    },
  ]
}

export function headerItems(view: View, selected: Job | null, busy: boolean, { footed = false, settings = false }: { footed?: boolean; settings?: boolean } = {}): HeaderItem[] {
  return headerItemsSchema.parse([
    {
      kind: 'switch',
      id: 'view',
      label: 'Board',
      options: [
        { id: 'epic', label: 'Jobs' },
        { id: 'reviews', label: 'Reviews' },
      ],
      value: view,
      agents: true,
    },
    { kind: 'toggle', id: 'settings', label: 'Settings', checked: settings },
    ...(footed ? [] : decisionItems(selected, busy)),
  ])
}
