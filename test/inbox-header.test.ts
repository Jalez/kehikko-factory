import { describe, expect, test } from 'bun:test'
import { headerItemsSchema } from 'kehikot-module-protocol'

import { headerItems } from '../src/board/header.ts'
import { inboxItems } from '../src/board/inbox.ts'
import { newJob } from '../job/flow.ts'
import type { Job } from '../job/shape.ts'

const base = newJob({ id: 'shout-a1b2', title: 'Make the greeting shout', feature: 'x', anglesAsked: null, place: { epic: 'greetings', parts: ['loud'], kehikko: 'k-main' }, session: 'session-1234', now: '2026-10-21T12:00:00.000Z' })
const at = (over: Partial<Job>): Job => ({ ...base, ...over })

describe('the Inbox', () => {
  test('a job waiting for the person is one attention item at its place, labelled with the job', () => {
    const [item] = inboxItems([at({ stage: 'waiting', waiting: { why: 'judge-approved', said: 'The judge approves.' } })])
    expect(item).toMatchObject({ id: 'job:shout-a1b2', state: 'attention', label: 'Factory job waiting for you: Make the greeting shout', place: { epic: 'greetings', parts: ['loud'], kehikko: 'k-main' } })
  })

  test('a failed job is one item too; running jobs work; cleared jobs are gone; the list is whole', () => {
    const items = inboxItems([at({ stage: 'failed', failed: 'no tests' }), at({ id: 'other-c3d4', stage: 'review' }), at({ id: 'old-e5f6', stage: 'failed', archived: true })])
    expect(items.map((one) => [one.id, one.state])).toEqual([['job:shout-a1b2', 'attention'], ['job:other-c3d4', 'working']])
    expect(inboxItems([])).toEqual([])
  })

  test('a job with no place belongs to the project', () => {
    expect(inboxItems([at({ place: null, stage: 'waiting' })])[0]!.place).toBeUndefined()
  })
})

describe('the header', () => {
  const waiting = at({ stage: 'waiting', waiting: { why: 'judge-approved', said: 'x' } })

  test('approve and send back are there for the selected waiting job, and refused for anything else', () => {
    const items = headerItems('epic', waiting, false, 'greetings')
    expect(items.find((one) => one.id === 'approve')).toMatchObject({ kind: 'run', disabled: null })
    expect(headerItems('epic', null, false, 'greetings').find((one) => one.id === 'approve')).toMatchObject({ disabled: 'Select a job on the board first.' })
    expect(headerItems('epic', at({ stage: 'build' }), false, 'greetings').find((one) => one.id === 'send-back')?.kind === 'run').toBe(true)
    expect((headerItems('epic', at({ stage: 'build' }), false, 'greetings').find((one) => one.id === 'send-back') as { disabled: string | null }).disabled).not.toBeNull()
  })

  test('an agent can switch the view but never press merge or send back', () => {
    const items = headerItems('all', waiting, false, null)
    expect(items.find((one) => one.id === 'view')?.agents).toBe(true)
    const approve = items.find((one) => one.id === 'approve')!
    expect(approve.agents).toBe(false)
    expect(approve.kind === 'run' && approve.confirm).toBe(true)
    expect(items.find((one) => one.id === 'send-back')?.agents).toBe(false)
    /* The protocol itself refuses a confirmed run marked for agents. */
    expect(headerItemsSchema.safeParse([{ ...approve, agents: true }]).success).toBe(false)
  })
})
