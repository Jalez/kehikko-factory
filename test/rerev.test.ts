import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TrackerRow } from 'kehikot-module-protocol'

import { ask, readQuestions, ruleFor, setRule } from '../rev/authors.ts'
import { backgroundArgs, startBackground } from '../rev/background.ts'
import { newRun } from '../rev/flow.ts'
import { due, parseRule, ruleSaid } from '../rev/rerev.ts'
import { DEFAULT_RULE_SENTENCE, type Run } from '../rev/shape.ts'
import { CHANGE } from './fixtures.ts'
import { scratchRepo } from './repo.ts'

let repo: ReturnType<typeof scratchRepo> | null = null
afterEach(() => {
  repo?.done()
  repo = null
})

const NOW = Date.parse('2026-10-21T18:00:00.000Z')
const row = (over: Partial<TrackerRow> = {}): TrackerRow => ({
  ref: 'gh#7', tracker: 'github', host: 'github.com', repo: 'me/app', number: 7, kind: 'change', state: 'open', title: 'Shout', url: CHANGE.url,
  labels: [], assignees: [], links: [], readAt: '2026-10-21T18:00:00.000Z', ...over,
})
const last = (over: Partial<Run> = {}): Run => ({
  ...newRun({ id: 'app-7-a1b2', change: CHANGE, session: null, place: null, now: '2026-10-21T12:00:00.000Z' }),
  stage: 'sent',
  sent: { at: '2026-10-21T12:30:00.000Z', by: 'person' },
  pinned: { head: 'h1', base: 'b', mergeBase: 'm', previousHead: null, at: '2026-10-21T12:00:00.000Z' },
  ...over,
})

describe('when to review again', () => {
  test('sentences parse into signals, and an unreadable one is refused with examples', () => {
    const parsed = parseRule(DEFAULT_RULE_SENTENCE)
    expect(parsed).toEqual({ ok: true, rule: { any: [{ kind: 're-request' }, { kind: 'after-push', hours: 2, answered: true }] } })
    expect(parseRule("when they comment 'ready'")).toEqual({ ok: true, rule: { any: [{ kind: 'comment', word: 'ready' }] } })
    expect(parseRule('when the label `ready-for-review` is added')).toEqual({ ok: true, rule: { any: [{ kind: 'label', label: 'ready-for-review' }] } })
    expect(parseRule('only when I ask')).toEqual({ ok: true, rule: { any: [{ kind: 'manual' }] } })
    expect(parseRule('run a re-review 30 minutes after the last push, if there are new commits')).toMatchObject({ ok: true, rule: { any: [{ kind: 'after-push', hours: 0.5 }] } })
    const bad = parseRule('when the moon is full')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.why).toContain('Try:')
    if (parsed.ok) expect(ruleSaid(parsed.rule)).toContain('re-request')
  })

  test('each signal, from the host\'s 2.7.0 row', () => {
    const rule = (s: string) => {
      const p = parseRule(s)
      if (!p.ok) throw new Error(p.why)
      return p.rule
    }
    expect(due(rule('when they re-request review'), row({ myRoles: ['reviewer-asked'] }), last(), NOW).due).toBe(true)
    expect(due(rule('when they re-request review'), row({ myRoles: ['reviewer-done'] }), last(), NOW).due).toBe(false)
    const pushed = row({ lastPushAt: '2026-10-21T15:00:00.000Z', discussions: { resolved: 2, unresolved: 0 } })
    expect(due(rule('2 hours after the last push with new commits and every point answered'), pushed, last(), NOW).due).toBe(true)
    expect(due(rule('2 hours after the last push with new commits and every point answered'), { ...pushed, discussions: { resolved: 1, unresolved: 1 } }, last(), NOW).due).toBe(false)
    expect(due(rule('5 hours after the last push'), pushed, last(), NOW).due).toBe(false)
    expect(due(rule("when they comment 'ready'"), row(), last(), NOW, [{ author: 'alice', body: 'Ready for another look', at: '2026-10-21T13:00:00.000Z' }]).due).toBe(true)
    expect(due(rule('when the label ready is added'), row({ labels: ['ready'], lastPushAt: '2026-10-21T13:00:00.000Z' }), last(), NOW).due).toBe(true)
    expect(due(rule('only when I ask'), row({ myRoles: ['reviewer-asked'] }), last(), NOW).due).toBe(false)
  })

  test('three rounds at most, and never while the last review is still running or the change is closed', () => {
    const r = parseRule('when they re-request review')
    if (!r.ok) throw new Error(r.why)
    expect(due(r.rule, row({ myRoles: ['reviewer-asked'] }), last({ round: 3 }), NOW)).toMatchObject({ due: false, why: expect.stringContaining('3 times') })
    expect(due(r.rule, row({ myRoles: ['reviewer-asked'] }), last({ stage: 'reviewing', sent: null }), NOW).due).toBe(false)
    expect(due(r.rule, row({ state: 'merged', myRoles: ['reviewer-asked'] }), last(), NOW).due).toBe(false)
  })

  test('rules per author: this project over all projects; the question is asked once', () => {
    repo = scratchRepo()
    expect(setRule(repo.root, 'dora', 'when they re-request review', true, '2026-10-21T12:00:00.000Z').ok).toBe(true)
    expect(ruleFor(repo.root, 'dora')?.sentence).toBe('when they re-request review')
    const machine = join(process.env.KEHIKOT_FACTORY_DIR!, 'author-rules.json')
    expect(existsSync(machine)).toBe(true)
    expect(readFileSync(machine, 'utf8')).toContain('dora')
    expect(setRule(repo.root, 'bob', 'whenever', false, 'x').ok).toBe(false)
    expect(ask(repo.root, { author: 'carol', ref: 'gh#7', url: CHANGE.url, run: 'app-7-a1b2', askedAt: 'x' })).toBe(true)
    expect(ask(repo.root, { author: 'carol', ref: 'gh#8', url: CHANGE.url, run: 'app-8-a1b2', askedAt: 'x' })).toBe(false)
    expect(readQuestions(repo.root).length).toBe(1)
  })

  test('a background session is claude --bg with a fixed argv', async () => {
    const run = { id: 'app-7-a1b2', change: { ref: 'gh#7', title: 'Shout; rm -rf ~' }, round: 2 }
    expect(backgroundArgs(run)).toEqual(['--bg', '--name=Re-review 2: gh#7 Shout; rm -rf ~', '/review-factory resume app-7-a1b2'])
    const seen: unknown[] = []
    await startBackground('/p', run, async (program, args, cwd) => {
      seen.push([program, args, cwd])
      return { ok: true }
    })
    expect(seen).toEqual([['claude', backgroundArgs(run), '/p']])
    expect(() => backgroundArgs({ ...run, id: '../x' })).toThrow()
  })
})
