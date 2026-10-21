import { LIMITS, headerItemsSchema, type HeaderItem } from 'kehikot-module-protocol'

import type { Job } from '../../job/shape.ts'

/**
 * What Factory puts in its container's header, as a pure function of the page's state:
 *
 *  - **View**: this epic's jobs, all of the project's, or the Reviews board (`/review-factory`). An
 *    agent may switch it.
 *  - **Run**: "Approve and merge…" and "Send back with a note…", for the SELECTED job and only while
 *    it waits for the person. Neither is ever pressed by an agent: approving runs a merge, and the
 *    approve run asks to be confirmed (`confirm`), which the protocol refuses to mark for agents.
 *    Send back opens a note in the page; it is the person's words that go to the builder.
 *
 * Words are short so the host's menus fit at every width (it folds them to icons, then to one ⋯).
 */

export type View = 'epic' | 'all' | 'reviews'

const reason = (text: string) => (text.length > LIMITS.REASON ? `${text.slice(0, LIMITS.REASON - 1)}…` : text)

/** Why the selected job cannot be approved or sent back, or null when it can. */
export function decisionRefusal(job: Job | null): string | null {
  if (!job) return 'Select a job on the board first.'
  if (job.stage !== 'waiting') return 'Only a job waiting for you can be approved or sent back.'
  if (job.waiting?.why === 'sent-back') return 'This job was sent back; it is waiting for /factory next.'
  return null
}

export function headerItems(view: View, selected: Job | null, busy: boolean, epic: string | null, scope: 'epic' | 'project' = 'epic'): HeaderItem[] {
  const refused = decisionRefusal(selected)
  /* With the host on "All epics" the jobs board is the whole project either way: said, not hidden. */
  const thisEpic = scope === 'project' ? 'All epics (the host’s)' : epic ? 'This epic' : 'This epic (none open)'
  return headerItemsSchema.parse([
    {
      kind: 'switch',
      id: 'view',
      label: 'Jobs',
      options: [
        { id: 'epic', label: thisEpic },
        { id: 'all', label: 'All jobs' },
        { id: 'reviews', label: 'Reviews' },
      ],
      value: view,
      agents: true,
    },
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
  ])
}
