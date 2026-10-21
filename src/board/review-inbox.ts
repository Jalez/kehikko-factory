import { LIMITS, type ActivityItem } from 'kehikot-module-protocol'

import type { Run } from '../../rev/shape.ts'
import { RUN_RUNNING } from '../../rev/shape.ts'

/**
 * What the Reviews board adds to Factory's Inbox list (the page sends ONE whole list: jobs and
 * reviews together, `inbox.ts` and this):
 *
 *  - a review waiting for you (the draft is in Review, its checklist proposal waits, it stopped or
 *    the change moved on): `attention`;
 *  - a re-review that is due and waits for `/review-factory resume`: `attention`, low;
 *  - the first-time question about an author: `attention`, with the recommended answer in the detail;
 *  - a review a conversation is running: `working`; sent in the last day: `done`, low.
 */

export const DONE_FOR_MS = 24 * 60 * 60 * 1000

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

function placeOf(run: Run): ActivityItem['place'] | undefined {
  if (!run.place?.epic) return undefined
  return { epic: run.place.epic, ...(run.place.parts?.length ? { parts: run.place.parts.slice(0, LIMITS.PLACE_PARTS) } : {}), ...(run.place.kehikko ? { kehikko: run.place.kehikko } : {}) }
}

const sinceOf = (at: string) => {
  const n = Date.parse(at)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function reviewInboxItems(runs: readonly Run[], questions: readonly { author: string; ref: string; text: string; recommended: string; askedAt: string }[], now = Date.now()): ActivityItem[] {
  const items: ActivityItem[] = []
  for (const run of runs) {
    if (run.archived) continue
    const base = { id: `review:${run.id}`.slice(0, LIMITS.ACTIVITY_ID), place: placeOf(run), since: sinceOf(run.updatedAt), group: 'factory-reviews' }
    const name = `${run.change.ref} ${run.change.title}`
    if (run.waiting) {
      const label =
        run.waiting.why === 'drafted' ? `Review ready, read it in Review: ${name}`
        : run.waiting.why === 'checklist' ? `Review waits for your checklist: ${name}`
        : run.waiting.why === 'moved-on' ? `Review stopped, the change moved on: ${name}`
        : `Review stopped: ${name}`
      items.push({ ...base, state: 'attention', label: cut(label, LIMITS.ACTIVITY_LABEL), detail: cut(run.waiting.said, LIMITS.ACTIVITY_DETAIL), priority: run.waiting.why === 'drafted' || run.waiting.why === 'checklist' ? 'normal' : 'low' })
    } else if (run.stage === 'queued' && !run.background) {
      items.push({ ...base, state: 'attention', label: cut(`Ready for re-review: ${name}`, LIMITS.ACTIVITY_LABEL), detail: cut(`Type /review-factory resume ${run.id} in a Claude Code conversation.`, LIMITS.ACTIVITY_DETAIL), priority: 'low' })
    } else if (RUN_RUNNING.includes(run.stage) || run.stage === 'queued') {
      items.push({ ...base, state: 'working', label: cut(`Reviewing ${name}`, LIMITS.ACTIVITY_LABEL) })
    } else if (run.stage === 'sent' && (sinceOf(run.updatedAt) ?? 0) > now - DONE_FOR_MS) {
      items.push({ ...base, state: 'done', label: cut(`Review sent: ${name}`, LIMITS.ACTIVITY_LABEL), priority: 'low' })
    }
  }
  for (const question of questions) {
    items.push({
      id: `review-author:${question.author}`.slice(0, LIMITS.ACTIVITY_ID),
      state: 'attention',
      label: cut(question.text, LIMITS.ACTIVITY_LABEL),
      detail: cut(`Recommended: ${question.recommended}. Answer on the Reviews board (${question.ref}).`, LIMITS.ACTIVITY_DETAIL),
      group: 'factory-reviews',
      priority: 'normal',
      ...(sinceOf(question.askedAt) ? { since: sinceOf(question.askedAt) } : {}),
    })
  }
  return items.map((item) => Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)) as ActivityItem)
}
