import type { Point } from './angles.ts'
import { requiredPoints, type Judged, type Verdict } from './parse.ts'

/**
 * The judge's rules, as one pure function: what a round of review comes to.
 *
 *  - Points the judge ruled REQUIRED go back to whoever makes the change — and nothing it ruled
 *    optional or rejected — while rounds remain (`round < lastRound`).
 *  - Required points in the last round go to the person to decide.
 *  - Nothing required: the judge's last word stands — ready (`approve`) or for a person to weigh
 *    (`hand-over`). What "approve" leads to (a merge, a comment) is the caller's.
 *
 * Part of `review/`, which knows nothing of Factory's jobs, git or storage.
 */

export type Next =
  | { kind: 'rework'; required: Point[] }
  | { kind: 'decide'; required: Point[] }
  | { kind: 'approve' }
  | { kind: 'hand-over' }

export function ruleOn(judged: Judged, round: number, lastRound: number): Next {
  const required = requiredPoints(judged)
  if (required.length) return round < lastRound ? { kind: 'rework', required } : { kind: 'decide', required }
  return judged.final === 'hand-over' ? { kind: 'hand-over' } : { kind: 'approve' }
}

/** The angles whose reviewers asked for changes: the ones a counter-arguer answers. */
export function contested(verdicts: Readonly<Record<string, Verdict>>): string[] {
  return Object.entries(verdicts)
    .filter(([, verdict]) => verdict === 'changes')
    .map(([angle]) => angle)
}
