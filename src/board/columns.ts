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

/** The jobs a view shows: this epic's, or all of the project's; cleared ones never. */
export function inView<J extends Job>(jobs: readonly J[], view: 'epic' | 'all', epic: string | null): J[] {
  return jobs.filter((job) => !job.archived && (view === 'all' || (epic !== null && job.place?.epic === epic)))
}
