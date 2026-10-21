import { describe, expect, test } from 'bun:test'

import { doorByRules, globMatches, hasBeforeAfter, settleDoor } from '../rev/doors-rule.ts'
import type { DoorRule } from '../rev/shape.ts'

const rules: DoorRule[] = [
  { kind: 'path', glob: 'migrations/', door: 'one-way' },
  { kind: 'path', glob: '**/*.sql', door: 'one-way' },
  { kind: 'label', label: 'two-way', door: 'two-way' },
]

describe('one-way or two-way', () => {
  test('globs as people write them', () => {
    expect(globMatches('migrations/', 'db/migrations/001.ts')).toBe(true)
    expect(globMatches('**/*.sql', 'a/b/c.sql')).toBe(true)
    expect(globMatches('*.md', 'docs/a.md')).toBe(true)
    expect(globMatches('src/*.ts', 'src/a/b.ts')).toBe(false)
  })

  test('the project\'s rules decide first; one-way wins; the planner can only make it stricter', () => {
    expect(doorByRules(rules, ['migrations/001.ts'], ['two-way']).door).toBe('one-way')
    expect(doorByRules(rules, ['src/a.ts'], ['Two-Way']).door).toBe('two-way')
    expect(doorByRules(rules, ['src/a.ts'], []).door).toBeNull()
    const loose = settleDoor(doorByRules(rules, ['src/a.ts'], ['two-way']), { kind: 'one-way', reasons: ['Changes auth.'] })
    expect(loose.kind).toBe('one-way')
    const strict = settleDoor(doorByRules(rules, ['migrations/1.ts'], []), { kind: 'two-way', reasons: ['Small.'] })
    expect(strict).toMatchObject({ kind: 'one-way', rule: expect.stringContaining('migrations/') })
    expect(settleDoor({ door: null, said: [] }, { kind: 'two-way', reasons: ['Small.'] })).toEqual({ kind: 'two-way', reasons: ['Small.'], rule: null })
  })

  test('before and after pictures are found in the description or a comment', () => {
    expect(hasBeforeAfter(['Before:\n![b](https://github.com/x/b.png)\n\nAfter:\n![a](https://github.com/x/a.png)'])).toBe(true)
    expect(hasBeforeAfter(['![one](https://github.com/x/b.png)'])).toBe(false)
    expect(hasBeforeAfter(['before <img src="https://x/b.png">', 'and after <img src="https://x/a.png">'])).toBe(true)
  })
})
