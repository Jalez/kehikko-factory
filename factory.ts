import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { addWorktree, cleanup, git, mainBranch, mainCheckout, merge } from './git.ts'
import { boardSchema, columnFor, issueUrl, moveFor, moveText, readIssue, refOf, shellSafe, type BoardMap, type GithubIds, type Moving } from './job/board.ts'
import { advance, describeStage, isRunning, newJob, type Event } from './job/flow.ts'
import { parseJudgement, parsePlan, parseVerdict, splitAngles, type Verdict } from './review/parse.ts'
import { KNOWN_ANGLES, MAX_ANGLES, MAX_BRIEF, SETTLED, ANGLE_ID, type Angle, type Job, type JobPlace } from './job/shape.ts'
import { SAID, instruct, stepFor, stopped } from './job/steps.ts'
import { placeOfSession } from './place.ts'
import { githubIds, remoteOf, type Remote } from './tracker.ts'
import {
  jobDir,
  jobFile,
  listJobs,
  makeJobDir,
  readJob,
  readKnownParts,
  readQueue,
  readSettings,
  writeDecision,
  writeJob,
  writeQueue,
  writeSettings,
  writeKnownParts,
  type KnownPart,
  type Result,
} from './store.ts'

/**
 * The factory's work on the server: what `/factory` asks (`say`), what a step's report does
 * (`done`), and what the person does in the board (`act`). Every change of a job goes through
 * `advance` (job/flow.ts) and is written here, so job.json has one writer: this module, moved by the
 * conversation that runs the job and by the person — never by an agent's own hand.
 */

export interface Needs {
  /** The host's word on a folder: the project's path now, or why not (`resolveDoorProject`). */
  resolve(folder: string): Promise<{ ok: true; path: string } | { ok: false; why: string }>
  /** The origin this module serves on, for the report commands. */
  origin(): string
  now(): string
  /** Four hex digits for a job id. */
  suffix(): string
  /** The repository the project's origin is, on GitHub or GitLab, or null. */
  remote(root: string): Remote | null
  /** What a GitHub move needs for a board, by name, or why it cannot be found (`tracker.ts`). */
  github(root: string, repo: string, board: string): GithubIds | string
}

export const realNeeds = (resolve: Needs['resolve'], origin: () => string): Needs => ({
  resolve,
  origin,
  now: () => new Date().toISOString(),
  suffix: () => randomBytes(2).toString('hex'),
  remote: remoteOf,
  github: (root, repo, board) => githubIds(root, repo, board),
})

/** How many times one step is given again for a file that is missing or malformed, before the job fails. */
export const RETRIES = 2
const retried = new Map<string, number>()

/* ------------------------------------------------------------------ *
 * /factory …
 * ------------------------------------------------------------------ */

export const HELP = [
  '/factory <feature> [--angles a,b]   start a job: spec → plan → build → review → judge',
  '/factory next                       build what is next: a job sent back to you, the queue, or a part of your epic with no job',
  '/factory approve <job>              merge a job that is waiting for you',
  '/factory rework <job> <note>        send a waiting job back to the builder with your note, and build it now',
  '/factory status                     the jobs of this project',
  '/factory resume <job>               carry on a job here whose conversation stopped',
  '/factory issue <job> new|<ref>|none create the job\'s issue, link one (owner/repo#12), or keep it board-only',
]

export interface Said {
  session: string
  say: string
  cwd: string
}

/** Which project a conversation is in: the repository's main checkout, as the host has it. */
async function projectOf(cwd: string, needs: Needs): Promise<{ ok: true; root: string } | { ok: false; why: string }> {
  if (!cwd) return { ok: false, why: 'The skill did not say which folder the conversation is in.' }
  const top = mainCheckout(cwd)
  if (!top) return { ok: false, why: `${cwd} is not in a git repository. Factory builds in git worktrees, so a job needs one.` }
  const held = await needs.resolve(top)
  if (!held.ok) return { ok: false, why: `${held.why} Factory works on a project open in Kehikot.` }
  return { ok: true, root: held.path }
}

export async function say(input: Said, needs: Needs): Promise<string> {
  const session = input.session.trim()
  if (!/^[A-Za-z0-9-]{8,64}$/.test(session)) return stopped(['the skill did not pass this conversation\'s id, so no job can be run from it.'])
  const project = await projectOf(input.cwd, needs)
  if (!project.ok) return stopped([project.why])
  const root = project.root
  const words = input.say.trim()
  const [head = '', ...rest] = words.split(/\s+/)
  const command = head.toLowerCase()

  const answer = await (async () => {
    if (!words || command === 'help') return stopped(['what /factory can do:', ...HELP])
    if (command === 'status') return status(root)
    if (command === 'next') return next(root, session, needs)
    if (command === 'approve') return approveSaid(root, rest[0] ?? '', needs)
    if (command === 'rework') return reworkSaid(root, rest[0] ?? '', rest.slice(1).join(' '), session, needs)
    if (command === 'resume') return resumeSaid(root, rest[0] ?? '', session, needs)
    if (command === 'issue') return issueSaid(root, rest[0] ?? '', rest.slice(1).join(' '), session, needs)
    return start(root, words, session, needs)
  })()
  return withMoves(root, answer, needs)
}

/* ------------------------------------------------------------------ *
 * The project's own board: issues, and moving them
 * ------------------------------------------------------------------ */

/** The repository issues of this project are in: the mapping's, else the origin's. */
function issueRepo(root: string, needs: Needs): { kind: 'github' | 'gitlab'; repo: string } | null {
  const board = readSettings(root).board
  if (board) return { kind: board.kind, repo: board.repo }
  const remote = needs.remote(root)
  return remote ? { kind: remote.kind, repo: remote.repo } : null
}

/** Every move the project's board needs now, for every job of the project. */
export function movesNeeded(root: string, needs: Needs): Moving[] {
  const board = readSettings(root).board
  if (!board?.confirmed) return []
  const out: Moving[] = []
  let ids: GithubIds | string | null = null
  for (const job of listJobs(root)) {
    if (job.archived || !job.ref || !columnFor(board, job.stage)) continue
    if (board.kind === 'github' && ids === null) ids = needs.github(root, board.repo, board.board)
    const moving = moveFor(job, board, ids)
    if (moving) out.push(moving)
  }
  return out
}

const failedMoveCommand = (origin: string, root: string, job: string) =>
  `curl -s -m 30 -X POST -G --data-urlencode "project=${root.replace(/["\\$`]/g, '')}" --data-urlencode "job=${job}" '${origin}/api/skill/moved'`

/**
 * An answer with the board's moves put in after its first line. A move given out is written down
 * as made (`column`); the conversation reports one that failed (`moveFailed`), and it is not asked
 * again for that column.
 */
export function withMoves(root: string, answer: string, needs: Needs): string {
  const movings = movesNeeded(root, needs)
  if (!movings.length) return answer
  for (const moving of movings) {
    if (moving.kind !== 'move') continue
    const read = readJob(root, moving.move.job)
    if (read.ok && read.value) writeJob(root, { ...read.value, column: moving.move.column, moveFailed: null })
  }
  const lines = moveText(movings, (job) => failedMoveCommand(needs.origin(), root, job))
  const [first, ...rest] = answer.split('\n')
  return [first, ...lines, ...rest].join('\n')
}

/** The conversation could not move a job's issue: kept, so it is not asked again for that column. */
export function moveFailedFor(root: string, id: string): Result<null> {
  const read = readJob(root, id)
  if (!read.ok) return read
  if (!read.value) return { ok: false, error: `There is no job "${id}".` }
  const failed = read.value.column
  return writeJob(root, { ...read.value, column: null, moveFailed: failed })
}

async function issueSaid(root: string, said: string, what: string, session: string, needs: Needs): Promise<string> {
  const found = findJob(root, said)
  if (!found.ok) return stopped([found.error])
  const job = found.value
  const want = what.trim()
  if (!want) return stopped([`say what to do with the issue of ${job.id}: new, a ref (owner/repo#12), or none.`])
  if (want === 'none') {
    const written = writeJob(root, { ...job, ref: null, column: null, moveFailed: null, updatedAt: needs.now() })
    return stopped([written.ok ? `${job.id} stays on the Factory board only, with no issue.` : written.error])
  }
  const repo = issueRepo(root, needs)
  if (want === 'new') {
    if (!repo) return stopped(['this project\'s origin is not on GitHub or GitLab, so there is nowhere to open an issue. The job stays on the Factory board.'])
    const title = shellSafe(job.title, 120)
    const body = shellSafe(`Opened by Kehikot Factory for the job ${job.id}. ${job.feature}`, 600)
    const create = repo.kind === 'github'
      ? `gh issue create --repo ${repo.repo} --title "${title}" --body "${body}"`
      : `glab issue create --repo ${repo.repo} --title "${title}" --description "${body}" --yes`
    return [
      `${SAID} the person asked for an issue for job ${job.id}.`,
      '',
      'STEP: run this with the Bash tool, exactly as written. It prints the new issue\'s URL.',
      '',
      create,
      '',
      'REPORT: then run this, with ISSUE_URL replaced by the URL it printed:',
      '',
      `curl -s -m 30 -X POST -G --data-urlencode "project=${root.replace(/["\\$`]/g, '')}" --data-urlencode "job=${job.id}" --data-urlencode "session=${session}" --data-urlencode "ref=ISSUE_URL" -w '\\n[curl exit %{exitcode}; HTTP %{http_code}]\\n' '${needs.origin()}/api/skill/issue'`,
      '',
      'If the first command fails, tell the person what it said in one line and stop.',
    ].join('\n')
  }
  return linkIssue(root, job.id, want, needs)
}

/** Link a job to its issue (typed, or the one the conversation just opened). */
export function linkIssue(root: string, id: string, said: string, needs: Needs): string {
  const read = readJob(root, id)
  if (!read.ok) return stopped([read.error])
  if (!read.value) return stopped([`there is no job "${id}".`])
  const issue = readIssue(said, issueRepo(root, needs))
  if (!issue) return stopped([`"${said.slice(0, 120)}" is not an issue: give its URL or owner/repo#12.`])
  const ref = refOf(issue)
  const written = writeJob(root, { ...read.value, ref, column: null, moveFailed: null, updatedAt: needs.now() })
  if (!written.ok) return stopped([written.error])
  return stopped([`${id} is linked to ${ref} (${issueUrl(issue)}). The project's board follows it from now on, where its stages are mapped.`])
}

/** A job's stage as other modules read it: the shape of the door's `jobs` and `GET /api/jobs?ref=`. */
export function published(job: Job, board: BoardMap | null) {
  return { id: job.id, title: job.title, ref: job.ref, stage: job.stage, column: columnFor(board, job.stage), place: job.place, updatedAt: job.updatedAt }
}

function status(root: string): string {
  const jobs = listJobs(root).filter((job) => !job.archived)
  if (!jobs.length) return stopped(['no jobs in this project yet. Type /factory <feature> to start one.'])
  return stopped([
    `${jobs.length} job${jobs.length === 1 ? '' : 's'} in this project:`,
    ...jobs.map((job) => `- ${job.id} — ${job.title} — ${describeStage(job)}${job.waiting ? ` (${job.waiting.said})` : ''}`),
  ])
}

/** A job by its id, or by the start of one when only one job starts so. */
function findJob(root: string, said: string): Result<Job> {
  const wanted = said.trim().toLowerCase()
  if (!wanted) return { ok: false, error: 'Name the job: its id is on its card in the board, and in /factory status.' }
  const jobs = listJobs(root)
  const exact = jobs.find((job) => job.id === wanted)
  if (exact) return { ok: true, value: exact }
  const some = jobs.filter((job) => job.id.startsWith(wanted))
  if (some.length === 1) return { ok: true, value: some[0]! }
  return { ok: false, error: some.length ? `"${said}" could be ${some.map((job) => job.id).join(' or ')}.` : `There is no job "${said}" in this project.` }
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'job'
  )
}

function titleOf(feature: string): string {
  const first = feature.split(/(?<=[.!?])\s|\n/)[0]!.trim()
  return first.length <= 80 ? first : `${first.slice(0, 79)}…`
}

async function start(root: string, words: string, session: string, needs: Needs, place: JobPlace | null = null): Promise<string> {
  const issued = /(?:^|\s)--issue(?:=|\s+)(\S+)/.exec(words)
  const rest = issued ? (words.slice(0, issued.index) + words.slice(issued.index + issued[0].length)).trim() : words
  const issue = issued ? readIssue(issued[1]!, issueRepo(root, needs)) : null
  if (issued && !issue) return stopped([`--issue: "${issued[1]!.slice(0, 120)}" is not an issue (give its URL or owner/repo#12). Nothing was started.`])
  const split = splitAngles(rest)
  if (split.bad) return stopped([`--angles: ${split.bad}. Nothing was started.`])
  if (!split.feature) return stopped(['say what to build: /factory <feature>.'])
  if (!mainBranch(root)) return stopped(['this repository has no main (or master) branch with a commit on it. Factory branches each job from main.'])
  const id = `${slug(split.feature)}-${needs.suffix()}`
  const now = needs.now()
  const job = newJob({ id, title: titleOf(split.feature), feature: split.feature.slice(0, 4000), anglesAsked: split.angles, place: place ?? placeOfSession(root, session), session, now, ref: issue ? refOf(issue) : null })
  const made = makeJobDir(root, id)
  if (!made.ok) return stopped([made.error])
  const written = writeJob(root, job)
  if (!written.ok) return stopped([written.error])
  const answer = await nextFor(root, job, session, needs)
  if (job.ref || !issueRepo(root, needs)) return answer
  const [first, ...more] = answer.split('\n')
  return [first, '', `NOTE for the person, at the end: this job has no issue. /factory issue ${id} new opens one, /factory issue ${id} <owner/repo#n> links one; otherwise it stays on the Factory board.`, ...more].join('\n')
}

async function next(root: string, session: string, needs: Needs): Promise<string> {
  const jobs = listJobs(root)
  const sentBack = jobs.filter((job) => job.stage === 'waiting' && job.waiting?.why === 'sent-back').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0]
  if (sentBack) {
    const moved = commit(root, sentBack, { kind: 'resume', session }, needs)
    if (!moved.ok) return stopped([moved.error])
    return nextFor(root, moved.value, session, needs)
  }
  const queue = readQueue(root)
  const first = queue[0]
  if (first) {
    const left = writeQueue(root, queue.slice(1))
    if (!left.ok) return stopped([left.error])
    const place = first.epic ? { epic: first.epic, ...(first.parts.length ? { parts: first.parts } : {}) } : null
    return start(root, first.text, session, needs, place)
  }
  const here = placeOfSession(root, session)
  if (here?.epic) {
    const parts = readKnownParts(root)[here.epic] ?? []
    const taken = new Set(jobs.filter((job) => job.place?.epic === here.epic).flatMap((job) => job.place?.parts ?? []))
    const open = parts.find((part) => !taken.has(part.id))
    if (open) {
      const feature = `${open.heading}\n\nThis is the part "${open.heading}" of the epic "${here.epic}". Build what that part needs.`
      return start(root, feature, session, needs, { epic: here.epic, parts: [open.id], ...(here.kehikko ? { kehikko: here.kehikko } : {}) })
    }
  }
  return stopped([
    'nothing is next: no job was sent back to you, the queue in the board is empty'
      + (here?.epic ? `, and every part of the epic "${here.epic}" the board has seen already has a job.` : ', and this conversation is not placed on an epic in Kehikot.'),
    'Add to the queue in the Factory board, or type /factory <feature>.',
  ])
}

async function approveSaid(root: string, said: string, needs: Needs): Promise<string> {
  const found = findJob(root, said)
  if (!found.ok) return stopped([found.error])
  const done = approve(root, found.value, needs)
  return stopped([done.ok ? done.value : done.error])
}

async function reworkSaid(root: string, said: string, note: string, session: string, needs: Needs): Promise<string> {
  const found = findJob(root, said)
  if (!found.ok) return stopped([found.error])
  const moved = commit(root, found.value, { kind: 'rework', note, now: true }, needs)
  if (!moved.ok) return stopped([moved.error])
  const claimed = { ...moved.value, session }
  const written = writeJob(root, claimed)
  if (!written.ok) return stopped([written.error])
  return nextFor(root, claimed, session, needs)
}

async function resumeSaid(root: string, said: string, session: string, needs: Needs): Promise<string> {
  const found = findJob(root, said)
  if (!found.ok) return stopped([found.error])
  const job = found.value
  if (!isRunning(job)) return stopped([`${job.id} is ${describeStage(job)}; there is nothing to carry on.`])
  const claimed = { ...job, session, updatedAt: needs.now() }
  const written = writeJob(root, claimed)
  if (!written.ok) return stopped([written.error])
  return nextFor(root, claimed, session, needs)
}

/* ------------------------------------------------------------------ *
 * A step's report
 * ------------------------------------------------------------------ */

export interface Report {
  project: string
  job: string
  step: string
  round: string
  session: string
  failed: string | null
}

export async function done(report: Report, needs: Needs): Promise<string> {
  const held = await needs.resolve(report.project)
  if (!held.ok) return stopped([held.why])
  return withMoves(held.path, await doneIn(held.path, report, needs), needs)
}

async function doneIn(root: string, report: Report, needs: Needs): Promise<string> {
  const read = readJob(root, report.job)
  if (!read.ok) return stopped([read.error])
  const job = read.value
  if (!job) return stopped([`there is no job "${report.job}" in this project.`])
  if (job.session !== report.session) {
    return stopped([
      isRunning(job)
        ? `another conversation is running ${job.id}. To carry it on here instead, type /factory resume ${job.id}.`
        : `${job.id} is ${describeStage(job)}; nothing is being run for it.`,
    ])
  }
  if (job.stage !== report.step || String(job.round) !== report.round) {
    return nextFor(root, job, report.session, needs, `that report was for ${report.step} (round ${report.round}), but the job has moved on.`)
  }
  if (report.failed !== null) {
    const moved = commit(root, job, { kind: 'fail', why: report.failed.trim().slice(0, 300) || 'a subagent could not do its job.' }, needs)
    return moved.ok ? ended(root, moved.value) : stopped([moved.error])
  }

  const text = (name: string): string | null => {
    const path = jobFile(root, job.id, name)
    return path && existsSync(path) ? readFileSync(path, 'utf8') : null
  }
  const again = (fix: string, only: string[] | null = null): Promise<string> => {
    const key = `${root}\u0000${job.id}\u0000${job.stage}\u0000${job.round}`
    const count = (retried.get(key) ?? 0) + 1
    retried.set(key, count)
    if (count > RETRIES) {
      const moved = commit(root, job, { kind: 'fail', why: `${fix} (given ${RETRIES} more tries)` }, needs)
      return Promise.resolve(moved.ok ? ended(root, moved.value) : stopped([moved.error]))
    }
    return nextFor(root, job, report.session, needs, fix, only)
  }

  let event: Event
  switch (job.stage) {
    case 'spec':
      if (!text('spec.md')?.trim()) return again('spec.md is not there. Start the spec writer again.')
      event = { kind: 'spec' }
      break
    case 'plan': {
      const plan = text('plan.md')
      if (!plan) return again('plan.md is not there. Start the planner again.')
      const parsed = parsePlan(plan, job.anglesAsked)
      if (!parsed.ok) return again(`${parsed.why} Start the planner again; it rewrites plan.md.`)
      event = { kind: 'plan', angles: parsed.value }
      break
    }
    case 'build': {
      if (!text('build.md')?.includes(`## Round ${job.round}`)) return again(`build.md has no "## Round ${job.round}" section. Start the builder again.`)
      if (job.git && job.round === 1 && git(root, ['rev-parse', job.git.branch]).out === job.git.base) {
        const moved = commit(root, job, { kind: 'fail', why: 'The builder committed nothing on the branch; build.md says why.' }, needs)
        return moved.ok ? ended(root, moved.value) : stopped([moved.error])
      }
      event = { kind: 'build' }
      break
    }
    case 'review': {
      const verdicts: Record<string, Verdict> = {}
      const missing: string[] = []
      for (const angle of job.angles) {
        const review = text(`round-${job.round}/review-${angle.id}.md`)
        const verdict = review === null ? null : parseVerdict(review)
        if (!verdict?.ok) missing.push(angle.id)
        else verdicts[angle.id] = verdict.value
      }
      if (missing.length) return again(`no readable review (with a "Verdict:" line) from: ${missing.join(', ')}. Start only those reviewers again.`, missing)
      event = { kind: 'review', verdicts }
      break
    }
    case 'counter': {
      const missing = contestedOf(root, job).filter((id) => text(`round-${job.round}/counter-${id}.md`) === null)
      if (missing.length) return again(`no counter-argument from: ${missing.join(', ')}. Start only those again.`, missing)
      event = { kind: 'counter' }
      break
    }
    case 'judge': {
      const judgement = text(`round-${job.round}/judgement.md`)
      if (!judgement) return again('judgement.md is not there. Start the judge again.')
      const parsed = parseJudgement(judgement, job.angles.map((one) => one.id))
      if (!parsed.ok) return again(`${parsed.why} Start the judge again; it rewrites judgement.md.`)
      event = { kind: 'judge', judged: parsed.value }
      break
    }
    default:
      return stopped([`${job.id} is ${describeStage(job)}; nothing is being run for it.`])
  }

  const moved = advance(job, event, readSettings(root), needs.now())
  if (!moved.ok) return stopped([moved.why])
  let after = moved.job
  const written = writeJob(root, after)
  if (!written.ok) return stopped([written.error])

  if (moved.merge === 'judge') {
    const merged = mergeNow(root, after, 'judge', needs)
    return merged.ok ? ended(root, merged.value) : stopped([merged.error])
  }
  if (after.stage === 'build' && !after.git) {
    const made = addWorktree(root, after.id)
    const next = commit(root, after, made.ok ? { kind: 'worktree', git: made.git } : { kind: 'fail', why: made.why }, needs)
    if (!next.ok) return stopped([next.error])
    after = next.value
  }
  return nextFor(root, after, report.session, needs)
}

/** The angles whose review asked for changes this round. */
function contestedOf(root: string, job: Job): string[] {
  return job.angles
    .filter((angle) => {
      const path = jobFile(root, job.id, `round-${job.round}/review-${angle.id}.md`)
      if (!path || !existsSync(path)) return false
      const verdict = parseVerdict(readFileSync(path, 'utf8'))
      return verdict.ok && verdict.value === 'changes'
    })
    .map((angle) => angle.id)
}

/** The next thing to tell the conversation about a job: its step, or how it ended. */
function nextFor(root: string, job: Job, session: string, needs: Needs, fix: string | null = null, only: string[] | null = null): Promise<string> {
  if (!isRunning(job)) return Promise.resolve(ended(root, job))
  const where = { root, dir: jobDir(root, job.id)! }
  if (job.round > 0) makeJobDir(root, job.id, job.round)
  const contested = job.stage === 'counter' || job.stage === 'judge' ? contestedOf(root, job) : []
  const step = stepFor(job, where, only, contested)
  if (!step || !step.agents.length) return Promise.resolve(stopped([`${job.id} is at ${describeStage(job)}, which has nobody to start. This is a fault in Factory.`]))
  return Promise.resolve(instruct(job, step, { origin: needs.origin(), project: root, session, fix }))
}

/** How a job that is no longer running is said, and its decision.md written. */
function ended(root: string, job: Job): string {
  writeDecision(root, job.id, decisionText(job))
  if (job.stage === 'merged') {
    return stopped([
      `${job.id} — "${job.title}" — is merged into ${job.git?.main ?? 'main'} (${job.merge?.commit.slice(0, 10)}), ${job.merge?.by === 'judge' ? 'by the judge, as the switch in the board allows' : 'as you approved'}.`,
      job.merge?.left ? job.merge.left : 'Its worktree and branch were removed.',
    ])
  }
  if (job.stage === 'failed') return stopped([`${job.id} — "${job.title}" — failed: ${job.failed}`, 'Its files are in the Factory board. /factory rework <job> <note> can send it back to the builder.'])
  if (job.stage === 'waiting') {
    return stopped([
      `${job.id} — "${job.title}" — is waiting for you. ${job.waiting?.said ?? ''}`,
      ...(job.required.length ? ['Still required:', ...job.required.map((one) => `- (${one.angle}) ${one.point}`)] : []),
      job.waiting?.why === 'sent-back'
        ? 'Type /factory next to build it.'
        : `Approve and merge it in the Factory board or with /factory approve ${job.id}; or send it back with /factory rework ${job.id} <note>.`,
    ])
  }
  return stopped([`${job.id} is ${describeStage(job)}.`])
}

function decisionText(job: Job): string {
  const out = [`# Decision: ${job.title}`, '', `Job ${job.id}, after ${job.round} round${job.round === 1 ? '' : 's'}.`, '']
  if (job.ruling) out.push(`The judge's last ruling: **${job.ruling}**.`, '')
  if (job.stage === 'merged' && job.merge) {
    out.push(`Merged into \`${job.git?.main}\` as ${job.merge.commit}, ${job.merge.by === 'judge' ? 'by the judge (the person allowed it in the board)' : 'approved by the person'}, at ${job.merge.at}.`)
    out.push(job.merge.left ? `Cleanup: ${job.merge.left}` : 'The worktree and the branch were removed after the merge was confirmed.')
  } else if (job.stage === 'failed') {
    out.push(`Failed: ${job.failed}`)
  } else if (job.stage === 'waiting' && job.waiting) {
    out.push(`Handed to the person: ${job.waiting.said}`)
    if (job.note) out.push('', 'The note it was sent back with:', '', ...job.note.split('\n').map((line) => `> ${line}`))
  }
  if (job.required.length) out.push('', '## Still required', '', ...job.required.map((one) => `- (${one.angle}) ${one.point}`))
  return `${out.join('\n')}\n`
}

/* ------------------------------------------------------------------ *
 * Moving and merging
 * ------------------------------------------------------------------ */

function commit(root: string, job: Job, event: Event, needs: Needs): Result<Job> {
  const moved = advance(job, event, readSettings(root), needs.now())
  if (!moved.ok) return { ok: false, error: moved.why }
  const written = writeJob(root, moved.job)
  return written.ok ? { ok: true, value: moved.job } : written
}

/** Merge now, by the person or the judge, then remove the worktree once the merge is confirmed. */
function mergeNow(root: string, job: Job, by: 'person' | 'judge', needs: Needs): Result<Job> {
  const merged = merge(root, job)
  if (!merged.ok) return commit(root, job, { kind: 'merge-refused', why: merged.why }, needs)
  const cleaned = cleanup(root, job)
  const done = commit(root, job, { kind: 'merged', commit: merged.commit, by, cleaned: cleaned.cleaned, left: cleaned.left }, needs)
  if (done.ok) writeDecision(root, job.id, decisionText(done.value))
  return done
}

/** The person approves a waiting job: merge it. The answer says what happened, merged or not. */
export function approve(root: string, job: Job, needs: Needs): Result<string> {
  const moved = advance(job, { kind: 'approve', by: 'person' }, readSettings(root), needs.now())
  if (!moved.ok) return { ok: false, error: moved.why }
  const merged = mergeNow(root, job, 'person', needs)
  if (!merged.ok) return merged
  writeDecision(root, merged.value.id, decisionText(merged.value))
  if (merged.value.stage === 'merged') return { ok: true, value: ended(root, merged.value).replace(/\n\nStop\.$/, '').replace(/^Factory: /, '') }
  return { ok: false, error: merged.value.waiting?.said ?? 'Not merged.' }
}

/* ------------------------------------------------------------------ *
 * The person's acts in the board
 * ------------------------------------------------------------------ */

export type Act =
  | { act: 'approve'; job: string }
  | { act: 'send-back'; job: string; note: string }
  | { act: 'angles'; job: string; angles: { id: string; brief?: string }[] }
  | { act: 'archive'; job: string }
  | { act: 'settings'; judgeMerges: boolean }
  | { act: 'queue'; items: { id?: string; text: string; epic?: string | null; parts?: string[] }[] }
  | { act: 'parts'; epic: string; parts: KnownPart[] }
  | { act: 'board'; board: unknown }

/** What the board asks, on the person's press. The answer is a sentence for the board to show. */
export function act(root: string, body: Act, needs: Needs): Result<string> {
  if (body.act === 'settings') {
    const written = writeSettings(root, { ...readSettings(root), judgeMerges: body.judgeMerges === true })
    if (!written.ok) return written
    return { ok: true, value: body.judgeMerges ? 'The judge merges approved jobs by itself in this project.' : 'Approved jobs wait for you in this project.' }
  }
  if (body.act === 'board') {
    if (body.board === null) {
      const written = writeSettings(root, { ...readSettings(root), board: null })
      return written.ok ? { ok: true, value: 'Jobs stay on the Factory board; no issue is moved.' } : written
    }
    const parsed = boardSchema.safeParse(body.board)
    if (!parsed.success) return { ok: false, error: 'That is not a mapping of the stages onto a board.' }
    const written = writeSettings(root, { ...readSettings(root), board: parsed.data })
    if (!written.ok) return written
    return { ok: true, value: parsed.data.confirmed ? `Saved. Each job's issue moves on "${parsed.data.board}" as its stage changes, by the conversation running /factory.` : 'Saved as a guess; nothing moves until you confirm it.' }
  }
  if (body.act === 'queue') {
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 100).flatMap((one, i) => {
      const text = typeof one?.text === 'string' ? one.text.trim().slice(0, 2000) : ''
      if (!text) return []
      const id = typeof one.id === 'string' && one.id ? one.id.slice(0, 40) : `${Date.now().toString(36)}-${i}`
      const epic = typeof one.epic === 'string' && /^[a-z0-9-]{1,80}$/.test(one.epic) ? one.epic : null
      const parts = Array.isArray(one.parts) ? one.parts.filter((p): p is string => typeof p === 'string' && /^[a-z0-9-]{1,80}$/.test(p)).slice(0, 16) : []
      return [{ id, text, epic, parts }]
    })
    const written = writeQueue(root, items)
    return written.ok ? { ok: true, value: `${items.length} in the queue.` } : written
  }
  if (body.act === 'parts') {
    if (typeof body.epic !== 'string' || !/^[a-z0-9-]{1,80}$/.test(body.epic) || !Array.isArray(body.parts)) return { ok: false, error: 'That is not an epic\'s parts.' }
    const parts = body.parts
      .filter((one) => one && typeof one.id === 'string' && /^[a-z0-9-]{1,80}$/.test(one.id) && typeof one.heading === 'string')
      .slice(0, 128)
      .map((one) => ({ id: one.id, heading: one.heading.slice(0, 200) }))
    const written = writeKnownParts(root, body.epic, parts)
    return written.ok ? { ok: true, value: written.value ? 'kept' : 'unchanged' } : written
  }

  const found = typeof body.job === 'string' ? readJob(root, body.job) : { ok: false as const, error: 'Name the job.' }
  if (!found.ok) return found
  const job = found.value
  if (!job) return { ok: false, error: `There is no job "${String(body.job).slice(0, 60)}".` }

  if (body.act === 'approve') return approve(root, job, needs)
  if (body.act === 'send-back') {
    const moved = commit(root, job, { kind: 'rework', note: typeof body.note === 'string' ? body.note.slice(0, 4000) : '', now: false }, needs)
    if (!moved.ok) return moved
    writeDecision(root, job.id, decisionText(moved.value))
    return { ok: true, value: 'Sent back with your note. Type /factory next in a Claude Code conversation in this project to build it.' }
  }
  if (body.act === 'archive') {
    const moved = commit(root, job, { kind: 'archive' }, needs)
    return moved.ok ? { ok: true, value: 'Cleared from the board.' } : moved
  }
  if (body.act === 'angles') {
    const asked = Array.isArray(body.angles) ? body.angles : []
    const angles: Angle[] = []
    for (const one of asked.slice(0, MAX_ANGLES + 1)) {
      const id = typeof one?.id === 'string' ? one.id.trim().toLowerCase() : ''
      if (!ANGLE_ID.test(id) || id.length > 32) return { ok: false, error: `"${id.slice(0, 40)}" is not an angle id: lowercase words joined by dashes.` }
      if (angles.some((a) => a.id === id)) continue
      const kept = job.angles.find((a) => a.id === id)
      const brief = (typeof one.brief === 'string' && one.brief.trim()) || kept?.brief || KNOWN_ANGLES[id] || `Look at the change from the ${id.replace(/-/g, ' ')} angle.`
      angles.push({ id, brief: brief.slice(0, MAX_BRIEF), by: kept && !one.brief ? kept.by : 'person' })
    }
    if (angles.length > MAX_ANGLES) return { ok: false, error: `At most ${MAX_ANGLES} angles.` }
    /* Every change the person makes marks the set as theirs, so a planner finishing later keeps it. */
    const theirs = angles.map((one) => ({ ...one, by: 'person' as const }))
    const moved = commit(root, job, { kind: 'angles', angles: theirs }, needs)
    return moved.ok ? { ok: true, value: `Angles: ${theirs.map((one) => one.id).join(', ')}.` } : moved
  }
  return { ok: false, error: 'The board asked for something Factory does not do.' }
}

export { SAID, SETTLED }
