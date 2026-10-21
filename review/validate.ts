import { linesAt, type DiffFile } from './diff.ts'
import { SEVERITIES, type Answer, type PanelPoint, type Severity } from './points.ts'

/**
 * The mechanical rules a panel's points are held to before any agent sees them (part of
 * `review/`). Each refusal is one sentence, kept in the run's record:
 *
 *  - the anchor is not a line of this diff, or the quoted text is not what those lines say;
 *  - there is no evidence, or the only evidence is the point's own lines for a claim about code
 *    somewhere else;
 *  - claim, why and suggestion together are longer than people read (600 characters);
 *  - on a re-review, a new point about code that did not change since the last review;
 *  - a checklist answer with no "how I know", or for an item that reviewer was not given.
 *
 * Near-duplicates (the same lines, or the same claim in other words) become one point that lists
 * every place.
 */

export const MAX_POINT_CHARS = 600

export interface Place {
  path: string
  side: 'new' | 'old'
  line: number
  startLine?: number
}

/** A point that passed, with its id, who raised it, and every place when duplicates were merged. */
export type CheckedPoint = PanelPoint & { id: string; angles: string[]; also: Place[] }

export interface Rejected {
  angle: string
  point: string
  why: string
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Paths a sentence names, by the look of them: `src/a.ts`, `store.ts`. */
const PATHISH = /(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|sql|json|ya?ml|toml|md|css|scss|html|vue|svelte|sh)\b/g

function namesElsewhere(point: PanelPoint): string | null {
  const said = `${point.claim} ${point.why}`
  for (const m of said.matchAll(PATHISH)) {
    const named = m[0]
    if (named !== point.path && !point.path.endsWith(`/${named}`) && !named.endsWith(point.path)) return named
  }
  return null
}

const rank = (severity: Severity) => SEVERITIES.indexOf(severity)

export interface ValidateOptions {
  /** How many points one reviewer may keep; the rest are what the run did not get to. */
  perReviewer: number
  maxChars?: number
  /** On a re-review: the diff since the last review. A new point must be about its lines. */
  delta?: readonly DiffFile[] | null
}

export interface Validated {
  kept: CheckedPoint[]
  rejected: Rejected[]
  /** Valid points over the cap, by severity: listed in the record, not posted. */
  over: Rejected[]
}

export function shortOf(point: Pick<PanelPoint, 'path' | 'line' | 'claim'>): string {
  return `${point.path}:${point.line} — ${point.claim.slice(0, 120)}`
}

export function validatePoints(angle: string, points: readonly PanelPoint[], files: readonly DiffFile[], options: ValidateOptions, firstId = 1): Validated {
  const max = options.maxChars ?? MAX_POINT_CHARS
  const passed: PanelPoint[] = []
  const rejected: Rejected[] = []
  const refuse = (point: PanelPoint, why: string) => rejected.push({ angle, point: shortOf(point), why })
  for (const point of points) {
    const at = linesAt(files, point)
    if (!at.ok) {
      refuse(point, `the anchor is wrong: ${at.why}`)
      continue
    }
    const quote = squash(point.quote)
    const lines = squash(at.text)
    if (!quote || !lines || !(lines.includes(quote) || quote.includes(lines))) {
      refuse(point, 'the quoted text is not what those lines say.')
      continue
    }
    if (!point.evidence.length) {
      refuse(point, 'it gives no evidence: a line, a test, the project\'s own docs or code, or a named practice with a link.')
      continue
    }
    const elsewhere = namesElsewhere(point)
    if (elsewhere && point.evidence.every((one) => one.kind === 'line' && (one.ref.startsWith(point.path) || one.ref === `${point.line}`))) {
      refuse(point, `it is about ${elsewhere}, and its only evidence is its own lines.`)
      continue
    }
    const length = point.claim.length + point.why.length + point.suggestion.length
    if (length > max) {
      refuse(point, `claim, why and suggestion are ${length} characters together; the most is ${max}.`)
      continue
    }
    if (options.delta && !point.listed && !linesAt(options.delta, point).ok) {
      refuse(point, 'it is not about new code: a re-review raises new points only about what changed since the last review.')
      continue
    }
    passed.push(point)
  }
  const sorted = passed.map((point, at) => ({ point, at })).sort((a, b) => rank(a.point.severity) - rank(b.point.severity) || a.at - b.at)
  const keep = sorted.slice(0, Math.max(0, options.perReviewer)).sort((a, b) => a.at - b.at)
  const over = sorted.slice(Math.max(0, options.perReviewer)).map(({ point }) => ({ angle, point: shortOf(point), why: `over the cap of ${options.perReviewer} points for one reviewer.` }))
  return {
    kept: keep.map(({ point }, i) => ({ ...point, id: `p${firstId + i}`, angles: [angle], also: [] })),
    rejected,
    over,
  }
}

const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((one) => one.length > 2))

function similar(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return 0
  let both = 0
  for (const one of x) if (y.has(one)) both++
  return both / (x.size + y.size - both)
}

const overlaps = (a: Place, b: Place) =>
  a.path === b.path && a.side === b.side && (a.startLine ?? a.line) <= b.line && (b.startLine ?? b.line) <= a.line

/** One point per root cause: a duplicate's place joins the first, the higher severity and every source kept. */
export function mergeNearDuplicates(points: readonly CheckedPoint[]): CheckedPoint[] {
  const out: CheckedPoint[] = []
  for (const point of points) {
    const same = out.find((one) => overlaps(one, point) || similar(one.claim, point.claim) >= 0.6)
    if (!same) {
      out.push({ ...point, also: [...point.also] })
      continue
    }
    if (!overlaps(same, point)) same.also.push({ path: point.path, side: point.side, line: point.line, ...(point.startLine ? { startLine: point.startLine } : {}) })
    if (rank(point.severity) < rank(same.severity)) same.severity = point.severity
    for (const one of point.evidence) if (!same.evidence.some((had) => had.ref === one.ref)) same.evidence.push(one)
    same.checklist = [...new Set([...same.checklist, ...point.checklist])]
    same.angles = [...new Set([...same.angles, ...point.angles])]
  }
  return out
}

export interface Assigned {
  checklist: string
  item: string
}

export interface AnswersChecked {
  kept: (Answer & { by: string })[]
  refused: { item: string; why: string }[]
  /** Items given to this reviewer that it did not answer: never silent. */
  skipped: string[]
}

export function validateAnswers(angle: string, answers: readonly Answer[], assigned: readonly Assigned[]): AnswersChecked {
  const kept: AnswersChecked['kept'] = []
  const refused: AnswersChecked['refused'] = []
  const key = (one: Assigned) => `${one.checklist}/${one.item}`
  const given = new Set(assigned.map(key))
  for (const answer of answers) {
    if (!given.has(key(answer))) {
      refused.push({ item: key(answer), why: `${angle} was not given this item.` })
      continue
    }
    if (!answer.note.trim()) {
      refused.push({ item: key(answer), why: 'answered without saying how it knows.' })
      continue
    }
    if (kept.some((one) => key(one) === key(answer))) continue
    kept.push({ ...answer, note: answer.note.trim(), by: angle })
  }
  const answered = new Set(kept.map(key))
  return { kept, refused, skipped: assigned.map(key).filter((one) => !answered.has(one)) }
}
