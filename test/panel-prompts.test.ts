import { describe, expect, test } from 'bun:test'

import { adversaryPrompt, diagramPrompt, panelJudgePrompt, panelPlannerPrompt, panelReviewerPrompt, type PanelSubject } from '../review/prompts.ts'

const subject = (over: Partial<PanelSubject> = {}): PanelSubject => ({
  change: 'gh:me/app#7 — Shout',
  packet: '/r/packet.md',
  diff: '/r/diff.patch',
  checkout: '/w/review-x',
  head: 'abc1234',
  files: {
    plan: '/r/plan.md',
    review: (angle) => `/r/review-${angle}.md`,
    points: '/r/points.md',
    challenge: '/r/challenge.md',
    judgement: '/r/judgement.md',
    diagrams: '/r/diagrams.md',
    briefing: '/r/briefing.md',
  },
  budget: { pointsPerReviewer: 6, filesBeyondDiff: 10 },
  runTests: null,
  round: 1,
  listed: [],
  only: 'Write only the file this prompt names.',
  ...over,
})

describe('the panel\'s prompts', () => {
  test('the planner splits the checklist, or proposes one, and classifies the door with the project\'s rule', () => {
    const split = panelPlannerPrompt(subject(), { doorRule: 'Anything under migrations/ is one-way.', items: [{ checklist: 'c1', item: 'i1', text: 'Has a test' }], asked: null })
    expect(split).toContain('Write /r/plan.md')
    expect(split).toContain('c1/i1: Has a test')
    expect(split).toContain('Anything under migrations/ is one-way.')
    expect(split).not.toContain('proposedChecklist')
    const none = panelPlannerPrompt(subject(), { doorRule: null, items: [], asked: null })
    expect(none).toContain('at most 15 items')
    expect(none).toContain('"proposedChecklist"')
    expect(none).toContain('When in doubt it is one-way.')
  })

  test('a reviewer is read-only unless the switch is on, and is held to anchors, sources, length and the cap', () => {
    const text = panelReviewerPrompt(subject(), { id: 'security', brief: 'Inputs.', practices: [] }, [{ checklist: 'c1', item: 'i1', text: 'Has a test' }])
    expect(text).toContain('you run nothing')
    expect(text).toContain('At most 6 points')
    expect(text).toContain('under 600 characters')
    expect(text).toContain('Copy those lines exactly into "quote"')
    expect(text).toContain('c1/i1: Has a test')
    expect(text).toContain('Write /r/review-security.md')
    const tests = panelReviewerPrompt(subject({ runTests: 'You may run only `bun test`, in the checkout.' }), { id: 'tests', brief: 'b', practices: [] }, [])
    expect(tests).toContain('You may run only `bun test`')
  })

  test('a re-review judges only the delta and the listed points', () => {
    const text = panelReviewerPrompt(subject({ round: 2, delta: '/r/delta.patch', listed: [{ id: 'p1', text: 'Uppercase the name.' }] }), { id: 'c', brief: 'b', practices: [] }, [])
    expect(text).toContain('re-review round 2')
    expect(text).toContain('/r/delta.patch')
    expect(text).toContain('p1: Uppercase the name.')
    expect(text).toContain('Do not move the goalposts')
  })

  test('the adversary, the judge and the diagram agent', () => {
    expect(adversaryPrompt(subject(), { closeAsked: false })).toContain('/r/points.md')
    const judge = panelJudgePrompt(subject(), { vision: false, oneWay: true, challenged: true, closeAsked: false })
    expect(judge).toContain('in no epic')
    expect(judge).toContain('At most THREE')
    expect(judge).toContain('/r/briefing.md')
    expect(judge).toContain('Do not ask to close')
    const draw = diagramPrompt(subject(), { project: '/p', epic: 'greetings', runId: 'app-7-a1b2', requests: [{ point: 'p1', kind: 'sequence', now: 'a then b', proposed: 'b then a' }] })
    expect(draw).toContain('write_flow')
    expect(draw).toContain('epic greetings')
  })
})
