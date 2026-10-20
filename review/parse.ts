import { ANGLE_ID, MAX_ANGLES, MAX_ANGLE_ID, MAX_BRIEF, MIN_ANGLES, type Angle, type Point } from './angles.ts'

/**
 * Reading what the review agents wrote (part of `review/`, free of anything Factory-specific). Each role writes markdown for a person, and puts the few things the
 * module acts on in lines with a fixed shape, which the prompts in `prompts.ts` spell out. What does
 * not parse is said back in one sentence, so the conversation can ask the agent to write it again.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; why: string }

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

/** The lines under a `## <heading>` (any level ≥ 2), up to the next heading. */
function section(text: string, heading: RegExp): string[] | null {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => /^#{2,6}\s/.test(line) && heading.test(line.replace(/^#+\s*/, '').trim()))
  if (start < 0) return null
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break
    out.push(line)
  }
  return out
}

/**
 * The angles a plan chose: under `## Angles`, one `- <angle-id>: <brief>` per line.
 * At least one, at most `MAX_ANGLES`, no id twice. `asked` (from --angles) must all be present.
 */
export function parsePlan(text: string, asked: readonly string[] | null = null): Parsed<Angle[]> {
  const lines = section(text, /^angles\b/i)
  if (!lines) return { ok: false, why: 'plan.md has no "## Angles" section.' }
  const angles: Angle[] = []
  for (const raw of lines) {
    const m = /^\s*[-*]\s+`?([A-Za-z][\w-]*)`?\s*[:—–-]\s+(.+?)\s*$/.exec(raw)
    if (!m) continue
    const id = m[1]!.toLowerCase().replace(/_/g, '-')
    if (!ANGLE_ID.test(id) || id.length > MAX_ANGLE_ID) return { ok: false, why: `"${clip(m[1]!, 40)}" is not an angle id (kebab-case, at most ${MAX_ANGLE_ID} characters).` }
    if (angles.some((one) => one.id === id)) return { ok: false, why: `plan.md lists the angle "${id}" twice.` }
    angles.push({ id, brief: clip(m[2]!, MAX_BRIEF), by: asked?.includes(id) ? 'person' : 'planner' })
  }
  if (angles.length < MIN_ANGLES) return { ok: false, why: 'plan.md lists no angle under "## Angles" (one "- <angle-id>: <brief>" per line).' }
  if (angles.length > MAX_ANGLES) return { ok: false, why: `plan.md lists ${angles.length} angles; at most ${MAX_ANGLES}.` }
  const missing = (asked ?? []).filter((id) => !angles.some((one) => one.id === id))
  if (missing.length) return { ok: false, why: `plan.md leaves out the angles the person asked for: ${missing.join(', ')}.` }
  return { ok: true, value: angles }
}

export type Verdict = 'approve' | 'changes'

/** A review's verdict: the line `Verdict: APPROVE` or `Verdict: CHANGES`. */
export function parseVerdict(text: string): Parsed<Verdict> {
  const m = /^\s*\**verdict\**\s*:\s*\**\s*(approve|changes)\b/im.exec(text)
  if (!m) return { ok: false, why: 'the review has no "Verdict: APPROVE" or "Verdict: CHANGES" line.' }
  return { ok: true, value: m[1]!.toLowerCase() as Verdict }
}

export type Ruling = 'required' | 'optional' | 'rejected'
export interface Judged {
  /** Each point the judge ruled on, with the ruling. */
  points: { ruling: Ruling; angle: string; point: string }[]
  /** The judge's last word: merge, hand to the person, or changes (when anything is required). */
  final: 'merge' | 'hand-over' | 'changes'
}

/**
 * A judgement: under `## Rulings`, one `- <required|optional|rejected> | <angle> | <the point>` per
 * point; and under `## Ruling` (or a line `Ruling: …`) one of `merge`, `hand-over`, `changes`.
 * A judgement that requires anything is `changes` whatever its last line says — a required point
 * never reaches a merge — and one that requires nothing cannot say `changes`.
 */
export function parseJudgement(text: string, angles: readonly string[]): Parsed<Judged> {
  const lines = section(text, /^rulings\b/i) ?? []
  const points: Judged['points'] = []
  for (const raw of lines) {
    const m = /^\s*[-*]\s+\**(required|optional|rejected)\**\s*[|:]\s*`?([a-z][a-z0-9-]*)`?\s*[|:]\s*(.+?)\s*$/i.exec(raw)
    if (!m) continue
    points.push({ ruling: m[1]!.toLowerCase() as Ruling, angle: m[2]!.toLowerCase(), point: clip(m[3]!, 1000) })
  }
  const finalLine =
    /^\s*\**ruling\**\s*:\s*\**\s*(merge|hand-over|changes)\b/im.exec(text)?.[1]
    ?? (section(text, /^ruling\b/i) ?? []).map((line) => /^\s*\**\s*(merge|hand-over|changes)\b/i.exec(line)?.[1]).find(Boolean)
  if (!finalLine) return { ok: false, why: 'judgement.md has no last ruling: a "## Ruling" section (or "Ruling:" line) saying merge, hand-over or changes.' }
  const unknown = points.find((one) => one.angle !== 'general' && !angles.includes(one.angle))
  if (unknown) return { ok: false, why: `judgement.md rules on an angle this job does not have: "${clip(unknown.angle, 40)}".` }
  const required = points.some((one) => one.ruling === 'required')
  let final = finalLine.toLowerCase() as Judged['final']
  if (required) final = 'changes'
  else if (final === 'changes') return { ok: false, why: 'judgement.md says "changes" but rules no point required.' }
  return { ok: true, value: { points, final } }
}

/** What goes back to the builder: the required points, and nothing the judge made optional or rejected. */
export function requiredPoints(judged: Judged): Point[] {
  return judged.points.filter((one) => one.ruling === 'required').map(({ angle, point }) => ({ angle, point }))
}

/** `--angles a,b` out of what the person typed, and the rest as the feature. */
export function splitAngles(said: string): { feature: string; angles: string[] | null; bad: string | null } {
  const m = /(?:^|\s)--angles(?:=|\s+)(\S+)/.exec(said)
  if (!m) return { feature: said.trim(), angles: null, bad: null }
  const angles = [...new Set(m[1]!.split(',').map((one) => one.trim().toLowerCase()).filter(Boolean))]
  const bad = angles.find((id) => !ANGLE_ID.test(id) || id.length > MAX_ANGLE_ID) ?? null
  const feature = (said.slice(0, m.index) + said.slice(m.index + m[0].length)).trim()
  if (angles.length > MAX_ANGLES) return { feature, angles, bad: `at most ${MAX_ANGLES} angles` }
  return { feature, angles: angles.length ? angles : null, bad: bad ? `"${clip(bad, 40)}" is not an angle id (kebab-case)` : null }
}
