import { describe, expect, test } from 'bun:test'

import { rulePanel } from '../review/panel.ts'
import type { JudgeOutput } from '../review/points.ts'
import type { CheckedPoint } from '../review/validate.ts'

const point = (n: number): CheckedPoint => ({
  id: `p${n}`,
  path: 'a.ts',
  side: 'new',
  line: n,
  quote: 'x',
  claim: `Claim ${n}.`,
  why: 'Why.',
  suggestion: `Fix ${n}.`,
  severity: 'risk',
  evidence: [{ kind: 'line', ref: 'a.ts:1' }],
  checklist: [],
  angles: ['correctness'],
  also: [],
})

const judge = (over: Partial<JudgeOutput>): JudgeOutput => ({ rulings: [], verdict: 'approve', visionFit: 'Fits.', summary: 'Sum.', diagrams: [], ...over })

describe('the panel\'s rules', () => {
  test('at most three optional points; the rest are rejected for the cap', () => {
    const points = [1, 2, 3, 4, 5].map(point)
    const out = rulePanel({ points, judge: judge({ rulings: points.map((one) => ({ point: one.id, ruling: 'optional', reason: 'Nice.' })) }), reviewersClose: [false, false], adversaryCloses: false })
    expect(out.rulings.filter((one) => one.ruling === 'optional').length).toBe(3)
    expect(out.rulings[4]!.reason).toContain('Over the cap of 3')
    expect(out.verdict).toBe('approve')
  })

  test('a required point means changes, and the path to success is exactly the required points', () => {
    const points = [1, 2].map(point)
    const out = rulePanel({
      points,
      general: [{ id: 'shots', claim: 'No before and after pictures.', suggestion: 'Add pictures of the home screen.' }],
      judge: judge({ verdict: 'approve', rulings: [{ point: 'p1', ruling: 'required', reason: 'Bug.' }, { point: 'p2', ruling: 'rejected', reason: 'Taste.' }] }),
      reviewersClose: [false, false],
      adversaryCloses: false,
    })
    expect(out.verdict).toBe('request-changes')
    expect(out.pathToSuccess).toEqual(['1. Add pictures of the home screen. — No before and after pictures.', '2. Fix 1. (a.ts:1): Claim 1.'])
    expect(out.notes[0]).toContain('a required point means changes')
  })

  test('nothing required never asks for changes', () => {
    const out = rulePanel({ points: [point(1)], judge: judge({ verdict: 'request-changes', rulings: [{ point: 'p1', ruling: 'optional', reason: 'Nice.' }] }), reviewersClose: [], adversaryCloses: false })
    expect(out.verdict).toBe('approve')
  })

  test('close stands only when everyone said so', () => {
    const close = { why: 'Duplicate of #3.', instead: 'Review #3.' }
    expect(rulePanel({ points: [], judge: judge({ verdict: 'close', close }), reviewersClose: [true, true], adversaryCloses: true }).verdict).toBe('close')
    const split = rulePanel({ points: [], judge: judge({ verdict: 'close', close }), reviewersClose: [true, false], adversaryCloses: true })
    expect(split.verdict).toBe('approve')
    expect(split.notes[0]).toContain('not unanimous')
  })
})
