import { z } from 'zod'

import { MAX_ANGLES, angleSchema, pointSchema } from '../review/angles.ts'
import { DEFAULT_REVIEW_SETTINGS, reviewSettingsSchema } from '../rev/shape.ts'
import { boardSchema } from './board.ts'

export { ANGLE_ID, KNOWN_ANGLES, MAX_ANGLES, MAX_ANGLE_ID, MAX_BRIEF, MIN_ANGLES, angleSchema, pointSchema, type Angle, type Point } from '../review/angles.ts'

/**
 * One job of the factory, as `<project>/.kehikot/factory/jobs/<job-id>/job.json` holds it.
 *
 * A job is one feature taken from a sentence to a merge (or to a person): the spec, the plan of
 * angles, the build in its own worktree, rounds of review → counter-argument → judgement, and the
 * judge's last ruling. Every markdown file the agents write sits beside this file; this file is the
 * state, and only `flow.ts` decides how it changes.
 */

export const JOB_VERSION = 1

/** Where a job is. The board draws one column per stage, `counter` inside the Review column. */
export const STAGES = ['spec', 'plan', 'build', 'review', 'counter', 'judge', 'waiting', 'merged', 'failed'] as const
export type Stage = (typeof STAGES)[number]

/** The stages a conversation is driving: something is being written right now, or about to be. */
export const RUNNING: readonly Stage[] = ['spec', 'plan', 'build', 'review', 'counter', 'judge']
/** The stages a job never leaves by itself. */
export const SETTLED: readonly Stage[] = ['merged', 'failed']

/**
 * How many times the builder is sent back by the judge before the job goes to the person instead.
 * The first build is round 1; resumed twice, the last automatic build is round 3.
 */
export const MAX_RESUMES = 2
export const LAST_AUTOMATIC_ROUND = 1 + MAX_RESUMES


/** A job's id: the feature in a few words, then four hex digits. Also a branch and folder name. */
export const JOB_ID = /^[a-z0-9][a-z0-9-]{0,46}-[0-9a-f]{4}$/



/** Where the job was started, from the Claude module's record of the conversation. Absent: unplaced. */
export const jobPlaceSchema = z.object({
  epic: z.string().optional(),
  parts: z.array(z.string()).optional(),
  kehikko: z.string().optional(),
})
export type JobPlace = z.infer<typeof jobPlaceSchema>

export const WAITING_WHY = ['judge-approved', 'judge-hand-over', 'still-required', 'merge-refused', 'sent-back'] as const
export type WaitingWhy = (typeof WAITING_WHY)[number]

export const jobSchema = z.object({
  version: z.literal(JOB_VERSION),
  id: z.string().regex(JOB_ID),
  /** A short name for the card and the Inbox. */
  title: z.string().min(1).max(120),
  /** What the person asked for, in their words. */
  feature: z.string().min(1).max(4000),
  createdAt: z.string(),
  updatedAt: z.string(),
  stage: z.enum(STAGES),
  /** 0 before the first build, then the build/review round the job is in. */
  round: z.number().int().min(0),
  angles: z.array(angleSchema).max(MAX_ANGLES),
  /** The angles the person named with --angles, which the planner keeps to. */
  anglesAsked: z.array(z.string()).nullable(),
  place: jobPlaceSchema.nullable(),
  /** The Claude Code conversation driving the job now, or null when none is. */
  session: z.string().nullable(),
  git: z
    .object({
      /** The project's main branch, which a merge goes to. */
      main: z.string(),
      /** Main's commit when the worktree was made. */
      base: z.string(),
      branch: z.string(),
      worktree: z.string(),
      /** Whether the worktree is still on disk (false once removed after a merge). */
      present: z.boolean(),
    })
    .nullable(),
  /** The points the judge last ruled required: what the next build has to address. */
  required: z.array(pointSchema),
  /** The person's note for the next build (a rework), or null. */
  note: z.string().max(4000).nullable(),
  /** The judge's last ruling. */
  ruling: z.enum(['merge', 'hand-over', 'changes']).nullable(),
  waiting: z.object({ why: z.enum(WAITING_WHY), said: z.string() }).nullable(),
  merge: z
    .object({ at: z.string(), commit: z.string(), by: z.enum(['person', 'judge']), cleaned: z.boolean(), left: z.string().nullable() })
    .nullable(),
  failed: z.string().nullable(),
  archived: z.boolean(),
  /** The job's issue, `owner/repo#12` (or `group/project#12` on GitLab), or null: board-only. */
  ref: z.string().max(300).nullable().default(null),
  /** The column of the project's board the issue was last moved to, by name, or null. */
  column: z.string().max(200).nullable().default(null),
  /** The column a move to failed for, so it is not asked again until the stage maps elsewhere. */
  moveFailed: z.string().max(200).nullable().default(null),
  history: z.array(z.object({ at: z.string(), stage: z.enum(STAGES), round: z.number().int(), said: z.string() })).max(200),
})
export type Job = z.infer<typeof jobSchema>

/** The settings the person keeps per project, in `.kehikot/factory/settings.json`. */
export const settingsSchema = z.object({
  /** "Let the judge merge approved jobs by itself". Off unless the person turned it on. */
  judgeMerges: z.boolean().default(false),
  /** Where each stage sits on the project's own board; null until the person maps it. */
  board: boardSchema.nullable().default(null),
  /** `/review-factory`'s switches and rules for this project (rev/shape.ts). Off until the person turns them on. */
  review: reviewSettingsSchema.default({}),
})
export type Settings = z.infer<typeof settingsSchema>
export const DEFAULT_SETTINGS: Settings = { judgeMerges: false, board: null, review: DEFAULT_REVIEW_SETTINGS }

/** One line of the queue the person keeps in the board. */
export const queueItemSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().min(1).max(2000),
  epic: z.string().nullable().default(null),
  parts: z.array(z.string()).default([]),
})
export type QueueItem = z.infer<typeof queueItemSchema>

