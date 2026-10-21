import { describe, expect, test } from 'bun:test'

import { advance, anglesOpen, newJob, type Event } from '../job/flow.ts'
import { DEFAULT_SETTINGS, LAST_AUTOMATIC_ROUND, MAX_RESUMES, type Job, type Settings } from '../job/shape.ts'

const NOW = '2026-10-21T12:00:00.000Z'
const GIT = { main: 'main', base: 'abc', branch: 'factory/x-a1b2', worktree: '/tmp/app-factory/x-a1b2', present: true }
const ANGLES = [
  { id: 'security', brief: 'b', by: 'planner' as const },
  { id: 'tests', brief: 'b', by: 'planner' as const },
]

function fresh(): Job {
  return newJob({ id: 'add-dark-mode-a1b2', title: 'Add dark mode', feature: 'Add dark mode', anglesAsked: null, place: null, session: 'session-1234', now: NOW })
}

function go(job: Job, event: Event, settings: Settings = DEFAULT_SETTINGS): Job {
  const moved = advance(job, event, settings, NOW)
  if (!moved.ok) throw new Error(moved.why)
  return moved.job
}

const judged = (required: number, final: 'merge' | 'hand-over' | 'changes' = required ? 'changes' : 'merge') => ({
  kind: 'judge' as const,
  judged: {
    final,
    points: [
      ...Array.from({ length: required }, (_, i) => ({ ruling: 'required' as const, angle: 'security', point: `fix ${i}` })),
      { ruling: 'optional' as const, angle: 'tests', point: 'a nicer test' },
      { ruling: 'rejected' as const, angle: 'tests', point: 'rename everything' },
    ],
  },
})

/** A job through spec, plan, worktree and its first build, into review round 1. */
function built(): Job {
  let job = go(fresh(), { kind: 'spec' })
  job = go(job, { kind: 'plan', angles: ANGLES })
  job = go(job, { kind: 'worktree', git: GIT })
  return go(job, { kind: 'build' })
}

describe('a job moves through its stages', () => {
  test('spec → plan → build (round 1) → review', () => {
    let job = fresh()
    expect(job.stage).toBe('spec')
    job = go(job, { kind: 'spec' })
    expect(job.stage).toBe('plan')
    job = go(job, { kind: 'plan', angles: ANGLES })
    expect([job.stage, job.round, job.angles.map((a) => a.id)]).toEqual(['build', 1, ['security', 'tests']])
    job = go(job, { kind: 'worktree', git: GIT })
    job = go(job, { kind: 'build' })
    expect(job.stage).toBe('review')
  })

  test('a step out of order is refused', () => {
    expect(advance(fresh(), { kind: 'build' }, DEFAULT_SETTINGS, NOW).ok).toBe(false)
    expect(advance(fresh(), { kind: 'approve', by: 'person' }, DEFAULT_SETTINGS, NOW).ok).toBe(false)
  })

  test('review goes to the counter-arguers only when a reviewer asked for changes', () => {
    expect(go(built(), { kind: 'review', verdicts: { security: 'approve', tests: 'approve' } }).stage).toBe('judge')
    expect(go(built(), { kind: 'review', verdicts: { security: 'changes', tests: 'approve' } }).stage).toBe('counter')
    expect(advance(built(), { kind: 'review', verdicts: { security: 'approve' } }, DEFAULT_SETTINGS, NOW).ok).toBe(false)
  })

  test('only the points the judge required go back to the builder', () => {
    let job = go(built(), { kind: 'review', verdicts: { security: 'changes', tests: 'changes' } })
    job = go(job, { kind: 'counter' })
    job = go(job, judged(1))
    expect(job.stage).toBe('build')
    expect(job.round).toBe(2)
    expect(job.required).toEqual([{ angle: 'security', point: 'fix 0' }])
  })

  test(`the builder is resumed at most ${MAX_RESUMES} times; then the job is the person's`, () => {
    let job = built()
    for (let round = 1; round <= LAST_AUTOMATIC_ROUND; round++) {
      job = go(job, { kind: 'review', verdicts: { security: 'changes', tests: 'approve' } })
      job = go(job, { kind: 'counter' })
      job = go(job, judged(2))
      if (round < LAST_AUTOMATIC_ROUND) {
        expect([job.stage, job.round]).toEqual(['build', round + 1])
        job = go(job, { kind: 'build' })
      }
    }
    expect(job.stage).toBe('waiting')
    expect(job.waiting?.why).toBe('still-required')
    expect(job.round).toBe(LAST_AUTOMATIC_ROUND)
    expect(job.history.filter((h) => h.said.startsWith('Built')).length).toBe(1 + MAX_RESUMES)
    expect(job.required.length).toBe(2)
  })

  test('an approved job is handed to the person by default', () => {
    const job = go(go(built(), { kind: 'review', verdicts: { security: 'approve', tests: 'approve' } }), judged(0, 'merge'))
    expect(job.stage).toBe('waiting')
    expect(job.waiting?.why).toBe('judge-approved')
    expect(job.session).toBeNull()
  })

  test('with the switch on, the judge merges an approved job; hand-over still goes to the person', () => {
    const on = { ...DEFAULT_SETTINGS, judgeMerges: true }
    const ready = go(built(), { kind: 'review', verdicts: { security: 'approve', tests: 'approve' } })
    const merging = advance(ready, judged(0, 'merge'), on, NOW)
    expect(merging.ok && merging.merge).toBe('judge')
    const handed = advance(ready, judged(0, 'hand-over'), on, NOW)
    expect(handed.ok && handed.merge).toBe(null)
    expect(handed.ok && handed.job.waiting?.why).toBe('judge-hand-over')
  })

  test('approve asks for a merge by the person; merged and refused land where they should', () => {
    const waiting = go(go(built(), { kind: 'review', verdicts: { security: 'approve', tests: 'approve' } }), judged(0))
    const asked = advance(waiting, { kind: 'approve', by: 'person' }, DEFAULT_SETTINGS, NOW)
    expect(asked.ok && asked.merge).toBe('person')
    expect(go(waiting, { kind: 'merged', commit: 'f00', by: 'person', cleaned: true, left: null }).stage).toBe('merged')
    const refused = go(waiting, { kind: 'merge-refused', why: 'main moved and the merge conflicts.' })
    expect([refused.stage, refused.waiting?.why]).toEqual(['waiting', 'merge-refused'])
  })

  test('send back from the board waits for /factory next; rework typed builds at once', () => {
    const waiting = go(go(built(), { kind: 'review', verdicts: { security: 'approve', tests: 'approve' } }), judged(0))
    const sent = go(waiting, { kind: 'rework', note: 'use the system theme', now: false })
    expect([sent.stage, sent.waiting?.why, sent.note]).toEqual(['waiting', 'sent-back', 'use the system theme'])
    expect(advance(sent, { kind: 'approve', by: 'person' }, DEFAULT_SETTINGS, NOW).ok).toBe(false)
    const resumed = go(sent, { kind: 'resume', session: 'session-5678' })
    expect([resumed.stage, resumed.round, resumed.session]).toEqual(['build', 2, 'session-5678'])
    const now = go(waiting, { kind: 'rework', note: 'smaller', now: true })
    expect([now.stage, now.round]).toEqual(['build', 2])
    expect(advance(waiting, { kind: 'rework', note: '  ', now: true }, DEFAULT_SETTINGS, NOW).ok).toBe(false)
  })

  test('the angles can change until the reviews start, and the person\'s set wins over the planner\'s', () => {
    const job = fresh()
    expect(anglesOpen(job)).toBe(true)
    const mine = go(go(job, { kind: 'spec' }), { kind: 'angles', angles: [{ id: 'accessibility', brief: 'b', by: 'person' }] })
    expect(go(mine, { kind: 'plan', angles: ANGLES }).angles.map((a) => a.id)).toEqual(['accessibility'])
    expect(anglesOpen(built())).toBe(false)
    expect(advance(built(), { kind: 'angles', angles: ANGLES }, DEFAULT_SETTINGS, NOW).ok).toBe(false)
  })

  test('a failed job stays failed, and only settled jobs are cleared', () => {
    const failed = go(built(), { kind: 'fail', why: 'no tests ran' })
    expect(failed.stage).toBe('failed')
    expect(advance(failed, { kind: 'fail', why: 'again' }, DEFAULT_SETTINGS, NOW).ok).toBe(false)
    expect(go(failed, { kind: 'archive' }).archived).toBe(true)
    expect(advance(built(), { kind: 'archive' }, DEFAULT_SETTINGS, NOW).ok).toBe(false)
  })
})
