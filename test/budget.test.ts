import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { editBudget, sizeBudget, spentSince } from '../rev/budget.ts'
import { write } from './repo.ts'

const row = (id: string, at: string, usage: Record<string, number>) => JSON.stringify({ type: 'assistant', timestamp: at, message: { id, usage } })

describe('the budget', () => {
  test('is sized from the change, and the person can change it', () => {
    expect(sizeBudget(2, 40)).toMatchObject({ size: 'small', pointsPerReviewer: 4 })
    expect(sizeBudget(12, 400)).toMatchObject({ size: 'medium', pointsPerReviewer: 6 })
    expect(sizeBudget(40, 2000)).toMatchObject({ size: 'large', pointsPerReviewer: 8 })
    const edited = editBudget(sizeBudget(2, 40), 'points=3 tokens=80k')
    expect(edited).toMatchObject({ ok: true, budget: { pointsPerReviewer: 3, tokens: 80_000, filesBeyondDiff: 5 } })
    expect(editBudget(sizeBudget(2, 40), 'lots').ok).toBe(false)
  })

  test('spend is read from the transcript and its subagents, each message once, since the step began', () => {
    const dir = mkdtempSync(join(tmpdir(), 'factory-claude-spend-'))
    const session = 'session-spend-0001'
    const main = join(dir, 'projects', '-p', `${session}.jsonl`)
    write(main, [
      row('m0', '2026-10-21T11:00:00.000Z', { input_tokens: 999, output_tokens: 1 }),
      row('m1', '2026-10-21T12:00:01.000Z', { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000 }),
      row('m1', '2026-10-21T12:00:01.000Z', { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000 }),
      'not json',
    ].join('\n'))
    write(join(dir, 'projects', '-p', session, 'subagents', 'agent-a.jsonl'), row('s1', '2026-10-21T12:01:00.000Z', { input_tokens: 300, output_tokens: 30, cache_creation_input_tokens: 70 }))
    expect(spentSince(session, '2026-10-21T12:00:00.000Z', dir)).toEqual({ tokens: 520, cached: 5000 })
    expect(spentSince('session-none-0001', '2026-10-21T12:00:00.000Z', dir)).toEqual({ tokens: 0, cached: 0 })
  })
})
