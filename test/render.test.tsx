import { afterEach, describe, expect, test } from 'bun:test'
import { act as react, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ActivityItem, EpicPart } from 'kehikot-module-protocol'

import { Screen, type Host } from '../src/app.tsx'
import { newJob } from '../job/flow.ts'
import type { Job } from '../job/shape.ts'
import { DEFAULT_REVIEW_SETTINGS } from '../rev/shape.ts'
import type { Act, Api, BoardJob } from '../src/wire/api.ts'

afterEach(cleanup)

const job = (id: string, over: Partial<Job> = {}): BoardJob => ({
  ...newJob({ id, title: `Job ${id}`, feature: 'x', anglesAsked: null, place: { epic: 'greetings', parts: ['loud'] }, session: 'session-1234', now: '2026-10-21T12:00:00.000Z' }),
  ...over,
  files: ['spec.md'],
  lately: null,
})

function fakeApi(jobs: BoardJob[], acts: Act[] = []): Api {
  return {
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
    expect(screen.getByTestId('empty').textContent).toBe('No job is in the picked part.')
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
