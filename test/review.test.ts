import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { angleFor } from '../review/angles.ts'
import { counterPrompt, judgePrompt, reviewerPrompt, type Subject } from '../review/prompts.ts'
import { contested, ruleOn } from '../review/rules.ts'

const subject: Subject = {
  spec: '/r/spec.md',
  change: 'the diff of !7',
  round: 1,
  lastRound: 3,
  files: { plan: '/r/plan.md', review: (a) => `/r/review-${a}.md`, counter: (a) => `/r/counter-${a}.md`, judgement: '/r/judgement.md' },
  only: 'Write only your file.',
  after: 'You post nothing.',
}
const points = (rulings: ('required' | 'optional' | 'rejected')[], final: 'merge' | 'hand-over' | 'changes' = 'merge') => ({
  final,
  points: rulings.map((ruling, i) => ({ ruling, angle: 'tests', point: `p${i}` })),
})

describe('the review machinery, apart from Factory', () => {
  test('the judge\'s rules: required points go back while rounds remain, then to the person; otherwise its last word', () => {
    expect(ruleOn(points(['required', 'optional', 'rejected'], 'changes'), 1, 3)).toEqual({ kind: 'rework', required: [{ angle: 'tests', point: 'p0' }] })
    expect(ruleOn(points(['required'], 'changes'), 3, 3)).toEqual({ kind: 'decide', required: [{ angle: 'tests', point: 'p0' }] })
    expect(ruleOn(points(['optional']), 1, 3)).toEqual({ kind: 'approve' })
    expect(ruleOn(points([], 'hand-over'), 1, 3)).toEqual({ kind: 'hand-over' })
    expect(contested({ security: 'changes', tests: 'approve' })).toEqual(['security'])
  })

  test('its prompts take any subject: the caller says where things are', () => {
    const angle = angleFor('security')
    expect(reviewerPrompt(subject, angle)).toContain('Write /r/review-security.md')
    expect(counterPrompt(subject, angle)).toContain('/r/counter-security.md')
    expect(judgePrompt(subject, [angle], ['security'])).toContain('You post nothing.')
    expect(reviewerPrompt(subject, angle)).not.toMatch(/factory|worktree|merge it/i)
  })

  test('review/ imports nothing from the rest of this module, so it can be lifted out', () => {
    const dir = join(import.meta.dir, '..', 'review')
    for (const name of readdirSync(dir)) {
      const imports = [...readFileSync(join(dir, name), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!)
      expect(imports.filter((one) => one.startsWith('.') && !one.startsWith('./'))).toEqual([])
    }
  })
})
