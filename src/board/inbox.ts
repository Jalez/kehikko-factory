import { LIMITS, activityItemsSchema, type ActivityItem } from 'kehikot-module-protocol'

import { isRunning } from '../../job/flow.ts'
import type { Job } from '../../job/shape.ts'

/**
 * What Factory reports to the host's Inbox (`activity.set`), as one whole list for the open project:
 *
 *  - a job waiting for the person: `attention`, labelled with the job, at its place;
 *  - a failed job: `attention` too, low priority, until it is cleared from the board;
 *  - a job a conversation is running: `working`;
 *  - a job merged in the last day: `done`, low priority.
 *
 * The id is the job's, so an item keeps its timeline across stages. A job with no place belongs to
 * the project. Labels and details are cut to the protocol's bounds, never refused for length.
 */

export const DONE_FOR_MS = 24 * 60 * 60 * 1000

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

function placeOf(job: Job): ActivityItem['place'] | undefined {
  if (!job.place?.epic) return undefined
  return {
    epic: job.place.epic,
    ...(job.place.parts?.length ? { parts: job.place.parts.slice(0, LIMITS.PLACE_PARTS) } : {}),
    ...(job.place.kehikko ? { kehikko: job.place.kehikko } : {}),
  }
}

function sinceOf(job: Job): number | undefined {
  const at = Date.parse(job.updatedAt)
  return Number.isFinite(at) && at >= 0 ? at : undefined
}

export function inboxItems(jobs: readonly Job[], now = Date.now()): ActivityItem[] {
  const items: ActivityItem[] = []
  for (const job of jobs) {
    if (job.archived) continue
    const base = { id: `job:${job.id}`.slice(0, LIMITS.ACTIVITY_ID), place: placeOf(job), since: sinceOf(job), group: 'factory' }
    if (job.stage === 'waiting') {
      items.push({
        ...base,
        state: 'attention',
        label: cut(job.waiting?.why === 'sent-back' ? `Sent back, to build: ${job.title}` : `Factory job waiting for you: ${job.title}`, LIMITS.ACTIVITY_LABEL),
        detail: cut(job.waiting?.said ?? 'Waiting for your decision.', LIMITS.ACTIVITY_DETAIL),
        priority: 'normal',
      })
    } else if (job.stage === 'failed') {
      items.push({
        ...base,
        state: 'attention',
        label: cut(`Factory job failed: ${job.title}`, LIMITS.ACTIVITY_LABEL),
        detail: cut(job.failed ?? 'It failed.', LIMITS.ACTIVITY_DETAIL),
        priority: 'low',
      })
    } else if (isRunning(job)) {
      items.push({ ...base, state: 'working', label: cut(`Factory: ${job.title}`, LIMITS.ACTIVITY_LABEL) })
    } else if (job.stage === 'merged' && (sinceOf(job) ?? 0) > now - DONE_FOR_MS) {
      items.push({ ...base, state: 'done', label: cut(`Merged: ${job.title}`, LIMITS.ACTIVITY_LABEL), priority: 'low' })
    }
  }
  const strip = items.map((item) => Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)) as ActivityItem)
  return activityItemsSchema.parse(strip.slice(0, LIMITS.ACTIVITY_ITEMS))
}
