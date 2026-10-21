import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { git } from '../git.ts'
import { actReview, doneReview, pageRows, pageSaw, sayReview, type ReviewNeeds } from '../review-factory.ts'
import { readRun, recordFiles, listRuns, writeRun } from '../rev/store.ts'
import { CHECKLIST, REVIEW, type Neighbours } from '../rev/neighbours.ts'
import type { Run } from '../rev/shape.ts'
import type { Run as CliRun } from '../tracker.ts'
import { scratchForge, write } from './repo.ts'
import { standIn } from './stand-ins.ts'

const SESSION = 'session-review-0001'
let forge: ReturnType<typeof scratchForge> | null = null
afterEach(() => {
  forge?.done()
  forge = null
})

/** gh, standing in: the pull request, at `head`. */
function gh(head: () => string, over: Record<string, unknown> = {}): CliRun {
  return (command, args) => {
    if (command === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      return {
        ok: true,
        err: '',
        out: JSON.stringify({ title: 'Shout', body: 'Makes the greeting loud.', author: { login: 'alice' }, baseRefName: 'main', headRefOid: head(), labels: [], commits: [{ oid: head(), messageHeadline: 'shout' }], comments: [], state: 'OPEN', isDraft: false, ...over }),
      }
    }
    return { ok: false, out: '', err: 'not answered' }
  }
}

function setUp(opts: { n?: Neighbours; cli?: CliRun; modules?: string[]; key?: string | null; spawned?: unknown[] } = {}) {
  forge = scratchForge()
  const root = forge.root
  const head = forge.head
  write(join(root, '.kehikot', 'claude', 'places.json'), JSON.stringify({ places: { here: { epic: 'greetings', kehikko: { key: 'k1' }, sessions: [SESSION] } } }))
  pageSaw(root, { kehikko: 'k1', modules: opts.modules ?? ['kehikot.factory', REVIEW, CHECKLIST], selection: ['gh#7'] })
  let tick = 0
  const needs: ReviewNeeds = {
    resolve: async (folder) => (folder === root ? { ok: true, path: root } : { ok: false, why: `${folder} is not a project open in Kehikot.` }),
    origin: () => 'http://127.0.0.1:8040',
    now: () => new Date(Date.UTC(2026, 9, 21, 12, 0, tick++)).toISOString(),
    suffix: () => 'a1b2',
    remote: () => ({ kind: 'github', repo: 'me/app' }),
    cli: opts.cli ?? gh(() => head),
    neighbours: opts.n ?? standIn().n,
    key: () => (opts.key === undefined ? null : opts.key),
    spawner: async (program, args, cwd) => {
      opts.spawned?.push([program, args, cwd])
      return { ok: true }
    },
  }
  return { root, head, needs }
}

const say = (needs: ReviewNeeds, root: string, words = '') => sayReview({ session: SESSION, say: words, cwd: root }, needs)
const runOf = (root: string, id = 'app-7-a1b2'): Run => {
  const read = readRun(root, id)
  if (!read.ok || !read.value) throw new Error('no run')
  return read.value
}
const report = (needs: ReviewNeeds, root: string, run: Run, failed: string | null = null) => doneReview({ project: root, run: run.id, step: run.stage, session: SESSION, failed }, needs)
const fenced = (value: unknown) => `Words for the person.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`
const dir = (root: string, id = 'app-7-a1b2') => join(root, '.kehikot', 'factory', 'reviews', id)

const PLAN = (over: Record<string, unknown> = {}) => ({
  angles: [
    { id: 'correctness', brief: 'Uppercase in every case.', practices: [], items: ['c1/i1'] },
    { id: 'tests', brief: 'A test for it.', practices: [], items: [] },
  ],
  door: { kind: 'two-way', reasons: ['A string change.'] },
  uiux: { touches: false, reason: 'No screen.', screens: [] },
  ...over,
})
const POINT = {
  path: 'greet.js',
  side: 'new',
  line: 1,
  quote: 'export const greet = (name) => `HELLO, ${name}`',
  claim: 'The name is not uppercased.',
  why: 'The greeting should shout all of it.',
  suggestion: 'Uppercase the whole string.',
  severity: 'blocking',
  evidence: [{ kind: 'line', ref: 'greet.js:1' }],
  checklist: [],
}

/** The agents, standing in: each writes the file its step asks for. */
function agentsDo(root: string, run: Run, opts: { plan?: Record<string, unknown>; required?: boolean; badPoint?: boolean } = {}) {
  const at = (name: string) => join(dir(root, run.id), name)
  switch (run.stage) {
    case 'planning':
      return write(at('plan.md'), fenced(PLAN(opts.plan)))
    case 'reviewing':
      for (const angle of run.plan!.angles) {
        const points = angle.id === 'correctness' ? [opts.badPoint ? { ...POINT, quote: 'not these lines' } : POINT] : []
        const answers = angle.items.map((key) => ({ checklist: key.split('/')[0], item: key.split('/')[1], state: 'pass', note: 'greet.test.js covers it.' }))
        write(at(`review-${angle.id}.md`), fenced({ verdict: points.length ? 'CHANGES' : 'APPROVE', points, answers }))
      }
      return
    case 'challenging':
      return write(at('challenge.md'), fenced({ challenges: run.points.map((one) => ({ point: one.id, concede: true, case: '', evidence: [] })) }))
    case 'judging':
      if (run.plan?.door.kind === 'one-way') write(at('briefing.md'), '# Decisions\n\nIt changes the greeting for everyone.')
      return write(
        at('judgement.md'),
        fenced({ rulings: run.points.map((one) => ({ point: one.id, ruling: opts.required === false ? 'optional' : 'required', reason: 'It is a bug.' })), verdict: opts.required === false ? 'approve' : 'request-changes', visionFit: 'It fits the epic.', summary: 'One fix.', diagrams: [] }),
      )
  }
}

async function runToRest(needs: ReviewNeeds, root: string, opts: Parameters<typeof agentsDo>[2] = {}): Promise<string> {
  let answer = ''
  for (let i = 0; i < 12; i++) {
    const run = runOf(root)
    if (!['planning', 'reviewing', 'challenging', 'judging', 'diagrams'].includes(run.stage) || run.waiting) return answer
    agentsDo(root, run, opts)
    answer = await report(needs, root, run)
  }
  throw new Error('did not come to rest')
}

describe('/review-factory refuses, in plain words', () => {
  test('a conversation on no kehikko, a kehikko without Factory, no change, and an issue', async () => {
    const { root, needs } = setUp({ modules: [REVIEW] })
    expect(await say(needs, root)).toContain('has no Factory container')
    pageSaw(root, { kehikko: 'k1', modules: ['kehikot.factory'], selection: [] })
    expect(await say(needs, root)).toContain('no pull or merge request is selected')
    expect(await say(needs, root, 'https://github.com/me/app/issues/3')).toContain('an issue, not a change')
    const other = await sayReview({ session: 'session-elsewhere-01', say: '', cwd: root }, needs)
    expect(other).toContain('not placed on a kehikko')
    expect(listRuns(root)).toEqual([])
  })
})

describe('a review, from the selected change to a draft in Review', () => {
  test('gather, plan, two reviewers at once, validate, challenge, judge, draft; nothing posted', async () => {
    const stand = standIn()
    const { root, head, needs } = setUp({ n: stand.n })
    const first = await say(needs, root)
    expect(first).toContain('Factory: review app-7-a1b2 of gh#7')
    expect(first).toContain('Budget: small change')
    expect(first).toContain('You plan the review')
    const gathered = runOf(root)
    expect(gathered.pinned?.head).toBe(head)
    expect(existsSync(gathered.checkout!.path)).toBe(true)
    expect(gathered.checklists.map((one) => one.id)).toEqual(['c1'])
    agentsDo(root, gathered)
    const reviewers = await report(needs, root, gathered)
    expect(reviewers).toContain('start these 2 subagents AT ONCE')
    expect(reviewers).toContain('c1/i1: Has a test')
    const last = await runToRest(needs, root)
    const run = runOf(root)
    expect(run.stage).toBe('waiting')
    expect(run.waiting?.why).toBe('drafted')
    expect(last).toContain('To get this approved:')
    expect(existsSync(gathered.checkout!.path)).toBe(false)
    const tools = stand.calls.map((one) => `${one.id}:${one.tool}`)
    expect(tools).toContain(`${REVIEW}:add_comment`)
    expect(tools).toContain(`${REVIEW}:propose_review`)
    expect(tools).not.toContain(`${REVIEW}:set_verdict`)
    const comment = stand.calls.find((one) => one.tool === 'add_comment')!
    expect(comment.args).toMatchObject({ change: 'https://github.com/me/app/pull/7', path: 'greet.js', line: 1, meta: { run: 'app-7-a1b2', severity: 'blocking', ruling: 'required' } })
    expect(stand.calls.filter((one) => one.tool === 'check_item').map((one) => one.args.item)).not.toContain('i1')
    expect(recordFiles(root, 'app-7-a1b2')).toEqual(expect.arrayContaining(['packet.md', 'plan.md', 'review-correctness.md', 'validation.md', 'points.md', 'challenge.md', 'judgement.md', 'draft.md', 'diff.patch', 'budget.md']))
    expect(git(root, ['status', '--porcelain', '--untracked-files=no']).out).toBe('')
  })

  test('a point whose quote is not its lines never reaches the adversary or Review', async () => {
    const stand = standIn()
    const { root, needs } = setUp({ n: stand.n })
    await say(needs, root)
    await runToRest(needs, root, { badPoint: true })
    const run = runOf(root)
    expect(run.points).toEqual([])
    expect(run.rejected[0]!.why).toContain('quoted text')
    expect(run.history.some((one) => one.said.includes('No point survived'))).toBe(true)
    expect(stand.calls.some((one) => one.tool === 'add_comment')).toBe(false)
  })

  test('a malformed answer is given once more, then the run stops and says why', async () => {
    const { root, needs } = setUp()
    await say(needs, root)
    write(join(dir(root), 'plan.md'), 'no json here')
    const again = await report(needs, root, runOf(root))
    expect(again).toContain('First: plan.md has no ```json block')
    const stoppedNow = await report(needs, root, runOf(root))
    expect(stoppedNow).toContain('after one more try')
    expect(runOf(root).waiting?.why).toBe('stopped')
  })

  test('a push during the run stops it at waiting, with nothing drafted', async () => {
    const stand = standIn()
    let head = ''
    const { root, needs } = setUp({ n: stand.n, cli: gh(() => head) })
    head = git(join(root, '..', 'origin'), ['rev-parse', 'refs/pull/7/head']).out
    await say(needs, root)
    for (const _ of [0, 1, 2]) {
      const run = runOf(root)
      agentsDo(root, run)
      await report(needs, root, run)
    }
    head = 'f'.repeat(40)
    const run = runOf(root)
    agentsDo(root, run)
    const answer = await report(needs, root, run)
    expect(runOf(root).waiting?.why).toBe('moved-on')
    expect(answer).toContain('re-run to review the new commits')
    expect(stand.calls.some((one) => one.tool === 'add_comment' || one.tool === 'propose_review')).toBe(false)
  })
})

describe('the person\'s choices', () => {
  test('no checklist: the planner\'s proposal waits in planning; accepting makes it in Checklist and the reviewers start', async () => {
    const stand = standIn({
      [`${CHECKLIST}:checklists`]: (args) =>
        args.checklist ? { ok: true, text: '"What gh#7 owes before it lands" (c9) held against gh#7 — 0/2 ticked\npassed 0 · failed 0 · n/a 0 · unchecked 2\n1. [ ] i1 — Has a test\n2. [ ] i2 — No new dependency' } : { ok: true, text: 'Checklists in /p:\n' },
    })
    const { root, needs } = setUp({ n: stand.n })
    await say(needs, root)
    agentsDo(root, runOf(root), { plan: { proposedChecklist: ['Has a test', 'No new dependency'] } })
    const waits = await report(needs, root, runOf(root))
    expect(waits).toContain('has no checklist')
    expect(waits).toContain(`/review-factory checklist app-7-a1b2 accept`)
    expect(runOf(root).stage).toBe('planning')
    expect(runOf(root).waiting?.why).toBe('checklist')
    const goes = await say(needs, root, 'checklist app-7-a1b2 accept')
    expect(goes).toContain('start these 2 subagents AT ONCE')
    expect(stand.calls.filter((one) => one.tool === 'add_checklist_item').map((one) => one.args.text)).toEqual(['Has a test', 'No new dependency'])
    const run = runOf(root)
    expect(run.stage).toBe('reviewing')
    expect(run.plan!.angles.map((one) => one.items)).toEqual([['c9/i1'], ['c9/i2']])
  })

  test('the checklist answers are set as Factory\'s, never over the person\'s tick', async () => {
    const stand = standIn()
    const { root, needs } = setUp({ n: stand.n })
    await say(needs, root)
    agentsDo(root, runOf(root), { plan: { angles: [{ id: 'correctness', brief: 'b', practices: [], items: ['c1/i1', 'c1/i3'] }, { id: 'tests', brief: 'b', practices: [], items: ['c1/i2'] }] } })
    await report(needs, root, runOf(root))
    await runToRest(needs, root)
    const ticks = stand.calls.filter((one) => one.tool === 'check_item').map((one) => [one.args.item, one.args.state])
    expect(ticks).toEqual([
      ['i3', 'passed'],
      ['i2', 'passed'],
    ])
    expect(runOf(root).notes.join(' ')).not.toContain('Has a test')
  })

  test('angles before the reviewers start; the budget at any time; both refused when they no longer matter', async () => {
    const { root, needs } = setUp()
    await say(needs, root)
    expect(await say(needs, root, 'angles app-7-a1b2 security,tests')).toContain('security and tests')
    expect(await say(needs, root, 'budget app-7-a1b2 points=2 tokens=50k')).toContain('at most 2 points per reviewer')
    agentsDo(root, runOf(root))
    await report(needs, root, runOf(root))
    expect(runOf(root).plan!.angles.map((one) => one.id)).toEqual(['security', 'tests'])
    expect(await say(needs, root, 'angles app-7-a1b2 correctness,tests')).toContain('settled')
  })
})

describe('posting without the person', () => {
  async function finished(opts: { plan?: Record<string, unknown>; postTwoWay: boolean; key?: string | null }) {
    const stand = standIn()
    const sent: unknown[] = []
    stand.n.send = async (body, key) => {
      sent.push({ body, key })
      return { status: 200, text: '{"ok":true}' }
    }
    const { root, needs } = setUp({ n: stand.n, key: opts.key === undefined ? 'a'.repeat(64) : opts.key })
    expect((await actReview(root, { act: 'review-settings', settings: { postTwoWay: opts.postTwoWay } }, needs)).ok).toBe(true)
    await say(needs, root)
    agentsDo(root, runOf(root), { plan: opts.plan })
    await report(needs, root, runOf(root))
    await runToRest(needs, root, { required: false })
    return { run: runOf(root), sent }
  }

  test('two-way, no UI/UX, the switch on: Factory sends it through Review with the key', async () => {
    const { run, sent } = await finished({ postTwoWay: true })
    expect(run.stage).toBe('sent')
    expect(run.sent?.by).toBe('factory')
    expect(sent).toEqual([{ body: { project: expect.any(String), change: 'https://github.com/me/app/pull/7', run: 'app-7-a1b2' }, key: 'a'.repeat(64) }])
  })

  test('the switch off, a one-way change, a UI/UX change, or no key: it waits for the person', async () => {
    expect((await finished({ postTwoWay: false })).sent).toEqual([])
    const oneWay = await finished({ postTwoWay: true, plan: { door: { kind: 'one-way', reasons: ['A migration.'] } } })
    expect(oneWay.sent).toEqual([])
    expect(oneWay.run.notes.join(' ')).toContain('one-way')
    expect(oneWay.run.drafted?.briefing).toBe('record')
    const ui = await finished({ postTwoWay: true, plan: { uiux: { touches: true, reason: 'The greeting is shown.', screens: ['home'] } } })
    expect(ui.sent).toEqual([])
    expect(ui.run.judged?.pathToSuccess[0]).toMatch(/^Add before and after pictures of: home\./)
    const keyless = await finished({ postTwoWay: true, key: null })
    expect(keyless.sent).toEqual([])
    expect(keyless.run.notes.join(' ')).toContain('has not made its key')
  })

  test('a refusal from Review is said on the card', async () => {
    const stand = standIn()
    stand.n.send = async () => ({ status: 409, text: JSON.stringify({ ok: false, error: 'The change is not open.' }) })
    const { root, needs } = setUp({ n: stand.n, key: 'b'.repeat(64) })
    await actReview(root, { act: 'review-settings', settings: { postTwoWay: true } }, needs)
    await say(needs, root)
    await runToRest(needs, root, { required: false })
    expect(runOf(root).waiting?.why).toBe('drafted')
    expect(runOf(root).notes).toContain('Review did not send it: The change is not open.')
  })
})

describe('again: re-runs and re-reviews', () => {
  test('a re-run replaces only the earlier run\'s unsent agent comments', async () => {
    const stand = standIn()
    let suffix = 0
    const { root, needs } = setUp({ n: stand.n })
    needs.suffix = () => ['a1b2', 'c3d4'][suffix++]!
    await say(needs, root)
    await runToRest(needs, root)
    await say(needs, root)
    const second = runOf(root, 'app-7-c3d4')
    expect(second.previous).toBe('app-7-a1b2')
    expect(second.round).toBe(1)
    for (let i = 0; i < 6; i++) {
      const run = runOf(root, 'app-7-c3d4')
      if (run.stage === 'waiting') break
      agentsDo(root, run)
      await report(needs, root, run)
    }
    expect(stand.calls.filter((one) => one.tool === 'drop_run_comments').map((one) => one.args.run)).toEqual(['app-7-a1b2'])
  })

  test('the first time an author needs another look, the person is asked once; with a rule and the switch, a background session starts', async () => {
    const spawned: unknown[] = []
    let suffix = 0
    const { root, needs } = setUp({ spawned })
    needs.suffix = () => ['a1b2', 'c3d4', 'e5f6'][suffix++]!
    await say(needs, root)
    await runToRest(needs, root)
    writeRun(root, { ...runOf(root), stage: 'sent', sent: { at: '2026-10-21T12:00:30.000Z', by: 'person' }, waiting: null })
    const row = { ref: 'gh#7', tracker: 'github', host: 'github.com', repo: 'me/app', number: 7, kind: 'change', state: 'open', title: 'Shout', url: 'u', labels: [], assignees: [], links: [], readAt: 'x', myRoles: ['reviewer-asked'], authorLogin: 'alice' }
    expect((await pageRows(root, [row], needs)).ok).toBe(true)
    const board = await import('../review-factory.ts').then((m) => m.questionsOf(root))
    expect(board.map((one) => one.author)).toEqual(['alice'])
    expect(board[0]!.text).toBe("We haven't reviewed alice's work before. What's the signal that they're ready for another review?")
    expect(listRuns(root).length).toBe(1)
    expect((await actReview(root, { act: 'author-rule', author: 'alice', sentence: 'when they re-request review', allProjects: false }, needs)).ok).toBe(true)
    await actReview(root, { act: 'review-settings', settings: { reReviewByItself: true } }, needs)
    await pageRows(root, [row], needs)
    const queued = runOf(root, 'app-7-c3d4')
    expect(queued).toMatchObject({ stage: 'queued', round: 2, previous: 'app-7-a1b2', background: true })
    expect(queued.listed.map((one) => one.id)).toEqual(['p1'])
    expect(spawned).toEqual([['claude', ['--bg', '--name=Re-review 2: gh#7 Shout', '/review-factory resume app-7-c3d4'], root]])
    await pageRows(root, [row], needs)
    expect(spawned.length).toBe(1)
  })

  test('a re-review with no new commits checks only the listed points, and says so', async () => {
    const { root, needs } = setUp()
    let suffix = 0
    needs.suffix = () => ['a1b2', 'c3d4'][suffix++]!
    await say(needs, root)
    await runToRest(needs, root)
    writeRun(root, { ...runOf(root), stage: 'sent', sent: { at: 'x', by: 'person' }, waiting: null })
    await say(needs, root)
    const run = runOf(root, 'app-7-c3d4')
    expect(run.round).toBe(2)
    expect(run.notes.join(' ')).toContain('No new commits since the last review')
    expect(run.notes.join(' ')).not.toContain('force-push')
    agentsDo(root, run)
    await report(needs, root, run)
    const reviewing = runOf(root, 'app-7-c3d4')
    agentsDo(root, reviewing)
    await report(needs, root, reviewing)
    expect(runOf(root, 'app-7-c3d4').points).toEqual([])
    expect(runOf(root, 'app-7-c3d4').rejected.some((one) => one.why.includes('not about new code'))).toBe(true)
  })

  test('a re-review reads only the delta: a new point on unchanged lines is refused', async () => {
    const { root, needs } = setUp()
    let suffix = 0
    needs.suffix = () => ['a1b2', 'c3d4'][suffix++]!
    await say(needs, root)
    await runToRest(needs, root)
    writeRun(root, { ...runOf(root), stage: 'sent', sent: { at: 'x', by: 'person' }, waiting: null })
    const origin = join(root, '..', 'origin')
    git(origin, ['checkout', '-q', 'shout'])
    writeFileSync(join(origin, 'more.js'), 'export const more = 1\n')
    git(origin, ['add', '.'])
    git(origin, ['commit', '-qm', 'more'])
    const head2 = git(origin, ['rev-parse', 'HEAD']).out
    git(origin, ['update-ref', 'refs/pull/7/head', head2])
    needs.cli = gh(() => head2)
    const answer = await say(needs, root)
    expect(answer).toContain('re-review 2')
    const run = runOf(root, 'app-7-c3d4')
    expect(run.round).toBe(2)
    expect(existsSync(join(dir(root, run.id), 'delta.patch'))).toBe(true)
    agentsDo(root, run)
    await report(needs, root, run)
    const reviewing = runOf(root, 'app-7-c3d4')
    agentsDo(root, reviewing)
    await report(needs, root, reviewing)
    expect(runOf(root, 'app-7-c3d4').rejected.some((one) => one.why.includes('not about new code'))).toBe(true)
  })
})
