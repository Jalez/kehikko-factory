import { describe, expect, test } from 'bun:test'

import { jsonBlock, parseChallenge, parseJudge, parsePlanner, parseReviewer } from '../review/points.ts'

const fenced = (value: unknown) => `# Notes\n\nSome words.\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`

const point = {
  path: 'greet.js',
  side: 'new',
  line: 1,
  quote: 'export const greet',
  claim: 'The greeting is not uppercase.',
  why: 'The spec says it shouts.',
  suggestion: 'Call toUpperCase.',
  severity: 'blocking',
  evidence: [{ kind: 'line', ref: 'greet.js:1' }],
  checklist: ['i1'],
}

describe('the panel\'s answers', () => {
  test('the last json block is the one read', () => {
    expect(jsonBlock('```json\n{"a":1}\n```\ntext\n```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(jsonBlock('no block')).toBeNull()
    expect(jsonBlock('```json\n{not json\n```')).toBeNull()
  })

  test('a reviewer\'s answer parses, with defaults', () => {
    const parsed = parseReviewer(fenced({ verdict: 'CHANGES', points: [point], answers: [{ checklist: 'c1', item: 'i1', state: 'fail', note: 'No test.' }] }))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.points[0]!.side).toBe('new')
      expect(parsed.value.answers[0]!.state).toBe('fail')
    }
  })

  test('each malformed answer says why in one sentence', () => {
    expect(parseReviewer('words only')).toEqual({ ok: false, why: expect.stringContaining('no ```json block') })
    const bad = parseReviewer(fenced({ verdict: 'CHANGES', points: [{ ...point, severity: 'huge' }], answers: [] }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.why).toContain('points.0.severity')
    const three = parsePlanner(fenced({ angles: [1, 2, 3].map((n) => ({ id: `a${n}`, brief: 'b', practices: [], items: [] })), door: { kind: 'two-way', reasons: ['cheap'] }, uiux: { touches: false, reason: 'no screens', screens: [] } }))
    expect(three.ok).toBe(false)
    if (!three.ok) expect(three.why).toContain('angles')
    const many = parsePlanner(
      fenced({
        angles: [1, 2].map((n) => ({ id: `a${n}`, brief: 'b', practices: [], items: [] })),
        door: { kind: 'two-way', reasons: ['cheap'] },
        uiux: { touches: false, reason: 'no screens', screens: [] },
        proposedChecklist: Array.from({ length: 16 }, (_, i) => `item ${i}`),
      }),
    )
    expect(many.ok).toBe(false)
  })

  test('a plan, a challenge and a judgement parse', () => {
    const plan = parsePlanner(
      fenced({
        angles: [
          { id: 'correctness', brief: 'b', practices: [{ name: 'p', source: 'https://example.org' }], items: ['i1'] },
          { id: 'tests', brief: 'b', practices: [], items: [] },
        ],
        door: { kind: 'one-way', reasons: ['A migration.'] },
        uiux: { touches: true, reason: 'The greeting is shown.', screens: ['home'] },
      }),
    )
    expect(plan.ok).toBe(true)
    expect(parseChallenge(fenced({ challenges: [{ point: 'p1', concede: true, case: 'Fair.', evidence: [] }] })).ok).toBe(true)
    const judged = parseJudge(fenced({ rulings: [{ point: 'p1', ruling: 'required', reason: 'A bug.' }], verdict: 'request-changes', visionFit: 'Fits.', summary: 'One fix.', diagrams: [] }))
    expect(judged.ok).toBe(true)
    expect(parseJudge(fenced({ rulings: [], verdict: 'merge', visionFit: '', summary: '' })).ok).toBe(false)
  })
})
