import { describe, expect, test } from 'bun:test'

import { parseJudgement, parsePlan, parseVerdict, requiredPoints, splitAngles } from '../review/parse.ts'

describe('the planner\'s angles', () => {
  const plan = ['# Plan', '', '## Angles', '- security: the token handling in auth.ts', '- `data-migration`: old rows keep their theme', '- ux_copy — the toggle\'s label', '', '## Why these', '- not a list'].join('\n')

  test('are read from "## Angles", one "- id: brief" per line', () => {
    const read = parsePlan(plan)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.map((a) => a.id)).toEqual(['security', 'data-migration', 'ux-copy'])
    expect(read.value[0]!.brief).toBe('the token handling in auth.ts')
    expect(read.value.every((a) => a.by === 'planner')).toBe(true)
  })

  test('a plan with none, too many, a repeat, or missing what the person asked for is refused in a sentence', () => {
    expect(parsePlan('# Plan\nnothing').ok).toBe(false)
    expect(parsePlan('## Angles\n').ok).toBe(false)
    expect(parsePlan(`## Angles\n${Array.from({ length: 7 }, (_, i) => `- a${i}: b`).join('\n')}`).ok).toBe(false)
    expect(parsePlan('## Angles\n- tests: a\n- tests: b').ok).toBe(false)
    const missing = parsePlan(plan, ['security', 'performance'])
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.why).toContain('performance')
  })

  test('angles the person asked for are marked theirs', () => {
    const read = parsePlan(plan, ['security'])
    expect(read.ok && read.value.find((a) => a.id === 'security')?.by).toBe('person')
  })

  test('--angles is split off what the person typed', () => {
    expect(splitAngles('add dark mode --angles a11y,tests')).toEqual({ feature: 'add dark mode', angles: ['a11y', 'tests'], bad: null })
    expect(splitAngles('add dark mode').angles).toBeNull()
    expect(splitAngles('x --angles Bad_Id!').bad).not.toBeNull()
  })
})

describe('a review\'s verdict', () => {
  test('is the "Verdict:" line', () => {
    expect(parseVerdict('# Review\nVerdict: CHANGES\n## Points')).toEqual({ ok: true, value: 'changes' })
    expect(parseVerdict('**Verdict:** approve')).toEqual({ ok: true, value: 'approve' })
    expect(parseVerdict('looks fine').ok).toBe(false)
  })
})

describe('the judge\'s rulings', () => {
  const judgement = [
    '## Rulings',
    '- required | security | The token is logged in plain text at auth.ts:42.',
    '- optional | tests | A test for the empty name would be nice.',
    '- rejected | tests | Renaming greet() is taste; the counter-argument holds.',
    '',
    '## Ruling',
    'changes',
  ].join('\n')

  test('are parsed per point, and only the required ones go back to the builder', () => {
    const read = parseJudgement(judgement, ['security', 'tests'])
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.points.map((p) => p.ruling)).toEqual(['required', 'optional', 'rejected'])
    expect(requiredPoints(read.value)).toEqual([{ angle: 'security', point: 'The token is logged in plain text at auth.ts:42.' }])
    expect(read.value.final).toBe('changes')
  })

  test('a required point means changes whatever the last word says; "changes" with nothing required is refused', () => {
    const merge = parseJudgement(judgement.replace('\nchanges', '\nmerge'), ['security', 'tests'])
    expect(merge.ok && merge.value.final).toBe('changes')
    const empty = parseJudgement('## Rulings\n- optional | tests | x\n\nRuling: changes', ['tests'])
    expect(empty.ok).toBe(false)
  })

  test('the last ruling may be merge or hand-over, as a section or a line', () => {
    expect(parseJudgement('## Rulings\n\n## Ruling\nhand-over\nThe migration is irreversible.', ['tests'])).toEqual({ ok: true, value: { points: [], final: 'hand-over' } })
    expect(parseJudgement('Ruling: merge', ['tests'])).toEqual({ ok: true, value: { points: [], final: 'merge' } })
    expect(parseJudgement('## Rulings\n- required | tests | x', ['tests']).ok).toBe(false)
  })

  test('a ruling on an angle the job does not have is refused', () => {
    expect(parseJudgement('## Rulings\n- required | perf | x\n\nRuling: changes', ['tests']).ok).toBe(false)
    expect(parseJudgement('## Rulings\n- required | general | x\n\nRuling: changes', ['tests']).ok).toBe(true)
  })
})
