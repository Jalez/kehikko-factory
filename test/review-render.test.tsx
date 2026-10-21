import { afterEach, describe, expect, test } from 'bun:test'
import { act as react, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ActivityItem } from 'kehikot-module-protocol'

import { Screen, type Host } from '../src/app.tsx'
import { checklistProgress } from '../src/board/review-columns.ts'
import { reviewInboxItems } from '../src/board/review-inbox.ts'
import { newRun } from '../rev/flow.ts'
import { DEFAULT_REVIEW_SETTINGS, type Run } from '../rev/shape.ts'
import type { Api, BoardRun, ReviewAct, ReviewBoard } from '../src/wire/api.ts'
import { CHANGE } from './fixtures.ts'

afterEach(cleanup)

const run = (id: string, over: Partial<Run> = {}): BoardRun => ({
  ...newRun({ id, change: CHANGE, session: null, place: { epic: 'greetings' }, now: '2026-10-21T12:00:00.000Z' }),
  ...over,
  files: ['packet.md', 'draft.md'],
  lately: null,
})

const checklists: Run['checklists'] = [
  {
    id: 'c1',
    name: 'Owed',
    items: [
      { id: 'i1', text: 'Has a test', state: 'passed', byPerson: true, by: 'Jaakko' },
      { id: 'i2', text: 'Docs updated', state: null, byPerson: false },
      { id: 'i3', text: 'No new dependency', state: null, byPerson: false },
    ],
  },
]
const answers: Run['answers'] = [{ checklist: 'c1', item: 'i2', state: 'fail', note: 'README untouched.', by: 'correctness' }]

function fakeApi(reviews: ReviewBoard, acts: ReviewAct[] = []): Api {
  return {
    board: async () => ({ root: '/work/app', jobs: [], settings: { judgeMerges: false, board: null, review: DEFAULT_REVIEW_SETTINGS }, queue: [] }),
    file: async () => null,
    act: async () => 'done',
    watch: () => () => {},
    columns: async () => ({ remote: null }),
    reviews: async () => reviews,
    reviewFile: async (_p, _r, name) => `the text of ${name}`,
    reviewAct: async (_p, one) => {
      acts.push(one)
      return 'saved'
    },
  }
}

function host(over: Partial<Host> & { items?: ActivityItem[][]; asked?: unknown[] } = {}): Host {
  const items = over.items ?? []
  return {
    where: 'hosted',
    projectPath: '/work/app',
    epic: 'greetings',
    parts: [],
    header: () => {},
    activity: (list) => items.push(list),
    request: async (method, params) => {
      over.asked?.push([method, params])
      return method === 'tracker.get' ? { rows: [] } : { boards: [] }
    },
    kehikko: { id: 1, key: 'k1', name: 'Main' } as Host['kehikko'],
    containers: [{ module: 'kehikot.review', selected: false, showing: { refs: [], documents: [] } }],
    selection: ['gh#7'],
    ...over,
  }
}

const drafted = run('app-7-a1b2', {
  stage: 'waiting',
  waiting: { why: 'drafted', said: 'The draft is in Review.' },
  checklists,
  answers,
  plan: { angles: [{ id: 'correctness', brief: 'b', by: 'planner', practices: [], items: [] }, { id: 'tests', brief: 'b', by: 'planner', practices: [], items: [] }], door: { kind: 'one-way', reasons: ['A migration.'], rule: null }, uiux: { touches: true, reason: 'Shown.', screens: ['home'], shots: false } },
  judged: { rulings: [], verdict: 'request-changes', visionFit: 'It fits.', summary: 's', pathToSuccess: ['Add pictures of the home screen.'], close: null, diagrams: [], notes: [] },
})

describe('the Reviews board', () => {
  test('checklist progress reads the person\'s ticks first, then the panel\'s answers', () => {
    expect(checklistProgress(drafted)).toBe('2 of 3 checked · 1 failed')
    expect(checklistProgress(run('x-1-0000'))).toBeNull()
  })

  test('the View switch shows the nine steps as columns, cards with progress, door and UI/UX in words', async () => {
    const asked: unknown[] = []
    const acts: ReviewAct[] = []
    const reviews: ReviewBoard = { root: '/work/app', runs: [drafted, run('app-8-c3d4', { stage: 'reviewing' })], questions: [], settings: DEFAULT_REVIEW_SETTINGS }
    const press = { current: (_: { item: string; value?: string }) => undefined as unknown }
    render(<Screen host={host({ asked })} api={fakeApi(reviews, acts)} press={press as never} />)
    await waitFor(() => expect(acts.some((one) => one.act === 'seen')).toBe(true))
    expect(acts.find((one) => one.act === 'seen')).toEqual({ act: 'seen', kehikko: 'k1', modules: ['kehikot.factory', 'kehikot.review'], selection: ['gh#7'] })
    await react(async () => void press.current({ item: 'view', value: 'reviews' }))
    await waitFor(() => screen.getByTestId('review-board'))
    expect(screen.queryByTestId('review-column-diagrams')).toBeNull()
    expect(screen.getByTestId('review-column-waiting').textContent).toContain('2 of 3 checked · 1 failed')
    expect(screen.getByTestId('review-column-waiting').textContent).toContain('one-way')
    expect(screen.getByTestId('review-column-waiting').textContent).toContain('UI/UX')
    expect(screen.getByTestId('review-column-reviewing').textContent).toContain('app-8-c3d4')
    await waitFor(() => expect(asked.some((one) => (one as [string])[0] === 'tracker.get')).toBe(true))
  })

  test('a card opens the record, the checklist with notes, and "To get this approved"', async () => {
    const asked: unknown[] = []
    const reviews: ReviewBoard = { root: '/work/app', runs: [drafted], questions: [], settings: DEFAULT_REVIEW_SETTINGS }
    const press = { current: (_: { item: string; value?: string }) => undefined as unknown }
    render(<Screen host={host({ asked })} api={fakeApi(reviews)} press={press as never} />)
    await react(async () => void press.current({ item: 'view', value: 'reviews' }))
    await waitFor(() => screen.getByTestId('review-card-app-7-a1b2'))
    fireEvent.click(screen.getByTestId('review-card-app-7-a1b2'))
    await waitFor(() => expect(screen.getByTestId('review-file-text').textContent).toBe('the text of draft.md'))
    expect(screen.getByTestId('review-verdict').textContent).toContain('To get this approved:1. Add pictures of the home screen.')
    expect(screen.getByTestId('review-checklist').textContent).toContain('failed — Docs updated (correctness reviewer: README untouched.)')
    expect(screen.getByTestId('review-door').textContent).toContain('before and after pictures are missing')
    fireEvent.click(screen.getByTestId('open-in-review'))
    await waitFor(() => expect(asked).toContainEqual(['view.goto', { ref: 'gh#7' }]))
  })

  test('the first-time question: the recommended answer in one press, for this project or all', async () => {
    const acts: ReviewAct[] = []
    const question = { author: 'alice', ref: 'gh#7', url: CHANGE.url, run: 'app-7-a1b2', askedAt: '2026-10-21T12:00:00.000Z', text: "We haven't reviewed alice's work before. What's the signal that they're ready for another review?", recommended: DEFAULT_REVIEW_SETTINGS.defaultRule }
    const reviews: ReviewBoard = { root: '/work/app', runs: [drafted], questions: [question], settings: DEFAULT_REVIEW_SETTINGS }
    const press = { current: (_: { item: string; value?: string }) => undefined as unknown }
    render(<Screen host={host()} api={fakeApi(reviews, acts)} press={press as never} />)
    await react(async () => void press.current({ item: 'view', value: 'reviews' }))
    await waitFor(() => screen.getByTestId('review-card-app-7-a1b2'))
    fireEvent.click(screen.getByTestId('review-card-app-7-a1b2'))
    await waitFor(() => screen.getByTestId('author-question'))
    fireEvent.click(screen.getByTestId('accept-recommended'))
    await waitFor(() => expect(acts).toContainEqual({ act: 'author-rule', author: 'alice', sentence: DEFAULT_REVIEW_SETTINGS.defaultRule, allProjects: false }))
  })

  test('the Inbox: a draft waiting, a re-review due, the question; a running review is working', () => {
    const items = reviewInboxItems(
      [drafted, run('app-9-0000', { stage: 'queued' }), run('app-8-c3d4', { stage: 'reviewing' })],
      [{ author: 'alice', ref: 'gh#7', text: "We haven't reviewed alice's work before. What's the signal that they're ready for another review?", recommended: 'x', askedAt: '2026-10-21T12:00:00.000Z' }],
    )
    expect(items.map((one) => [one.id, one.state])).toEqual([
      ['review:app-7-a1b2', 'attention'],
      ['review:app-9-0000', 'attention'],
      ['review:app-8-c3d4', 'working'],
      ['review-author:alice', 'attention'],
    ])
    expect(items[1]!.detail).toContain('/review-factory resume app-9-0000')
  })
})
