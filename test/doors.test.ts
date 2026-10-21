import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { TICKET, answer, setHostResolve, setNeeds } from '../doors.ts'
import { scratchRepo, testNeeds } from './repo.ts'

let repo: ReturnType<typeof scratchRepo>
beforeAll(() => {
  repo = scratchRepo()
  setNeeds(() => testNeeds([repo.root]))
  setHostResolve(async (folder) => (folder === repo.root ? { ok: true, path: folder } : { ok: false, reason: 'not-project', why: `${folder} is not a project open in Kehikot.` }))
})
afterAll(() => {
  setNeeds(null)
  setHostResolve(null)
  repo.done()
})

const q = (o: Record<string, string> = {}) => new URLSearchParams(o)

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const reply = await answer('POST', '/mcp', q(), { jsonrpc: '2.0', id: 1, method, params }, null)
  return reply?.body as { result: { tools?: { name: string; annotations: { readOnlyHint: boolean } }[]; content?: { text: string }[]; isError?: boolean } }
}

describe('the doors', () => {
  test('the agent door only reads: four read-only tools, and nothing that merges, approves, starts or sends', async () => {
    const tools = (await rpc('tools/list')).result.tools!
    expect(tools.map((one) => one.name)).toEqual(['jobs', 'job', 'reviews', 'review'])
    for (const name of ['send_review', 'accept_checklist', 'review_settings']) {
      const refused = await rpc('tools/call', { name, arguments: { project: repo.root } })
      expect(refused.result.isError).toBe(true)
    }
    expect(tools.every((one) => one.annotations.readOnlyHint)).toBe(true)
    const merge = await rpc('tools/call', { name: 'approve', arguments: { project: repo.root } })
    expect(merge.result.isError).toBe(true)
    expect(merge.result.content![0]!.text).toContain('only reads')
  })

  test('the skill text is served as markdown', async () => {
    const reply = await answer('GET', '/kehikot/skills/factory.md', q(), null, null)
    expect(reply?.raw?.type).toContain('text/markdown')
  })

  test('the page\'s routes want the ticket; the skill\'s answer in plain text', async () => {
    expect((await answer('GET', '/api/jobs', q({ projectPath: repo.root }), null, null))?.status).toBe(403)
    expect((await answer('POST', '/api/act', q(), { projectPath: repo.root, act: 'approve', job: 'x-a1b2' }, null))?.status).toBe(403)
    const started = await answer('POST', '/api/skill/say', q({ session: 'session-1234-abcd', say: 'Make the greeting shout', cwd: repo.root }), null, null)
    expect(String(started?.raw?.bytes)).toStartWith('Factory: job make-the-greeting-shout-a1b2')
    const board = await answer('GET', '/api/jobs', q({ projectPath: repo.root }), null, TICKET)
    expect((board?.body as { jobs: unknown[] }).jobs.length).toBe(1)
  })

  test('jobs, by the door and by ref, have one shape', async () => {
    const said = await rpc('tools/call', { name: 'jobs', arguments: { project: repo.root } })
    const jobs = JSON.parse(said.result.content![0]!.text) as Record<string, unknown>[]
    expect(Object.keys(jobs[0]!).sort()).toEqual(['column', 'id', 'place', 'ref', 'stage', 'title', 'updatedAt'])
    await answer('POST', '/api/skill/say', q({ session: 'session-1234-abcd', say: 'issue make-the-greeting-shout-a1b2 jalez/app#7', cwd: repo.root }), null, null)
    const byRef = await answer('GET', '/api/jobs', q({ ref: 'https://github.com/jalez/app/issues/7', projectPath: repo.root }), null, null)
    const found = (byRef?.body as { jobs: Record<string, unknown>[] }).jobs
    expect(found.map((one) => [one.id, one.ref, one.stage])).toEqual([['make-the-greeting-shout-a1b2', 'jalez/app#7', 'spec']])
    expect(Object.keys(found[0]!).sort()).toEqual(Object.keys(jobs[0]!).sort())
    expect(Object.keys(byRef?.body as object)).toEqual(['jobs'])
  })

  test('GET /api/jobs?ref= needs no ticket, reads only, and only for a project the host holds', async () => {
    const other = await answer('GET', '/api/jobs', q({ ref: 'jalez/app#7', projectPath: '/etc' }), null, null)
    expect(other?.status).toBe(403)
    expect(JSON.stringify(other?.body)).not.toContain('jobs')
    expect((await answer('GET', '/api/jobs', q({ ref: 'jalez/app#7' }), null, null))?.status).toBe(403)
    expect((await answer('POST', '/api/jobs', q({ ref: 'jalez/app#7', projectPath: repo.root }), null, null))?.status).toBe(405)
    const none = await answer('GET', '/api/jobs', q({ ref: 'jalez/app#8', projectPath: repo.root }), null, null)
    expect(none?.body).toEqual({ jobs: [] })
    const text = JSON.stringify((await answer('GET', '/api/jobs', q({ ref: 'jalez/app#7', projectPath: repo.root }), null, null))?.body)
    expect(text).not.toContain('Make the greeting shout\n')
    expect(text).not.toContain('feature')
    expect(text).not.toContain('history')
  })

  test('the reviews: the skill\'s doors answer in plain text; the board and its presses want the ticket; the record reads without one, project-checked', async () => {
    const said = await answer('POST', '/api/review/say', q({ session: 'session-1234-abcd', say: 'help', cwd: repo.root }), null, null)
    expect(String(said?.raw?.bytes)).toContain('/review-factory status')
    expect((await answer('GET', '/api/review-board', q({ projectPath: repo.root }), null, null))?.status).toBe(403)
    expect((await answer('POST', '/api/review-act', q(), { projectPath: repo.root, act: 'review-settings', settings: { postTwoWay: true } }, null))?.status).toBe(403)
    const board = await answer('GET', '/api/review-board', q({ projectPath: repo.root }), null, TICKET)
    expect(board?.body).toMatchObject({ runs: [], questions: [], settings: { postTwoWay: false } })
    expect((await answer('POST', '/api/review-act', q(), { projectPath: repo.root, act: 'review-settings', settings: { postTwoWay: true } }, TICKET))?.status).toBe(200)
    const reviews = await answer('GET', '/api/reviews', q({ change: 'https://github.com/me/app/pull/7', projectPath: repo.root }), null, null)
    expect(reviews?.body).toEqual({ reviews: [] })
    expect((await answer('GET', '/api/reviews', q({ change: 'https://github.com/me/app/pull/7', projectPath: '/etc' }), null, null))?.status).toBe(403)
    expect((await answer('POST', '/api/reviews', q({ change: 'x', projectPath: repo.root }), null, null))?.status).toBe(405)
    const skill = await answer('GET', '/kehikot/skills/review-factory.md', q(), null, null)
    expect(String(skill?.raw?.bytes)).toContain('name: review-factory')
  })

  test('a path that is not ours is left to Vite', async () => {
    expect(await answer('GET', '/src/main.tsx', q(), null, null)).toBeNull()
  })
})
