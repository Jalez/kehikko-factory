import { z } from 'zod'

import { ANGLE_ID, MAX_ANGLE_ID, MAX_BRIEF } from './angles.ts'
import type { Parsed } from './parse.ts'

/**
 * The panel's answers (part of `review/`, free of anything Factory-specific). A review panel — a
 * planner, two reviewers, one adversary over every point, a judge — writes markdown for a person,
 * and ONE fenced ```json block with the few things the module acts on. The shapes are here, once;
 * the prompts (`prompts.ts`) spell them out, and what does not parse is said back in one sentence.
 */

/** A source for a claim: a line, a test or reproduction, the project's own doc or code, or a named practice with a link. */
export const evidenceSchema = z.object({
  kind: z.enum(['line', 'test', 'doc', 'practice']),
  ref: z.string().min(1).max(500),
  quote: z.string().max(1000).optional(),
})
export type Evidence = z.infer<typeof evidenceSchema>

export const SEVERITIES = ['blocking', 'risk', 'nice'] as const
export type Severity = (typeof SEVERITIES)[number]

/** One point a reviewer makes, anchored to the lines that show it. */
export const panelPointSchema = z.object({
  path: z.string().min(1).max(1000),
  side: z.enum(['new', 'old']).default('new'),
  line: z.number().int().positive(),
  startLine: z.number().int().positive().optional(),
  /** The anchored lines, as the diff shows them. */
  quote: z.string().min(1).max(4000),
  claim: z.string().min(1).max(400),
  why: z.string().min(1).max(400),
  suggestion: z.string().min(1).max(400),
  severity: z.enum(SEVERITIES),
  evidence: z.array(evidenceSchema).max(8).default([]),
  /** The checklist items (`<checklist>/<item>` or the item id) this point bears on. */
  checklist: z.array(z.string().max(120)).max(15).default([]),
  /** On a re-review: the id of the listed point this one says is still not met. */
  listed: z.string().max(40).optional(),
})
export type PanelPoint = z.infer<typeof panelPointSchema>

export const ANSWER_STATES = ['pass', 'fail', 'n/a'] as const
export const answerSchema = z.object({
  checklist: z.string().min(1).max(120),
  item: z.string().min(1).max(120),
  state: z.enum(ANSWER_STATES),
  note: z.string().max(600).default(''),
})
export type Answer = z.infer<typeof answerSchema>

const closeSchema = z.object({ why: z.string().min(1).max(600), instead: z.string().min(1).max(600) })

export const reviewerOutputSchema = z.object({
  verdict: z.enum(['APPROVE', 'CHANGES']),
  points: z.array(panelPointSchema).max(40),
  answers: z.array(answerSchema).max(60).default([]),
  /** Only when this reviewer thinks the change should be closed rather than fixed. */
  close: closeSchema.optional(),
})
export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>

export const MAX_PROPOSED_ITEMS = 15

export const plannerOutputSchema = z.object({
  angles: z
    .array(
      z.object({
        id: z.string().regex(ANGLE_ID).max(MAX_ANGLE_ID),
        brief: z.string().min(1).max(MAX_BRIEF * 2),
        practices: z.array(z.object({ name: z.string().min(1).max(200), source: z.string().min(1).max(500) })).max(6).default([]),
        items: z.array(z.string().max(120)).max(60).default([]),
      }),
    )
    .length(2),
  door: z.object({ kind: z.enum(['one-way', 'two-way']), reasons: z.array(z.string().min(1).max(300)).min(1).max(6) }),
  uiux: z.object({ touches: z.boolean(), reason: z.string().max(300).default(''), screens: z.array(z.string().max(120)).max(10).default([]) }),
  proposedChecklist: z.array(z.string().min(1).max(200)).max(MAX_PROPOSED_ITEMS).optional(),
})
export type PlannerOutput = z.infer<typeof plannerOutputSchema>

export const challengeOutputSchema = z.object({
  challenges: z
    .array(z.object({ point: z.string().min(1).max(40), concede: z.boolean(), case: z.string().max(800).default(''), evidence: z.array(evidenceSchema).max(8).default([]) }))
    .max(80),
  /** Whether the adversary agrees the change should be closed, when a reviewer said so. */
  close: z.boolean().optional(),
})
export type ChallengeOutput = z.infer<typeof challengeOutputSchema>

export const RULINGS = ['required', 'optional', 'rejected'] as const
export type PanelRuling = (typeof RULINGS)[number]
export const PANEL_VERDICTS = ['approve', 'comment', 'request-changes', 'close'] as const
export type PanelVerdict = (typeof PANEL_VERDICTS)[number]

export const judgeOutputSchema = z.object({
  rulings: z.array(z.object({ point: z.string().min(1).max(40), ruling: z.enum(RULINGS), reason: z.string().min(1).max(400) })).max(80),
  verdict: z.enum(PANEL_VERDICTS),
  visionFit: z.string().max(400).default(''),
  summary: z.string().min(1).max(3000),
  close: closeSchema.optional(),
  diagrams: z
    .array(z.object({ point: z.string().min(1).max(40), kind: z.enum(['sequence', 'graph']), now: z.string().min(1).max(400), proposed: z.string().min(1).max(400) }))
    .max(3)
    .default([]),
})
export type JudgeOutput = z.infer<typeof judgeOutputSchema>

/** The last ```json fenced block of a text, parsed, or null. */
export function jsonBlock(text: string): unknown | null {
  const blocks = [...text.matchAll(/```json[ \t]*\r?\n([\s\S]*?)\r?\n```/g)]
  const last = blocks.at(-1)
  if (!last) return null
  try {
    return JSON.parse(last[1]!)
  } catch {
    return null
  }
}

function parseWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, text: string, file: string): Parsed<T> {
  const raw = jsonBlock(text)
  if (raw === null) return { ok: false, why: `${file} has no \`\`\`json block the module can read (or its JSON does not parse).` }
  const parsed = schema.safeParse(raw)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issue = parsed.error.issues[0]!
  return { ok: false, why: `${file}: ${issue.path.join('.') || 'the block'} — ${issue.message}.` }
}

export const parsePlanner = (text: string, file = 'plan.md') => parseWith(plannerOutputSchema, text, file)
export const parseReviewer = (text: string, file = 'the review') => parseWith(reviewerOutputSchema, text, file)
export const parseChallenge = (text: string, file = 'challenge.md') => parseWith(challengeOutputSchema, text, file)
export const parseJudge = (text: string, file = 'judgement.md') => parseWith(judgeOutputSchema, text, file)
