import { describe, expect, test } from 'bun:test'

import { newRun } from '../rev/flow.ts'
import { AGENT_NAME, CHECKLIST, checklistsHeld, createChecklist, draftToReview, parseList, proposeBriefing, REVIEW, setStates, summaryOf } from '../rev/neighbours.ts'
import type { Run } from '../rev/shape.ts'
import { CHANGE } from './fixtures.ts'
import { LIST, standIn } from './stand-ins.ts'

describe('Checklist, through its door', () => {
  test('its print reads as states, and a person\'s tick is told from an agent\'s', () => {
    const list = parseList(LIST)!
    expect(list.id).toBe('c1')
    expect(list.items.map((one) => [one.id, one.state, one.byPerson, one.by ?? null])).toEqual([
      ['i1', 'passed', true, 'Jaakko'],
      ['i2', 'failed', false, AGENT_NAME],
      ['i3', null, false, null],
    ])
    expect(list.items[2]!.text).toBe('No new dependency')
    expect(list.items[0]!.note).toBe('greet.test.js')
  })

  test('only the lists held against the change are read', async () => {
    const { n, calls } = standIn()
    const held = await checklistsHeld(n, '/p', ['gh#7', 'gh:me/app#7'])
    expect(held.lists.map((one) => one.id)).toEqual(['c1'])
    expect(held.ref).toBe('gh#7')
    expect(calls.filter((one) => one.args.checklist).map((one) => one.args)).toEqual([{ project: '/p', checklist: 'c1', ref: 'gh#7' }])
  })

  test('an accepted proposal is made, filled and held against the change', async () => {
    const { n, calls } = standIn()
    const made = await createChecklist(n, '/p', 'gh#7', 'Proposed for gh#7', ['Has a test', 'Docs updated'])
    expect(made.ok).toBe(true)
    expect(calls.map((one) => one.tool)).toEqual(['create_checklist', 'add_checklist_item', 'add_checklist_item', 'hold_checklist', 'checklists'])
    expect(calls[3]!.args).toMatchObject({ checklist: 'c9', ref: 'gh#7' })
  })

  test('answers are set as Factory\'s, never over the person\'s or another agent\'s; a disagreement is a note', async () => {
    const { n, calls } = standIn()
    const checklists = [parseList(LIST)!, { id: 'c3', name: 'x', items: [{ id: 'j1', text: 'Typed', state: 'passed' as const, byPerson: false, by: 'some agent' }] }]
    const answers: Run['answers'] = [
      { checklist: 'c1', item: 'i1', state: 'fail', note: 'No test for the empty name.', by: 'tests' },
      { checklist: 'c1', item: 'i2', state: 'pass', note: 'README says it.', by: 'correctness' },
      { checklist: 'c1', item: 'i3', state: 'n/a', note: 'No dependency changed.', by: 'correctness' },
      { checklist: 'c3', item: 'j1', state: 'pass', note: 'Typed.', by: 'tests' },
    ]
    const done = await setStates(n, '/p', 'gh#7', { answers, checklists })
    expect(calls.filter((one) => one.tool === 'check_item').map((one) => [one.args.item, one.args.state])).toEqual([
      ['i2', 'passed'],
      ['i3', 'na'],
    ])
    expect(done.set).toBe(2)
    expect(done.notes).toEqual([expect.stringContaining('You marked "Has a test" passed; the tests reviewer found it failed')])
  })
})

describe('Review and Paper, through their doors', () => {
  const judgedRun = (): Run => ({
    ...newRun({ id: 'app-7-a1b2', change: CHANGE, session: null, place: null, now: '2026-10-21T12:00:00.000Z' }),
    plan: { angles: [], door: { kind: 'two-way', reasons: ['x'], rule: null }, uiux: { touches: false, reason: '', screens: [], shots: false } },
    points: [
      { id: 'p1', path: 'greet.js', side: 'new', line: 2, quote: 'q', claim: 'Not loud.', why: 'Spec.', suggestion: 'Uppercase it.', severity: 'blocking', evidence: [{ kind: 'line', ref: 'greet.js:2' }], checklist: [], angles: ['correctness'], also: [] },
      { id: 'p2', path: 'greet.js', side: 'new', line: 3, quote: 'q', claim: 'Taste.', why: 'w', suggestion: 's', severity: 'nice', evidence: [{ kind: 'line', ref: 'greet.js:3' }], checklist: [], angles: ['tests'], also: [] },
    ],
    challenges: [{ point: 'p1', concede: false, case: 'It is loud enough.', evidence: [] }],
    judged: {
      rulings: [
        { point: 'p1', ruling: 'required', reason: 'A bug.' },
        { point: 'p2', ruling: 'rejected', reason: 'Taste.' },
      ],
      verdict: 'request-changes',
      visionFit: 'It fits the epic.',
      summary: 'One fix.',
      pathToSuccess: ['1. Uppercase it. (greet.js:2): Not loud.'],
      close: null,
      diagrams: [],
      notes: [],
    },
  })

  test('earlier runs\' unsent comments dropped, kept points drafted with meta, the summary proposed beside the person\'s', async () => {
    const { n, calls } = standIn()
    const done = await draftToReview(n, '/p', judgedRun(), ['app-7-0000'])
    expect(calls.map((one) => `${one.id}:${one.tool}`)).toEqual([`${REVIEW}:drop_run_comments`, `${REVIEW}:add_comment`, `${REVIEW}:propose_review`])
    expect(calls[0]!.args).toEqual({ project: '/p', change: CHANGE.url, run: 'app-7-0000' })
    expect(calls[1]!.args).toMatchObject({ path: 'greet.js', line: 2, side: 'new', meta: { run: 'app-7-a1b2', severity: 'blocking', ruling: 'required', reason: 'A bug.', challenge: 'It is loud enough.' } })
    expect(calls[2]!.args).toMatchObject({ run: 'app-7-a1b2', verdict: 'request-changes', door: 'two-way', uiux: false, pathToSuccess: ['1. Uppercase it. (greet.js:2): Not loud.'] })
    expect(String(calls[2]!.args.summary)).toContain('To get this approved:')
    expect(done).toMatchObject({ comments: 1, refused: [], proposal: true })
  })

  test('a comment Review refuses is kept with Review\'s sentence', async () => {
    const { n } = standIn({ [`${REVIEW}:add_comment`]: () => ({ ok: false, text: 'line 2 of greet.js is not in this diff.' }) })
    const done = await draftToReview(n, '/p', judgedRun(), [])
    expect(done.refused).toEqual([{ point: 'p1', why: 'line 2 of greet.js is not in this diff.' }])
  })

  test('an approving summary says nothing blocks', () => {
    const run = judgedRun()
    run.judged = { ...run.judged!, verdict: 'approve', pathToSuccess: [] }
    expect(summaryOf(run)).toContain('Nothing blocks this change.')
  })

  test('the briefing is a pending section before \\end{document}, escaped', async () => {
    const { n, calls } = standIn()
    await proposeBriefing(n, '/p', 'greetings', 'gh#7 Shout', '# Decisions\n\nUses 100% & more.')
    expect(calls[0]!.args).toMatchObject({ epic: 'greetings', find: '\\end{document}' })
    expect(String(calls[0]!.args.replace)).toContain('\\section*{Decision briefing: gh\\#7 Shout}')
    expect(String(calls[0]!.args.replace)).toContain('Uses 100\\% \\& more.')
    expect(calls.every((one) => one.id !== CHECKLIST)).toBe(true)
  })
})
