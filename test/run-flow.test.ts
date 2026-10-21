import { describe, expect, test } from 'bun:test'

import { advanceRun, newRun, runIsRunning, type RunEvent } from '../rev/flow.ts'
import type { Run, RunPoint } from '../rev/shape.ts'
import { CHANGE } from './fixtures.ts'

const NOW = '2026-10-21T12:00:00.000Z'

const go = (run: Run, event: RunEvent): Run => {
  const moved = advanceRun(run, event, NOW)
  if (!moved.ok) throw new Error(moved.why)
  return moved.run
}

const plan = (proposed = false): RunEvent => ({
  kind: 'planned',
  plan: {
    angles: [
      { id: 'correctness', brief: 'b', by: 'planner', practices: [], items: [] },
      { id: 'tests', brief: 'b', by: 'planner', practices: [], items: [] },
    ],
    door: { kind: 'two-way', reasons: ['Cheap to undo.'], rule: null },
    uiux: { touches: false, reason: '', screens: [], shots: false },
  },
  proposed: proposed ? ['Has a test'] : null,
  general: [],
})

function gathered(run: Run, checklists: Run['checklists'] = []): Run {
  return go(go(run, { kind: 'gathering' }), {
    kind: 'gathered',
    pinned: { head: 'h1', base: 'b1', mergeBase: 'm1', previousHead: null, at: NOW },
    checkout: { path: '/w/review', present: true },
    budget: { size: 'small', files: 1, lines: 2, pointsPerReviewer: 4, filesBeyondDiff: 5, tokens: 150_000 },
    change: CHANGE,
    vision: { epic: null, said: 'In no epic.' },
    checklists,
  })
}

const point = { id: 'p1', path: 'a.ts', side: 'new', line: 1, quote: 'x', claim: 'c', why: 'w', suggestion: 's', severity: 'risk', evidence: [], checklist: [], angles: ['tests'], also: [] } as RunPoint
const reviewed = (points: RunPoint[]): RunEvent => ({ kind: 'reviewed', points, rejected: [], skipped: [], answers: [], reviewersClose: [false, false], notes: [] })
const judged = (diagrams: boolean, drawable: boolean): RunEvent => ({
  kind: 'judged',
  result: { rulings: [{ point: 'p1', ruling: 'optional', reason: 'r' }], verdict: 'approve', pathToSuccess: [], notes: [] },
  visionFit: 'Fits.',
  summary: 'Fine.',
  close: null,
  diagrams: diagrams ? [{ point: 'p1', kind: 'graph', now: 'a', proposed: 'b' }] : [],
  drawable,
})
const drafted = (sent: boolean): RunEvent => ({ kind: 'drafted', drafted: { at: NOW, comments: 1, refused: [], proposal: true, ticks: 0, briefing: 'none' }, notes: [], sent })

describe('a review run', () => {
  const fresh = () => newRun({ id: 'app-7-a1b2', change: CHANGE, session: 'session-1', place: null, now: NOW })

  test('queued → gathering → planning → reviewing → challenging → judging → waiting', () => {
    let run = gathered(fresh())
    expect(run.stage).toBe('planning')
    run = go(run, plan())
    expect(run.stage).toBe('reviewing')
    run = go(run, reviewed([point]))
    expect(run.stage).toBe('challenging')
    run = go(run, { kind: 'challenged', challenges: [{ point: 'p1', concede: true, case: '', evidence: [] }], adversaryCloses: false })
    expect(run.stage).toBe('judging')
    run = go(run, judged(false, true))
    expect(run.stage).toBe('judging')
    run = go(run, drafted(false))
    expect(run.stage).toBe('waiting')
    expect(run.waiting?.why).toBe('drafted')
    expect(run.session).toBeNull()
    expect(go(run, { kind: 'sent', by: 'person' }).stage).toBe('sent')
  })

  test('a proposed checklist holds the run in planning, waiting for the person', () => {
    const run = go(gathered(fresh()), plan(true))
    expect(run.stage).toBe('planning')
    expect(run.waiting?.why).toBe('checklist')
    expect(runIsRunning(run)).toBe(false)
    const on = go(run, { kind: 'checklist', checklists: [{ id: 'c1', name: 'n', items: [] }], angles: run.plan!.angles })
    expect(on.stage).toBe('reviewing')
    expect(on.waiting).toBeNull()
  })

  test('a proposed checklist is not waited for when one is already held', () => {
    expect(go(gathered(fresh(), [{ id: 'c1', name: 'n', items: [] }]), plan(true)).stage).toBe('reviewing')
  })

  test('no surviving point skips the adversary', () => {
    expect(go(go(gathered(fresh()), plan()), reviewed([])).stage).toBe('judging')
  })

  test('diagrams only when asked for and possible; a two-way post goes straight to sent', () => {
    const at = go(go(go(go(gathered(fresh()), plan()), reviewed([point])), { kind: 'challenged', challenges: [], adversaryCloses: false }), judged(true, true))
    expect(at.stage).toBe('diagrams')
    expect(go(at, drafted(true)).stage).toBe('sent')
    const not = go(go(go(go(gathered(fresh()), plan()), reviewed([point])), { kind: 'challenged', challenges: [], adversaryCloses: false }), judged(true, false))
    expect(not.stage).toBe('judging')
  })

  test('angles change only before the reviewers start; a moved head stops at waiting', () => {
    const planned = go(gathered(fresh()), plan())
    expect(advanceRun(planned, { kind: 'angles', angles: planned.plan!.angles }, NOW).ok).toBe(false)
    const moved = go(planned, { kind: 'moved-on', head: 'h2' })
    expect(moved.waiting?.why).toBe('moved-on')
    expect(moved.waiting?.said).toContain('re-run to review the new commits')
  })
})
