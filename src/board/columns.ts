import type { Anchors } from 'kehikot-module-protocol'

import type { Job, Stage } from '../../job/shape.ts'

/**
 * The board's columns, left to right, and which stages each holds. Counter-arguments are drawn in
 * the Judge column: they are written for the judge, after the reviews.
 */
export const COLUMNS = [
  { id: 'spec', label: 'Spec', stages: ['spec'] },
  { id: 'plan', label: 'Plan', stages: ['plan'] },
  { id: 'build', label: 'Build', stages: ['build'] },
  { id: 'review', label: 'Review', stages: ['review'] },
  { id: 'judge', label: 'Judge', stages: ['counter', 'judge'] },
  { id: 'waiting', label: 'Waiting for you', stages: ['waiting'] },
  { id: 'merged', label: 'Merged', stages: ['merged'] },
  { id: 'failed', label: 'Failed', stages: ['failed'] },
] as const satisfies readonly { id: string; label: string; stages: readonly Stage[] }[]

export type ColumnId = (typeof COLUMNS)[number]['id']

export function columnOf(stage: Stage): ColumnId {
  return COLUMNS.find((column) => (column.stages as readonly Stage[]).includes(stage))!.id
}

/** What a card says under its title: the stage in a few words. */
export function stageLine(job: Pick<Job, 'stage' | 'round' | 'waiting'>): string {
  switch (job.stage) {
    case 'build':
      return job.round > 1 ? `building, round ${job.round}` : 'building'
    case 'review':
      return `review round ${job.round}`
    case 'counter':
      return `counter-arguments, round ${job.round}`
    case 'judge':
      return `judging round ${job.round}`
    case 'waiting':
      return job.waiting?.why === 'sent-back' ? 'sent back: /factory next' : 'your decision'
    default:
      return job.stage
  }
}

/**
 * Which part(s) of the epic a job is about (`reacts: ['parts']`): the parts it was started on, or
 * the whole epic when it was started on the epic itself. A job started elsewhere has no anchor here.
 */
export function anchorOf(job: Job, epic: string | null): Anchors {
  if (!job.place?.epic || job.place.epic !== epic) return []
  if (job.place.parts?.length) return job.place.parts.map((part) => ({ part }))
  return [{ whole: true }]
}

/** What a view needs of a job or a review run: whether it is cleared, and where it was started. */
export interface Placed {
  archived?: boolean
  place?: { epic?: string; parts?: string[] } | null
}

/**
 * The jobs (or review runs) a view shows; cleared ones never.
 *
 *  - `all`: the whole project, ignoring the epic and the parts.
 *  - `epic`: this epic's. With parts picked, only those whose parts meet the picked ones; a job with
 *    no parts is about the whole epic and shows in every parts view. With none picked, all of the
 *    epic's.
 *
 * Which project is not decided here: the board is read per project path, so nothing of another
 * project is ever in `items`.
 */
export function inView<J extends Placed>(items: readonly J[], view: 'epic' | 'all', epic: string | null, picked: readonly string[] = []): J[] {
  return items.filter((item) => {
    if (item.archived) return false
    if (view === 'all') return true
    if (epic === null || item.place?.epic !== epic) return false
    const parts = item.place.parts ?? []
    return picked.length === 0 || parts.length === 0 || parts.some((part) => picked.includes(part))
  })
}

/**
 * Which items a board shows, given the host's scope (protocol 2.9.0): with "All epics" open in the
 * host (`scope: 'project'`) every board shows the whole project — every epic's items, and those
 * started on no epic — whatever its own View says; otherwise the View decides.
 */
export function boardView(view: 'epic' | 'all', scope: 'epic' | 'project' = 'epic'): 'epic' | 'all' {
  return scope === 'project' ? 'all' : view
}

/** A card's epic label, for a board showing more than one epic: the epic and its parts, or "no epic". */
export function placeLabel(place: { epic?: string; parts?: string[] } | null | undefined): string {
  if (!place?.epic) return 'no epic'
  return place.parts?.length ? `${place.epic} · ${place.parts.join(', ')}` : place.epic
}

/** "Methods, Results", or "all parts" when none is picked. */
export function partsWords(picked: readonly { id: string; heading?: string }[]): string {
  return picked.length ? picked.map((part) => part.heading || part.id).join(', ') : 'all parts'
}

/**
 * What a board says it shows: "Jobs on <epic> · Methods, Results", "All jobs", "Reviews on <epic> · all
 * parts", "Jobs on all epics" (the host's "All epics").
 */
export function scopeLine(
  noun: 'Jobs' | 'Reviews',
  view: 'epic' | 'all',
  epic: string | null,
  picked: readonly { id: string; heading?: string }[],
  scope: 'epic' | 'project' = 'epic',
): string {
  if (scope === 'project') return `${noun} on all epics`
  if (view === 'all') return `All ${noun.toLowerCase()}`
  return epic ? `${noun} on ${epic} · ${partsWords(picked)}` : 'No epic open'
}
