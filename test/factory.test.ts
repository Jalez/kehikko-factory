import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, done, movesNeeded, published, say, type Needs } from '../factory.ts'
import { git } from '../git.ts'
import type { BoardMap } from '../job/board.ts'
import type { Job } from '../job/shape.ts'
import { jobDir, readJob, readSettings } from '../store.ts'
import { scratchRepo, testNeeds, write } from './repo.ts'

let repo: ReturnType<typeof scratchRepo>
afterEach(() => repo?.done())

const SESSION = 'session-1234-abcd'
const ID = 'make-the-greeting-shout-a1b2'

function start(needs: Needs, words = 'Make the greeting shout') {
  return say({ session: SESSION, say: words, cwd: repo.root }, needs)
}

const report = (needs: Needs, job: Job, failed: string | null = null) =>
  done({ project: repo.root, job: job.id, step: job.stage, round: String(job.round), session: SESSION, failed }, needs)

const jobNow = () => { const read = readJob(repo.root, ID); if (!read.ok || !read.value) throw new Error("no job"); return read.value }
const file = (name: string) => join(jobDir(repo.root, ID)!, name)

/** The agents, standing in: each writes what its prompt asks for. */
function agentsDo(job: Job, opts: { verdict?: 'APPROVE' | 'CHANGES'; required?: number; ruling?: 'merge' | 'hand-over' } = {}) {
  switch (job.stage) {
    case 'spec':
      return write(file('spec.md'), '# Shout\n## Goal\nGreet loudly.\n## Must\n1. Uppercase.\n')
    case 'plan':
      return write(file('plan.md'), '## Angles\n- correctness: uppercase in every case\n- tests: a test for it\n')
    case 'build':
      writeFileSync(join(job.git!.worktree, 'greet.js'), `export const greet = (name) => \`HELLO, \${name}\`.toUpperCase() // round ${job.round}\n`)
      git(job.git!.worktree, ['commit', '-qam', `shout, round ${job.round}`])
      return write(file('build.md'), `## Round ${job.round}\nDone.\n`)
    case 'review':
      for (const angle of job.angles) write(file(`round-${job.round}/review-${angle.id}.md`), `Verdict: ${opts.verdict ?? 'APPROVE'}\n## Points\n1. x\n`)
      return
    case 'counter':
      for (const angle of job.angles) write(file(`round-${job.round}/counter-${angle.id}.md`), '## Points\n1. Conceded.\n')
      return
    case 'judge': {
      const required = Array.from({ length: opts.required ?? 0 }, (_, i) => `- required | correctness | fix ${i}`)
      return write(file(`round-${job.round}/judgement.md`), `## Rulings\n${required.join('\n')}\n- optional | tests | nicer\n\n## Ruling\n${required.length ? 'changes' : (opts.ruling ?? 'merge')}\n`)
    }
  }
}

/** Run the job until it stops running, the agents doing as told. Returns the last answer. */
async function runToRest(needs: Needs, opts: Parameters<typeof agentsDo>[1] = {}) {
  let answer = ''
  for (let i = 0; i < 40; i++) {
    const job = jobNow()
    if (!['spec', 'plan', 'build', 'review', 'counter', 'judge'].includes(job.stage)) return answer
    agentsDo(job, opts)
    answer = await report(needs, job)
  }
  throw new Error('did not come to rest')
}

describe('/factory, from a sentence to a decision', () => {
  test('a job starts at the spec, and the answer is a STEP with the spec writer\'s prompt and a report command', async () => {
    repo = scratchRepo()
    const answer = await start(testNeeds([repo.root]))
    expect(answer.startsWith('Factory: job make-the-greeting-shout-a1b2')).toBe(true)
    expect(answer).toContain('STEP: start this subagent')
    expect(answer).toContain('You are the spec writer')
    expect(answer).toContain("'http://127.0.0.1:8040/api/skill/done'")
    expect(jobNow().stage).toBe('spec')
  })

  test('a folder the host does not hold is refused, and nothing is written', async () => {
    repo = scratchRepo()
    const answer = await start(testNeeds([]))
    expect(answer).toContain('not a project open in Kehikot')
    expect(answer.trim().endsWith('Stop.')).toBe(true)
    expect(existsSync(join(repo.root, '.kehikot'))).toBe(false)
  })

  test('approved by the judge, the job waits for the person by default, and the reviewers run in parallel', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root])
    await start(needs)
    agentsDo(jobNow())
    await report(needs, jobNow())
    agentsDo(jobNow())
    const build = await report(needs, jobNow())
    expect(build).toContain('You are the builder')
    expect(jobNow().git?.worktree).toBe(join(repo.root, '..', 'app-factory', ID))
    agentsDo(jobNow())
    const review = await report(needs, jobNow())
    expect(review).toContain('start these 2 subagents AT ONCE')
    const last = await runToRest(needs)
    const job = jobNow()
    expect(job.stage).toBe('waiting')
    expect(job.waiting?.why).toBe('judge-approved')
    expect(last).toContain('is waiting for you')
    expect(existsSync(file('decision.md'))).toBe(true)
    expect(git(repo.root, ['log', '--oneline', 'main']).out.split('\n').length).toBe(1)
  })

  test('the counter-arguers are started only for reviews that asked for changes, and the judge sends back only required points', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root])
    await start(needs)
    for (const _ of [0, 1, 2]) {
      agentsDo(jobNow())
      await report(needs, jobNow())
    }
    write(file('round-1/review-correctness.md'), 'Verdict: CHANGES\n## Points\n1. lowercase input\n')
    write(file('round-1/review-tests.md'), 'Verdict: APPROVE\n')
    const counter = await report(needs, jobNow())
    expect(counter).toContain('counter-arguer (correctness)')
    expect(counter).not.toContain('counter-arguer (tests)')
    write(file('round-1/counter-correctness.md'), '## Points\n1. Conceded.\n')
    await report(needs, jobNow())
    agentsDo(jobNow(), { required: 1 })
    const back = await report(needs, jobNow())
    expect(jobNow().stage).toBe('build')
    expect(back).toContain('fix 0')
    expect(back).not.toContain('nicer')
  })

  test('with the switch on, the judge merges, and the worktree goes once the merge is confirmed', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root])
    act(repo.root, { act: 'settings', judgeMerges: true }, needs)
    await start(needs)
    const last = await runToRest(needs)
    const job = jobNow()
    expect(job.stage).toBe('merged')
    expect(job.merge?.by).toBe('judge')
    expect(last).toContain('merged into main')
    expect(existsSync(job.git!.worktree)).toBe(false)
    expect(git(repo.root, ['show', 'main:greet.js']).out).toContain('toUpperCase')
  })

  test('the person approves; a conflict is refused and the job stays theirs', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root])
    await start(needs)
    await runToRest(needs)
    writeFileSync(join(repo.root, 'greet.js'), 'export const greet = () => "main went its own way"\n')
    git(repo.root, ['commit', '-qam', 'main moves'])
    const refused = act(repo.root, { act: 'approve', job: ID }, needs)
    expect(refused.ok).toBe(false)
    expect(jobNow().waiting?.why).toBe('merge-refused')
    expect(existsSync(jobNow().git!.worktree)).toBe(true)
    git(repo.root, ['reset', '-q', '--hard', 'HEAD~1'])
    const typed = await say({ session: SESSION, say: `approve ${ID}`, cwd: repo.root }, needs)
    expect(typed).toContain('merged into main')
    expect(jobNow().merge?.by).toBe('person')
  })

  test('a missing or malformed file is asked for again, and the job fails after the retries', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root])
    await start(needs)
    agentsDo(jobNow())
    await report(needs, jobNow())
    write(file('plan.md'), 'no angles here')
    const again = await report(needs, jobNow())
    expect(again).toContain('First: plan.md has no "## Angles" section')
    await report(needs, jobNow())
    const failed = await report(needs, jobNow())
    expect(jobNow().stage).toBe('failed')
    expect(failed).toContain('failed')
  })

  test('a report from another conversation is refused', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root])
    await start(needs)
    const other = await done({ project: repo.root, job: ID, step: 'spec', round: '0', session: 'someone-else-99', failed: null }, needs)
    expect(other).toContain('/factory resume')
  })

  test('/factory next takes a job sent back from the board first, then the queue', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root])
    await start(needs)
    await runToRest(needs)
    expect(act(repo.root, { act: 'send-back', job: ID, note: 'Only uppercase the name.' }, needs).ok).toBe(true)
    const next = await say({ session: 'session-next-0001', say: 'next', cwd: repo.root }, needs)
    expect(next).toContain('Only uppercase the name.')
    expect([jobNow().stage, jobNow().round]).toEqual(['build', 2])
    act(repo.root, { act: 'queue', items: [{ text: 'Add a farewell' }] }, needs)
    const queued = await say({ session: 'session-next-0002', say: 'next', cwd: repo.root }, { ...needs, suffix: () => 'c3d4' })
    expect(queued).toContain('add-a-farewell-c3d4')
  })

  test('nothing is written in the project\'s tree: only .kehikot/factory, and the worktree beside it', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root])
    await start(needs)
    await runToRest(needs)
    expect(git(repo.root, ['status', '--porcelain', '--untracked-files=all']).out.split('\n').every((line) => line.includes('.kehikot/factory/'))).toBe(true)
    expect(readdirSync(join(repo.root, '.kehikot'))).toEqual(['factory'])
  })
})

describe('the project\'s own board', () => {
  const board: BoardMap = {
    kind: 'github',
    repo: 'jalez/app',
    board: 'Roadmap',
    columns: { spec: 'Todo', plan: 'Todo', build: 'In Progress', review: 'In Review', judge: 'In Review', waiting: null, merged: 'Done', failed: null },
    confirmed: true,
  }
  const github = () => ({ owner: 'jalez', number: 3, projectId: 'PVT_1', fieldId: 'F_1', options: { Todo: 'o1', 'In Progress': 'o2', 'In Review': 'o3', Done: 'o4' } })

  test('the mapping is kept in settings.json, and a guess moves nothing until confirmed', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root], { github })
    expect(act(repo.root, { act: 'board', board: { ...board, confirmed: false } }, needs).ok).toBe(true)
    expect(readSettings(repo.root).board?.board).toBe('Roadmap')
    const answer = await start(needs, 'Make the greeting shout --issue jalez/app#7')
    expect(answer).not.toContain('MOVE')
    expect(movesNeeded(repo.root, needs)).toEqual([])
    expect(act(repo.root, { act: 'board', board: { nope: 1 } }, needs).ok).toBe(false)
  })

  test('a move is issued once per change of column, "no column" moves nothing, and no issue moves nothing', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root], { github })
    act(repo.root, { act: 'board', board }, needs)
    const first = await start(needs, 'Make the greeting shout --issue jalez/app#7')
    expect(first).toContain('MOVE first')
    expect(first).toContain('gh project item-add 3 --owner jalez --url https://github.com/jalez/app/issues/7')
    expect(first).toContain('--single-select-option-id o1')
    expect(jobNow().column).toBe('Todo')
    agentsDo(jobNow())
    const plan = await report(needs, jobNow())
    expect(plan).not.toContain('MOVE')
    agentsDo(jobNow())
    const build = await report(needs, jobNow())
    expect(build).toContain('--single-select-option-id o2')
    const rest = await runToRest(needs)
    expect(jobNow().stage).toBe('waiting')
    expect(rest).not.toContain('MOVE')
    expect(jobNow().column).toBe('In Review')
    expect(published(jobNow(), readSettings(repo.root).board)).toEqual({
      id: ID,
      title: 'Make the greeting shout',
      ref: 'jalez/app#7',
      stage: 'waiting',
      column: null,
      place: null,
      updatedAt: jobNow().updatedAt,
    })
  })

  test('a job with no issue is offered one, and a link makes the board follow it', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root], { github, remote: () => ({ kind: 'github', repo: 'jalez/app' }) })
    act(repo.root, { act: 'board', board }, needs)
    const answer = await start(needs)
    expect(answer).toContain(`/factory issue ${ID} new`)
    expect(answer).not.toContain('MOVE')
    const create = await say({ session: SESSION, say: `issue ${ID} new`, cwd: repo.root }, needs)
    expect(create).toContain('gh issue create --repo jalez/app --title "Make the greeting shout"')
    const linked = await say({ session: SESSION, say: `issue ${ID} https://github.com/jalez/app/issues/9`, cwd: repo.root }, needs)
    expect(linked).toContain('jalez/app#9')
    expect(linked).toContain('MOVE first')
  })

  test('a GitLab board moves by label, and a failed move is not asked again for that column', async () => {
    repo = scratchRepo()
    const needs = testNeeds([repo.root])
    act(repo.root, { act: 'board', board: { kind: 'gitlab', repo: 'group/app', board: 'Development', columns: { spec: 'Doing', build: 'Doing', merged: 'Done' }, confirmed: true } }, needs)
    const first = await start(needs, 'Make the greeting shout --issue group/app#4')
    expect(first).toContain('glab issue update 4 --repo group/app --label "Doing" --unlabel "Done"')
    const { moveFailedFor } = await import('../factory.ts')
    moveFailedFor(repo.root, ID)
    expect(movesNeeded(repo.root, needs)).toEqual([])
  })
})
