import type { Judged, Verdict } from '../review/parse.ts'
import { contested, ruleOn } from '../review/rules.ts'
import {
  JOB_VERSION,
  LAST_AUTOMATIC_ROUND,
  RUNNING,
  SETTLED,
  type Angle,
  type Job,
  type JobPlace,
  type Settings,
  type Stage,
  type WaitingWhy,
} from './shape.ts'

/**
 * How a job moves. Pure: an event and the job as it is, in; the job as it becomes (or a sentence
 * saying why not), out. The doors read what the agents wrote, run git, and call this; nothing else
 * changes a job's stage.
 *
 *   spec → plan → build(round 1) → review → [counter] → judge
 *     judge requires points, round < 3 → build(round + 1) with only the required points
 *     judge requires points, round = 3 → waiting (the person decides)
 *     judge requires nothing, says merge → waiting, or merge when the person turned the switch on
 *     judge requires nothing, says hand-over → waiting
 *   waiting → approve → merge → merged | waiting (refused, said why)
 *   waiting → rework(note) → build(round + 1)                     typed: /factory rework
 *   waiting → send back(note) → waiting(sent-back) → build        board, then /factory next
 *   any running stage → failed
 */

export type Event =
  | { kind: 'spec' }
  | { kind: 'plan'; angles: Angle[] }
  | { kind: 'worktree'; git: NonNullable<Job['git']> }
  | { kind: 'build' }
  | { kind: 'review'; verdicts: Record<string, Verdict> }
  | { kind: 'counter' }
  | { kind: 'judge'; judged: Judged }
  | { kind: 'approve'; by: 'person' }
  | { kind: 'merged'; commit: string; by: 'person' | 'judge'; cleaned: boolean; left: string | null }
  | { kind: 'merge-refused'; why: string }
  | { kind: 'rework'; note: string; now: boolean }
  | { kind: 'resume'; session: string }
  | { kind: 'angles'; angles: Angle[] }
  | { kind: 'fail'; why: string }
  | { kind: 'archive' }

/** What `advance` gives back: the job, and whether a merge should now be attempted (and by whom). */
export type Moved = { ok: true; job: Job; merge: 'person' | 'judge' | null } | { ok: false; why: string }

const HISTORY_MAX = 200

export function newJob(input: {
  id: string
  title: string
  feature: string
  anglesAsked: string[] | null
  place: JobPlace | null
  session: string
  now: string
  ref?: string | null
}): Job {
  return {
    version: JOB_VERSION,
    id: input.id,
    title: input.title,
    feature: input.feature,
    createdAt: input.now,
    updatedAt: input.now,
    stage: 'spec',
    round: 0,
    angles: [],
    anglesAsked: input.anglesAsked,
    place: input.place,
    session: input.session,
    git: null,
    required: [],
    note: null,
    ruling: null,
    waiting: null,
    merge: null,
    failed: null,
    archived: false,
    ref: input.ref ?? null,
    column: null,
    moveFailed: null,
    history: [{ at: input.now, stage: 'spec', round: 0, said: 'Started.' }],
  }
}

/** Is a conversation meant to be working on this job now? */
export const isRunning = (job: Job): boolean => RUNNING.includes(job.stage)

/** Can the angles still be changed? Until the first review starts. */
export const anglesOpen = (job: Job): boolean =>
  job.stage === 'spec' || job.stage === 'plan' || (job.stage === 'build' && job.round <= 1)

function moved(job: Job, now: string, stage: Stage, said: string, patch: Partial<Job> = {}): Job {
  const next: Job = { ...job, ...patch, stage, updatedAt: now }
  next.history = [...job.history, { at: now, stage, round: next.round, said }].slice(-HISTORY_MAX)
  return next
}

const wrongStage = (job: Job, wanted: string) =>
  ({ ok: false, why: `The job ${job.id} is at ${describeStage(job)}, not ${wanted}.` }) as const

function waitFor(job: Job, now: string, why: WaitingWhy, said: string, patch: Partial<Job> = {}): Job {
  return moved(job, now, 'waiting', said, { ...patch, waiting: { why, said }, session: null })
}

export function advance(job: Job, event: Event, settings: Settings, now: string): Moved {
  const done = (next: Job, merge: 'person' | 'judge' | null = null): Moved => ({ ok: true, job: next, merge })

  if (event.kind === 'archive') {
    if (!SETTLED.includes(job.stage)) return { ok: false, why: 'Only a merged or failed job can be cleared from the board.' }
    return done({ ...job, archived: true, updatedAt: now })
  }

  if (event.kind === 'fail') {
    if (SETTLED.includes(job.stage)) return { ok: false, why: `The job ${job.id} is already ${job.stage}.` }
    return done(moved(job, now, 'failed', `Failed: ${event.why}`, { failed: event.why, session: null }))
  }

  if (event.kind === 'angles') {
    if (!anglesOpen(job)) return { ok: false, why: 'The reviews have started; the angles of this job are settled.' }
    if (!event.angles.length) return { ok: false, why: 'A job keeps at least one angle.' }
    return done({ ...job, angles: event.angles, updatedAt: now })
  }

  switch (event.kind) {
    case 'spec':
      if (job.stage !== 'spec') return wrongStage(job, 'writing its spec')
      return done(moved(job, now, 'plan', 'Spec written.'))

    case 'plan': {
      if (job.stage !== 'plan') return wrongStage(job, 'planning')
      /* Angles the person set in the board while the planner worked are theirs, and win. */
      const angles = job.angles.some((one) => one.by === 'person') ? job.angles : event.angles
      return done(moved(job, now, 'build', `Planned ${angles.length} angle${angles.length === 1 ? '' : 's'}: ${angles.map((one) => one.id).join(', ')}.`, { angles, round: 1 }))
    }

    case 'worktree':
      if (job.stage !== 'build') return wrongStage(job, 'about to build')
      return done({ ...job, git: event.git, updatedAt: now })

    case 'build':
      if (job.stage !== 'build') return wrongStage(job, 'building')
      return done(moved(job, now, 'review', `Built round ${job.round}.`, { note: null }))

    case 'review': {
      if (job.stage !== 'review') return wrongStage(job, 'in review')
      const missing = job.angles.filter((one) => !(one.id in event.verdicts))
      if (missing.length) return { ok: false, why: `No review for: ${missing.map((one) => one.id).join(', ')}.` }
      const changes = contested(event.verdicts)
      if (!changes.length) return done(moved(job, now, 'judge', `Round ${job.round}: every reviewer approved.`))
      return done(moved(job, now, 'counter', `Round ${job.round}: changes asked from ${changes.join(', ')}.`))
    }

    case 'counter':
      if (job.stage !== 'counter') return wrongStage(job, 'in counter-argument')
      return done(moved(job, now, 'judge', `Round ${job.round}: counter-arguments written.`))

    case 'judge': {
      if (job.stage !== 'judge') return wrongStage(job, 'being judged')
      const ruling = event.judged.final
      const next = ruleOn(event.judged, job.round, LAST_AUTOMATIC_ROUND)
      const n = (count: number) => `${count} change${count === 1 ? '' : 's'}`
      if (next.kind === 'rework') {
        return done(
          moved(job, now, 'build', `Round ${job.round}: the judge requires ${n(next.required.length)}; back to the builder.`, {
            required: next.required,
            ruling,
            round: job.round + 1,
          }),
        )
      }
      if (next.kind === 'decide') {
        return done(
          waitFor(
            job,
            now,
            'still-required',
            `After ${job.round} rounds the judge still requires ${n(next.required.length)}. The builder has been sent back ${job.round - 1} times, the most it is; it is yours to decide.`,
            { required: next.required, ruling },
          ),
        )
      }
      if (next.kind === 'hand-over') {
        return done(waitFor(job, now, 'judge-hand-over', 'The judge requires nothing more, and hands the merge to you.', { required: [], ruling }))
      }
      if (settings.judgeMerges) return done({ ...job, required: [], ruling, updatedAt: now }, 'judge')
      return done(
        waitFor(job, now, 'judge-approved', 'The judge approves. Merging is yours: the switch that lets the judge merge is off.', { required: [], ruling }),
      )
    }

    case 'approve':
      if (job.stage !== 'waiting') return wrongStage(job, 'waiting for you')
      if (job.waiting?.why === 'sent-back') return { ok: false, why: 'This job was sent back with a note; it is waiting for /factory next, not for a merge.' }
      return done(job, 'person')

    case 'merged':
      if (job.stage !== 'waiting' && job.stage !== 'judge') return wrongStage(job, 'ready to merge')
      return done(
        moved(job, now, 'merged', event.by === 'judge' ? 'Merged by the judge.' : 'Merged by you.', {
          merge: { at: now, commit: event.commit, by: event.by, cleaned: event.cleaned, left: event.left },
          waiting: null,
          session: null,
          git: job.git ? { ...job.git, present: !event.cleaned } : null,
        }),
      )

    case 'merge-refused':
      if (job.stage !== 'waiting' && job.stage !== 'judge') return wrongStage(job, 'ready to merge')
      return done(waitFor(job, now, 'merge-refused', `Not merged: ${event.why}`))

    case 'rework': {
      if (job.stage !== 'waiting' && job.stage !== 'failed') return wrongStage(job, 'waiting for you')
      if (!job.git) return { ok: false, why: 'This job never got as far as a build, so there is nothing to send back.' }
      const note = event.note.trim()
      if (!note) return { ok: false, why: 'Say what to change: the note is what the builder reads.' }
      if (!event.now) return done(waitFor(job, now, 'sent-back', `Sent back with a note. Type /factory next in a Claude Code conversation in this project to build it.`, { note, failed: null }))
      return done(moved(job, now, 'build', `Sent back by you: ${note}`, { note, round: job.round + 1, waiting: null, failed: null }))
    }

    case 'resume':
      if (job.stage !== 'waiting' || job.waiting?.why !== 'sent-back') return { ok: false, why: 'Only a job sent back with a note is picked up by /factory next.' }
      return done(moved(job, now, 'build', 'Picked up to build what you asked.', { round: job.round + 1, waiting: null, session: event.session }))
  }
}

/** A stage in words, for a person: "review, round 2". */
export function describeStage(job: Pick<Job, 'stage' | 'round'>): string {
  switch (job.stage) {
    case 'spec':
      return 'the spec'
    case 'plan':
      return 'the plan'
    case 'build':
      return `the build, round ${job.round}`
    case 'review':
      return `review, round ${job.round}`
    case 'counter':
      return `counter-arguments, round ${job.round}`
    case 'judge':
      return `the judge, round ${job.round}`
    case 'waiting':
      return 'waiting for you'
    case 'merged':
      return 'merged'
    case 'failed':
      return 'failed'
  }
}
