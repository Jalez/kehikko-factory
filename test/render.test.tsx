import { afterEach, describe, expect, test } from 'bun:test'
import { act as react, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ActivityItem, EpicPart } from 'kehikot-module-protocol'

import { Screen, type Host } from '../src/app.tsx'
import { newJob } from '../job/flow.ts'
import type { Job } from '../job/shape.ts'
import { newRun } from '../rev/flow.ts'
import { DEFAULT_REVIEW_SETTINGS, type Run } from '../rev/shape.ts'
import { CHANGE } from './fixtures.ts'
import type { Act, Api, BoardJob, BoardRun, ReviewAct, ReviewBoard } from '../src/wire/api.ts'

afterEach(cleanup)

const job = (id: string, over: Partial<Job> = {}): BoardJob => ({
  ...newJob({ id, title: `Job ${id}`, feature: 'x', anglesAsked: null, place: { epic: 'greetings', parts: ['loud'] }, session: 'session-1234', now: '2026-10-21T12:00:00.000Z' }),
  ...over,
  files: ['spec.md'],
  lately: null,
})

function fakeApi(jobs: BoardJob[], acts: Act[] = [], reviews: ReviewBoard = { root: '/work/app', runs: [], questions: [], settings: DEFAULT_REVIEW_SETTINGS }, reviewActs: ReviewAct[] = []): Api {
  return {
    reviews: async () => reviews,
    reviewFile: async () => '# Draft\nOne comment.',
    reviewAct: async (_p, one) => {
      reviewActs.push(one)
      return 'saved'
    },
    board: async () => ({ root: '/work/app', jobs, settings: { judgeMerges: false, board: null, review: DEFAULT_REVIEW_SETTINGS }, queue: [] }),
    file: async () => '# Spec\nShout.',
    act: async (_p, one) => {
      acts.push(one)
      return 'done'
    },
    watch: () => () => {},
    columns: async () => ({ remote: null }),
  }
}

function host(over: Partial<Host> & { items?: ActivityItem[][] } = {}): Host {
  const items = over.items ?? []
  return {
    where: 'hosted',
    projectPath: '/work/app',
    epic: 'greetings',
    parts: [],
    header: () => {},
    activity: (list) => items.push(list),
    request: async () => ({ boards: [] }),
    ...over,
  }
}

const part = (id: string, picked: boolean): EpicPart => ({ id, heading: id, picked, refs: [] })

describe('the board', () => {
  test('draws the epic\'s jobs in their stage columns, and reports them to the Inbox', async () => {
    const items: ActivityItem[][] = []
    const jobs = [job('a-0001', { stage: 'build', round: 1 }), job('b-0002', { stage: 'waiting', waiting: { why: 'judge-approved', said: 'ok' } }), job('c-0003', { place: { epic: 'other' } })]
    render(<Screen host={host({ items })} api={fakeApi(jobs)} />)
    await waitFor(() => screen.getByTestId('board'))
    expect(screen.getByTestId('column-build').textContent).toContain('Job a-0001')
    expect(screen.getByTestId('column-waiting').textContent).toContain('Job b-0002')
    expect(screen.queryByText('Job c-0003')).toBeNull()
    await waitFor(() => expect(items.at(-1)?.find((one) => one.state === 'attention')?.label).toContain('Job b-0002'))
  })

  test('narrows to the picked parts, and says so in one sentence when nothing is left', async () => {
    render(<Screen host={host({ parts: [part('loud', false), part('quiet', true)] })} api={fakeApi([job('a-0001')])} />)
    await waitFor(() => screen.getByTestId('empty'))
    expect(screen.getByTestId('empty').textContent).toContain('No job on greetings is in the picked part: quiet.')
    expect(screen.getByTestId('summary').textContent).toBe('Jobs on greetings · quiet')
  })

  test('a card opens the job and its files; approve needs two presses, then asks the server', async () => {
    const acts: Act[] = []
    render(<Screen host={host()} api={fakeApi([job('b-0002', { stage: 'waiting', waiting: { why: 'judge-approved', said: 'The judge approves.' } })], acts)} />)
    await waitFor(() => screen.getByTestId('card-b-0002'))
    fireEvent.click(screen.getByTestId('card-b-0002'))
    await waitFor(() => expect(screen.getByTestId('file-text').textContent).toContain('Shout.'))
    expect(screen.getByTestId('issue').textContent).toContain('/factory issue b-0002 new')
    const approvals = () => acts.filter((one) => one.act === 'approve')
    fireEvent.click(screen.getByTestId('approve'))
    expect(approvals()).toEqual([])
    await react(async () => fireEvent.click(screen.getByTestId('approve')))
    expect(approvals()).toEqual([{ act: 'approve', job: 'b-0002' }])
  })
})

describe('the boards follow the picked parts', () => {
  const wholeEpic = job('w-0001', { place: { epic: 'greetings' } })
  const loud = job('l-0002', { place: { epic: 'greetings', parts: ['loud'] } })
  const quiet = job('q-0003', { place: { epic: 'greetings', parts: ['quiet'] } })
  const both = job('b-0004', { place: { epic: 'greetings', parts: ['loud', 'quiet'] } })
  const elsewhere = job('e-0005', { place: { epic: 'other', parts: ['loud'] } })
  const jobs = [wholeEpic, loud, quiet, both, elsewhere]
  const shown = () => ['w-0001', 'l-0002', 'q-0003', 'b-0004', 'e-0005'].filter((id) => screen.queryByTestId(`card-${id}`))

  test('picked parts narrow, and a whole-epic job always shows', async () => {
    render(<Screen host={host({ parts: [part('loud', true), part('quiet', false)] })} api={fakeApi(jobs)} />)
    await waitFor(() => screen.getByTestId('board'))
    expect(shown()).toEqual(['w-0001', 'l-0002', 'b-0004'])
    expect(screen.getByTestId('summary').textContent).toBe('Jobs on greetings · loud')
  })

  test('no parts picked shows every job of the epic, and says all parts', async () => {
    render(<Screen host={host({ parts: [part('loud', false), part('quiet', false)] })} api={fakeApi(jobs)} />)
    await waitFor(() => screen.getByTestId('board'))
    expect(shown()).toEqual(['w-0001', 'l-0002', 'q-0003', 'b-0004'])
    expect(screen.getByTestId('summary').textContent).toBe('Jobs on greetings · all parts')
  })

  test('at the project scope the board ignores the parts and the epic (protocol 2.29.0); an agent cannot press "All jobs"', async () => {
    const press = { current: (_: { item: string; value?: string }) => undefined as unknown }
    render(<Screen host={host({ parts: [part('loud', true)], scope: 'project' } as never)} api={fakeApi(jobs)} press={press as never} />)
    await waitFor(() => screen.getByTestId('board'))
    expect(shown()).toEqual(['w-0001', 'l-0002', 'q-0003', 'b-0004', 'e-0005'])
    expect(screen.getByTestId('summary').textContent).toBe('Jobs on all epics')
    let said: unknown
    await react(async () => void (said = press.current({ item: 'view', value: 'all' })))
    expect(String(said)).toContain('Factory’s settings')
  })

  test('the Reviews board follows the same rules', async () => {
    const mk = (id: string, place: Run['place']) => ({ ...newRun({ id, change: CHANGE, session: null, place, now: '2026-10-21T12:00:00.000Z' }), files: [], lately: null }) as BoardRun
    const runs = [mk('app-1-0001', { epic: 'greetings' }), mk('app-2-0002', { epic: 'greetings', parts: ['loud'] }), mk('app-3-0003', { epic: 'greetings', parts: ['quiet'] }), mk('app-4-0004', { epic: 'other' }), mk('app-5-0005', null)]
    const reviews: ReviewBoard = { root: '/work/app', runs, questions: [], settings: DEFAULT_REVIEW_SETTINGS }
    const press = { current: (_: { item: string; value?: string }) => undefined as unknown }
    const seen = () => runs.map((one) => one.id).filter((id) => screen.queryByTestId(`review-card-${id}`))
    render(<Screen host={host({ parts: [part('loud', true), part('quiet', false)] })} api={{ ...fakeApi([]), reviews: async () => reviews }} press={press as never} />)
    await react(async () => void press.current({ item: 'view', value: 'reviews' }))
    await waitFor(() => screen.getByTestId('review-board'))
    expect(seen()).toEqual(['app-1-0001', 'app-2-0002'])
    expect(screen.getByTestId('summary').textContent).toBe('Reviews on greetings · loud')
    cleanup()
    render(<Screen host={host({ parts: [] })} api={{ ...fakeApi([]), reviews: async () => reviews }} press={press as never} />)
    await react(async () => void press.current({ item: 'view', value: 'reviews' }))
    await waitFor(() => screen.getByTestId('review-board'))
    expect(seen()).toEqual(['app-1-0001', 'app-2-0002', 'app-3-0003'])
  })

  test('All epics in the host: both boards show every epic, unplaced included, each card labelled', async () => {
    const press = { current: (_: { item: string; value?: string }) => undefined as unknown }
    const unplaced = job('u-0006', { place: null })
    render(<Screen host={host({ epic: null, scope: 'project', parts: [] })} api={fakeApi([...jobs, unplaced])} press={press as never} />)
    await waitFor(() => screen.getByTestId('board'))
    expect(shown()).toEqual(['w-0001', 'l-0002', 'q-0003', 'b-0004', 'e-0005'])
    expect(screen.getByTestId('card-u-0006')).toBeTruthy()
    expect(screen.getByTestId('summary').textContent).toBe('Jobs on all epics')
    expect(screen.getByTestId('card-e-0005').textContent).toContain('other · loud')
    expect(screen.getByTestId('card-w-0001').querySelector('[data-testid="place"]')?.textContent).toBe('greetings')
    expect(screen.getByTestId('card-u-0006').querySelector('[data-testid="place"]')?.textContent).toBe('no epic')

    const mk = (id: string, place: Run['place']) => ({ ...newRun({ id, change: CHANGE, session: null, place, now: '2026-10-21T12:00:00.000Z' }), files: [], lately: null }) as BoardRun
    const runs = [mk('app-1-0001', { epic: 'greetings' }), mk('app-4-0004', { epic: 'other' }), mk('app-5-0005', null)]
    const reviews: ReviewBoard = { root: '/work/app', runs, questions: [], settings: DEFAULT_REVIEW_SETTINGS }
    cleanup()
    render(<Screen host={host({ epic: null, scope: 'project', parts: [] })} api={{ ...fakeApi([]), reviews: async () => reviews }} press={press as never} />)
    await react(async () => void press.current({ item: 'view', value: 'reviews' }))
    await waitFor(() => screen.getByTestId('review-board'))
    expect(runs.map((one) => one.id).filter((id) => screen.queryByTestId(`review-card-${id}`))).toEqual(['app-1-0001', 'app-4-0004', 'app-5-0005'])
    expect(screen.getByTestId('summary').textContent).toBe('Reviews on all epics')
    expect(screen.getByTestId('review-card-app-5-0005').querySelector('[data-testid="place"]')?.textContent).toBe('no epic')
    expect(screen.getByTestId('review-card-app-4-0004').querySelector('[data-testid="place"]')?.textContent).toBe('other')
  })

  test('one epic again: the board narrows back and the cards say no epic', async () => {
    render(<Screen host={host({ scope: 'epic', parts: [] })} api={fakeApi(jobs)} />)
    await waitFor(() => screen.getByTestId('board'))
    expect(shown()).toEqual(['w-0001', 'l-0002', 'q-0003', 'b-0004'])
    expect(screen.queryByTestId('place')).toBeNull()
  })

  test("two projects' jobs do not mix: each board is read for its own project path only", async () => {
    const byProject: Record<string, BoardJob[]> = { '/work/app': [job('a-0001')], '/work/other': [job('o-0001')] }
    const asked: string[] = []
    const api = { ...fakeApi([]), board: async (path: string) => (asked.push(path), { root: path, jobs: byProject[path] ?? [], settings: { judgeMerges: false, board: null, review: DEFAULT_REVIEW_SETTINGS }, queue: [] }) } as Api
    const { rerender } = render(<Screen host={host({ projectPath: '/work/app' })} api={api} />)
    await waitFor(() => screen.getByTestId('card-a-0001'))
    rerender(<Screen host={host({ projectPath: '/work/other' })} api={api} />)
    await waitFor(() => screen.getByTestId('card-o-0001'))
    expect(screen.queryByTestId('card-a-0001')).toBeNull()
    expect(asked).toEqual(['/work/app', '/work/other'])
  })
})
