import { describe, expect, test } from 'bun:test'

import { parseUnified } from '../review/diff.ts'
import type { PanelPoint } from '../review/points.ts'
import { mergeNearDuplicates, validateAnswers, validatePoints } from '../review/validate.ts'
import { DIFF } from './fixtures.ts'

const files = parseUnified(DIFF)
const good: PanelPoint = {
  path: 'greet.js',
  side: 'new',
  line: 2,
  quote: 'export const greet = (name) => `HELLO, ${name}`',
  claim: 'The name is not uppercased.',
  why: 'Only the greeting shouts.',
  suggestion: 'Uppercase the whole string.',
  severity: 'blocking',
  evidence: [{ kind: 'line', ref: 'greet.js:2' }],
  checklist: [],
}

describe('the mechanical rules', () => {
  test('a good point passes, with an id and who raised it', () => {
    const done = validatePoints('correctness', [good], files, { perReviewer: 8 })
    expect(done.rejected).toEqual([])
    expect(done.kept[0]).toMatchObject({ id: 'p1', angles: ['correctness'], also: [] })
  })

  test('each rule refuses with its reason', () => {
    const cases: [Partial<PanelPoint>, string][] = [
      [{ line: 9 }, 'anchor is wrong'],
      [{ quote: 'something else' }, 'quoted text'],
      [{ evidence: [] }, 'no evidence'],
      [{ claim: 'store.ts never closes the file.', evidence: [{ kind: 'line', ref: 'greet.js:2' }] }, 'about store.ts'],
      [{ why: 'x'.repeat(600) }, 'characters together'],
    ]
    for (const [over, why] of cases) {
      const done = validatePoints('correctness', [{ ...good, ...over }], files, { perReviewer: 8 })
      expect(done.kept).toEqual([])
      expect(done.rejected[0]!.why).toContain(why)
    }
    const backed = validatePoints('correctness', [{ ...good, claim: 'store.ts never closes the file.', evidence: [{ kind: 'doc', ref: 'store.ts:40' }] }], files, { perReviewer: 8 })
    expect(backed.kept.length).toBe(1)
  })

  test('a re-review keeps a new point only about new code, and a listed point anywhere', () => {
    const delta = parseUnified(DIFF.split('diff --git a/old.js')[0]!.replace(/@@ -10[\s\S]*$/, ''))
    expect(validatePoints('c', [{ ...good, line: 12, quote: 'c' }], files, { perReviewer: 8, delta }).rejected[0]!.why).toContain('not about new code')
    expect(validatePoints('c', [{ ...good, line: 12, quote: 'c', listed: 'p3' }], files, { perReviewer: 8, delta }).kept.length).toBe(1)
  })

  test('the cap keeps blocking points first; the rest are what the run did not get to', () => {
    const nice = { ...good, severity: 'nice' as const }
    const done = validatePoints('c', [nice, nice, good], files, { perReviewer: 2 })
    expect(done.kept.map((one) => one.severity)).toEqual(['nice', 'blocking'])
    expect(done.over[0]!.why).toContain('over the cap of 2')
  })

  test('near-duplicates become one point listing every place', () => {
    const a = validatePoints('a', [good], files, { perReviewer: 8 }).kept
    const b = validatePoints('b', [{ ...good, path: 'new.js', line: 1, quote: 'y', severity: 'risk', evidence: [{ kind: 'test', ref: 'greet.test.js' }] }], files, { perReviewer: 8 }, 2).kept
    const merged = mergeNearDuplicates([...a, ...b])
    expect(merged.length).toBe(1)
    expect(merged[0]!.also).toEqual([{ path: 'new.js', side: 'new', line: 1 }])
    expect(merged[0]!.angles).toEqual(['a', 'b'])
    expect(merged[0]!.evidence.length).toBe(2)
  })

  test('a checklist answer needs a note and must be one the reviewer was given; none is skipped silently', () => {
    const done = validateAnswers('a', [
      { checklist: 'c1', item: 'i1', state: 'pass', note: 'test greet.test.js' },
      { checklist: 'c1', item: 'i2', state: 'fail', note: '' },
      { checklist: 'c1', item: 'i9', state: 'pass', note: 'x' },
    ], [{ checklist: 'c1', item: 'i1' }, { checklist: 'c1', item: 'i2' }, { checklist: 'c1', item: 'i3' }])
    expect(done.kept.map((one) => one.item)).toEqual(['i1'])
    expect(done.refused.map((one) => one.why)).toEqual(['answered without saying how it knows.', 'a was not given this item.'])
    expect(done.skipped).toEqual(['c1/i2', 'c1/i3'])
  })
})
