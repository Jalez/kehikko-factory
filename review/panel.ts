import type { JudgeOutput, PanelRuling, PanelVerdict } from './points.ts'
import type { CheckedPoint } from './validate.ts'

/**
 * The panel's rules, as one pure function over what the judge wrote (part of `review/`):
 *
 *  - every point that reached the judge gets a ruling; one it skipped is optional;
 *  - at most three optional points, the rest rejected for being over that cap — a review is read
 *    only when it is short;
 *  - anything required means "request changes"; nothing required can never mean that, so a review
 *    that finds nothing blocking says so plainly;
 *  - "close this change" stands only when both reviewers, the adversary and the judge said so;
 *    otherwise it is "request changes", and the record says it was not unanimous;
 *  - the path to success is exactly the required points, one step each, unnumbered (whoever shows
 *    it numbers it: Review does, under "To get this approved:"). Doing those gets it approved.
 */

export const MAX_OPTIONAL = 3

/** A point the module raises itself, with no anchor: always required (a UI/UX change with no before and after pictures). */
export interface GeneralPoint {
  id: string
  claim: string
  suggestion: string
}

export interface Ruled {
  point: string
  ruling: PanelRuling
  reason: string
}

export interface PanelResult {
  rulings: Ruled[]
  verdict: PanelVerdict
  /** The required points as a person acts on them, one step each, unnumbered: "To get this approved:" */
  pathToSuccess: string[]
  notes: string[]
}

/** The steps numbered, for a place that shows them as text. */
export const numbered = (steps: readonly string[]): string[] => steps.map((step, i) => `${i + 1}. ${step}`)

export function placeOf(point: Pick<CheckedPoint, 'path' | 'line' | 'startLine' | 'also'>): string {
  const first = `${point.path}:${point.startLine && point.startLine !== point.line ? `${point.startLine}-` : ''}${point.line}`
  return point.also.length ? `${first} and ${point.also.length} more place${point.also.length === 1 ? '' : 's'}` : first
}

export function rulePanel(input: {
  points: readonly CheckedPoint[]
  general?: readonly GeneralPoint[]
  judge: JudgeOutput
  /** Whether each reviewer asked to close the change. */
  reviewersClose: readonly boolean[]
  /** Whether the adversary agreed to close it. */
  adversaryCloses: boolean
}): PanelResult {
  const notes: string[] = []
  const general = input.general ?? []
  const byId = new Map(input.judge.rulings.map((one) => [one.point, one]))
  const rulings: Ruled[] = input.points.map((point) => {
    const said = byId.get(point.id)
    return said ? { point: point.id, ruling: said.ruling, reason: said.reason } : { point: point.id, ruling: 'optional', reason: 'The judge did not rule on it.' }
  })
  for (const point of general) rulings.unshift({ point: point.id, ruling: 'required', reason: 'Raised by Factory itself, by rule.' })

  let optional = 0
  for (const one of rulings) {
    if (one.ruling !== 'optional') continue
    optional++
    if (optional > MAX_OPTIONAL) {
      one.ruling = 'rejected'
      one.reason = `Over the cap of ${MAX_OPTIONAL} optional points. (${one.reason})`
    }
  }

  const required = rulings.filter((one) => one.ruling === 'required')
  let verdict = input.judge.verdict
  if (verdict === 'close') {
    const unanimous = input.reviewersClose.length >= 2 && input.reviewersClose.every(Boolean) && input.adversaryCloses && !!input.judge.close
    if (!unanimous) {
      verdict = 'request-changes'
      notes.push('The judge asked to close the change, but the panel was not unanimous, so it asks for changes instead.')
    }
  }
  if (verdict !== 'close') {
    if (required.length && verdict !== 'request-changes') {
      notes.push(`The judge said "${verdict}" while ruling ${required.length} point${required.length === 1 ? '' : 's'} required; a required point means changes are requested.`)
      verdict = 'request-changes'
    } else if (!required.length && verdict === 'request-changes') {
      notes.push('The judge asked for changes but required nothing, so nothing blocks: the review approves.')
      verdict = 'approve'
    }
  }

  const points = new Map(input.points.map((point) => [point.id, point]))
  const generals = new Map(general.map((point) => [point.id, point]))
  const pathToSuccess = required.map((one) => {
    const point = points.get(one.point)
    if (point) return `${point.suggestion} (${placeOf(point)}): ${point.claim}`
    const raised = generals.get(one.point)
    return `${raised?.suggestion ?? one.point} ${raised ? `— ${raised.claim}` : ''}`.trim()
  })
  return { rulings, verdict, pathToSuccess, notes }
}
