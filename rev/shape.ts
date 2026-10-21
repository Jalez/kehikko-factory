import { z } from 'zod'

import { evidenceSchema, panelPointSchema, PANEL_VERDICTS, RULINGS, type PanelPoint } from '../review/points.ts'
import { ANGLE_ID, MAX_ANGLE_ID } from '../review/angles.ts'

/**
 * One review run of `/review-factory`, as `<project>/.kehikot/factory/reviews/<id>/run.json` holds
 * it. Every other file in that folder is the record a person reads ("How this review was made");
 * this one is the state, and only `rev/flow.ts` decides how it changes.
 */

export const RUN_VERSION = 1

/** The Reviews board's columns, left to right: the run's stages. (Contract C5.) */
export const REVIEW_STAGES = ['queued', 'gathering', 'planning', 'reviewing', 'challenging', 'judging', 'diagrams', 'waiting', 'sent'] as const
export type ReviewStage = (typeof REVIEW_STAGES)[number]

/** The stages a conversation is driving. */
export const RUN_RUNNING: readonly ReviewStage[] = ['gathering', 'planning', 'reviewing', 'challenging', 'judging', 'diagrams']

/** At most this many rounds of review per change: the first, and two re-reviews. */
export const MAX_ROUNDS = 3

/** A run's id: the repository and number, then four hex digits. Also a folder and worktree name. */
export const RUN_ID = /^[a-z0-9][a-z0-9-]{0,46}-[0-9a-f]{4}$/

export const changeSchema = z.object({
  forge: z.enum(['github', 'gitlab']),
  host: z.string().max(200).optional(),
  repo: z.string().min(1).max(300),
  number: z.number().int().positive(),
  url: z.string().max(2000),
  /** The ref as the host spells it (`gh#7`, `!7`, `gh:owner/repo#7`): what Checklist holds lists against. */
  ref: z.string().max(300),
  title: z.string().max(300).default(''),
  author: z.object({ login: z.string().max(100), name: z.string().max(200).optional() }).nullable().default(null),
  labels: z.array(z.string().max(100)).max(50).default([]),
})
export type Change = z.infer<typeof changeSchema>

export const checkedPointSchema = panelPointSchema.extend({
  id: z.string().max(40),
  angles: z.array(z.string().max(MAX_ANGLE_ID)).max(4),
  also: z.array(z.object({ path: z.string(), side: z.enum(['new', 'old']), line: z.number().int(), startLine: z.number().int().optional() })).max(20),
})

export const runAngleSchema = z.object({
  id: z.string().regex(ANGLE_ID).max(MAX_ANGLE_ID),
  brief: z.string().min(1).max(1000),
  by: z.enum(['planner', 'person']),
  practices: z.array(z.object({ name: z.string(), source: z.string() })).max(6).default([]),
  /** The checklist items this reviewer answers, `<checklist>/<item>`. */
  items: z.array(z.string().max(250)).max(60).default([]),
})
export type RunAngle = z.infer<typeof runAngleSchema>

export const ITEM_STATES = ['passed', 'failed', 'na'] as const
export const runChecklistSchema = z.object({
  id: z.string().max(120),
  name: z.string().max(300),
  items: z
    .array(
      z.object({
        id: z.string().max(120),
        text: z.string().max(1000),
        /** Null: unchecked. */
        state: z.enum(ITEM_STATES).nullable(),
        /** Set by the person (not over MCP): agents never change it. */
        byPerson: z.boolean().default(false),
        by: z.string().max(200).optional(),
        note: z.string().max(1000).optional(),
      }),
    )
    .max(200),
})
export type RunChecklist = z.infer<typeof runChecklistSchema>

export const budgetSchema = z.object({
  size: z.enum(['small', 'medium', 'large']),
  files: z.number().int().min(0),
  lines: z.number().int().min(0),
  pointsPerReviewer: z.number().int().min(1).max(20),
  filesBeyondDiff: z.number().int().min(0).max(100),
  /** A soft cap on the tokens the run spends, read from the conductor's transcript. */
  tokens: z.number().int().min(1000),
})
export type Budget = z.infer<typeof budgetSchema>

export const WAITING_WHYS = ['checklist', 'drafted', 'moved-on', 'stopped', 'question'] as const
export type RunWaitingWhy = (typeof WAITING_WHYS)[number]

export const runSchema = z.object({
  version: z.literal(RUN_VERSION),
  id: z.string().regex(RUN_ID),
  createdAt: z.string(),
  updatedAt: z.string(),
  stage: z.enum(REVIEW_STAGES),
  /** The conversation driving it now, or null. */
  session: z.string().nullable(),
  /** Started by Factory itself, as a background session, for a re-review. */
  background: z.boolean().default(false),
  place: z.object({ epic: z.string().optional(), parts: z.array(z.string()).optional(), kehikko: z.string().optional() }).nullable(),
  change: changeSchema,
  /** 1 for the first review of the change; 2 and 3 for re-reviews. */
  round: z.number().int().min(1).max(MAX_ROUNDS),
  previous: z.string().regex(RUN_ID).nullable(),
  /** On a re-review: the required points of the last review, which this one checks. */
  listed: z.array(z.object({ id: z.string().max(40), text: z.string().max(1000) })).max(40).default([]),
  /** The one head this run reviews; nothing is anchored to any other. */
  pinned: z.object({ head: z.string(), base: z.string(), mergeBase: z.string(), previousHead: z.string().nullable().default(null), at: z.string() }).nullable(),
  checkout: z.object({ path: z.string(), present: z.boolean() }).nullable(),
  budget: budgetSchema.nullable(),
  spend: z.array(z.object({ step: z.string(), tokens: z.number().int().min(0), cached: z.number().int().min(0).default(0) })).max(40).default([]),
  /** When the step now running was handed out, for reading what it spent. */
  stepAt: z.string().nullable().default(null),
  vision: z.object({ epic: z.string().nullable(), said: z.string().max(400) }).nullable().default(null),
  checklists: z.array(runChecklistSchema).max(20).default([]),
  /** A checklist the planner proposed, waiting for the person. */
  proposed: z.array(z.string().max(200)).max(15).nullable().default(null),
  plan: z
    .object({
      angles: z.array(runAngleSchema).max(2),
      door: z.object({ kind: z.enum(['one-way', 'two-way']), reasons: z.array(z.string()).max(8), rule: z.string().nullable() }),
      uiux: z.object({ touches: z.boolean(), reason: z.string(), screens: z.array(z.string()).max(10), shots: z.boolean() }),
    })
    .nullable()
    .default(null),
  points: z.array(checkedPointSchema).max(40).default([]),
  /** Points refused by the rules, over a cap, or not got to: each with why. */
  rejected: z.array(z.object({ angle: z.string(), point: z.string(), why: z.string() })).max(200).default([]),
  /** Checklist items a reviewer was given and did not answer. */
  skipped: z.array(z.string()).max(200).default([]),
  answers: z.array(z.object({ checklist: z.string(), item: z.string(), state: z.enum(['pass', 'fail', 'n/a']), note: z.string(), by: z.string() })).max(200).default([]),
  /** Who asked to close the change rather than fix it. */
  closeVotes: z.object({ reviewers: z.array(z.boolean()).max(2), adversary: z.boolean() }).default({ reviewers: [], adversary: false }),
  challenges: z.array(z.object({ point: z.string(), concede: z.boolean(), case: z.string(), evidence: z.array(evidenceSchema) })).max(80).default([]),
  judged: z
    .object({
      rulings: z.array(z.object({ point: z.string(), ruling: z.enum(RULINGS), reason: z.string() })),
      verdict: z.enum(PANEL_VERDICTS),
      visionFit: z.string(),
      summary: z.string(),
      pathToSuccess: z.array(z.string()),
      close: z.object({ why: z.string(), instead: z.string() }).nullable(),
      diagrams: z.array(z.object({ point: z.string(), kind: z.enum(['sequence', 'graph']), now: z.string(), proposed: z.string() })),
      notes: z.array(z.string()),
    })
    .nullable()
    .default(null),
  /** Points raised by Factory itself, by rule (no before/after pictures on a UI change). */
  general: z.array(z.object({ id: z.string(), claim: z.string(), suggestion: z.string() })).max(5).default([]),
  /** Flows written for the judge's diagram requests: point → flow id. */
  diagrams: z.array(z.object({ point: z.string(), flow: z.string() })).max(10).default([]),
  drafted: z
    .object({
      at: z.string(),
      comments: z.number().int(),
      refused: z.array(z.object({ point: z.string(), why: z.string() })),
      proposal: z.boolean(),
      ticks: z.number().int(),
      briefing: z.enum(['none', 'record', 'paper']).default('none'),
    })
    .nullable()
    .default(null),
  sent: z.object({ at: z.string(), by: z.enum(['factory', 'person']) }).nullable().default(null),
  waiting: z.object({ why: z.enum(WAITING_WHYS), said: z.string() }).nullable().default(null),
  /** Plain sentences for the card and the record: disagreements, what the run did not get to. */
  notes: z.array(z.string().max(600)).max(60).default([]),
  /** How many times a step's answer was malformed (one more try, then the run stops). */
  tries: z.record(z.string(), z.number().int()).default({}),
  archived: z.boolean().default(false),
  history: z.array(z.object({ at: z.string(), stage: z.enum(REVIEW_STAGES), said: z.string() })).max(200),
})
export type Run = z.infer<typeof runSchema>
export type RunPoint = z.infer<typeof checkedPointSchema>
export type { PanelPoint }

/* ---- The project's review settings (inside settings.json, person-only) ---------------- */

export const DOORS = ['one-way', 'two-way'] as const
export const doorRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), glob: z.string().min(1).max(200), door: z.enum(DOORS) }),
  z.object({ kind: z.literal('label'), label: z.string().min(1).max(100), door: z.enum(DOORS) }),
])
export type DoorRule = z.infer<typeof doorRuleSchema>

export const DEFAULT_RULE_SENTENCE = 'when they re-request review, or 2 hours after the last push with new commits and every point answered'

export const reviewSettingsSchema = z.object({
  /** "Post two-way reviews by myself": a two-way change with no UI/UX is posted without the person. Off. */
  postTwoWay: z.boolean().default(false),
  /** "Re-review by myself": a re-review runs in a background session. Off. */
  reReviewByItself: z.boolean().default(false),
  /** "Reviewers may run this project's tests": only its own test command, in the run's checkout. Off. */
  runTests: z.boolean().default(false),
  doorRules: z.array(doorRuleSchema).max(50).default([]),
  /** The project's default answer to "what's the signal they're ready for another review?". */
  defaultRule: z.string().min(1).max(300).default(DEFAULT_RULE_SENTENCE),
})
export type ReviewSettings = z.infer<typeof reviewSettingsSchema>
export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = reviewSettingsSchema.parse({})
