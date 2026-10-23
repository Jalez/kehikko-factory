import { DOOR_PROJECT_SAYS, KEHIKOT_DIR, doorContext, manifestSchema, type Manifest } from 'kehikot-module-protocol'
import { establishBuild, hostVouches, mintTicket, refuseTicket, sameTicket, settingsDoor, type Reply, type Stream } from 'kehikot-module-protocol/serve'

import { act, done, linkIssue, moveFailedFor, published, realNeeds, say, withMoves, type Act, type Needs } from './factory.ts'
import { actReview, doneReview, publishedRun, recordOf, reviewBoard, reviewKey, sayReview, type ReviewAct, type ReviewNeeds } from './review-factory.ts'
import { realNeighbours } from './rev/neighbours.ts'
import { runIsRunning } from './rev/flow.ts'
import type { Run } from './rev/shape.ts'
import { listRuns, readRun } from './rev/store.ts'
import { runCli } from './tracker.ts'
import { sameIssue } from './job/board.ts'
import { discover, remoteOf } from './tracker.ts'
import { resolveProject, type Resolve } from './host-ask.ts'
import { describeStage, isRunning } from './job/flow.ts'
import type { Job } from './job/shape.ts'
import { DECLARED, ID, VERSION } from './manifest.ts'
import { serveFrom, servedOrigin, skillAt, skillDeclarations } from './skills.ts'
import { jobFiles, listJobs, projectRoot, readJob, readJobFile, readJson, readQueue, readSettings, writeSettings } from './store.ts'
import { SETTINGS, SETTINGS_FILE, valuesOf, withValue } from './settings.ts'
import { lately } from './transcript.ts'
import { watchProject } from './watch.ts'

/**
 * Every door but the page, as one function: `answer` takes a request and returns a status and a
 * body, or `null` for "not ours, let Vite have it". `doors()` in vite.config.ts is the only thing
 * that touches a socket.
 *
 * ## Who may do what
 *
 *  - **The page** carries the ticket this process printed into it. It reads the jobs and their
 *    files, watches for changes, and does what the person presses: approve (a merge), send back
 *    with a note, change a job's angles before its review, clear a settled job, keep the queue and
 *    the merge switch.
 *  - **The skill**, `/factory` typed by a person in a Claude Code conversation, talks to
 *    `/api/skill/say` and `/api/skill/done` with no ticket: it is a curl in the person's terminal.
 *    It can start a job and move one it is running, one step at a time, and approve one when the
 *    person typed `/factory approve`. Every folder it names is asked of the host first.
 *  - **`/review-factory`**, typed by a person, talks to `/api/review/say` and `/api/review/done` the
 *    same way: it starts a review and moves the one it is running, a step at a time. The page's
 *    Reviews board reads `/api/review-board` and `/api/review-file` and presses `/api/review-act`
 *    (settings, door and author rules, the checklist, angles, budget, stop), with the ticket.
 *    `GET /api/reviews?change=…&projectPath=…` reads a change's reviews and their record, no ticket.
 *  - **An agent** at `/mcp` reads. It cannot start, approve, merge or send back anything, nor start,
 *    steer or send a review.
 *  - Anything else on this machine that found the port gets the health check, and the skill text.
 */

export const BUILD = establishBuild({ version: VERSION, dir: import.meta.dirname })

/** Minted per process and printed into `/app`; only this app's own page holds it. */
export const TICKET = mintTicket()

/** The manifest as served: the one in manifest.ts with the skill this module offers, for the origin it is on. */
export const MANIFEST: Manifest = manifestSchema.parse({ ...DECLARED, declares: { ...DECLARED.declares, skills: skillDeclarations() } })

/** Say the origin this process really serves on, once it is listening: the skill's text and version follow. */
export function servingAt(origin: string): void {
  serveFrom(origin)
  const skills = MANIFEST.declares?.skills
  if (skills) skills.splice(0, skills.length, ...skillDeclarations())
}

const ok = (body: unknown): Reply => ({ status: 200, body })
const bad = (why: string, status = 400): Reply => ({ status, body: { ok: false, error: why } })
const text = (said: string, status = 200): Reply => ({ status, body: null, raw: { bytes: said, type: 'text/plain; charset=utf-8' } })

const STRANGER = 'That was not asked by this app’s own page.'
const NOT_A_PROJECT = 'That folder is not open as a project in Kehikot, so Factory reads and writes nothing there.'

/** Which project a folder is, as the host has it. `setHostResolve` is for tests. */
let hostResolve: Resolve = resolveProject
export function setHostResolve(resolve: Resolve | null): void {
  hostResolve = resolve ?? resolveProject
}

/** The host's word on a folder, then its real path. */
async function held(folder: string): Promise<{ ok: true; path: string; movedFrom?: string } | { ok: false; why: string }> {
  if (!folder) return { ok: false, why: DOOR_PROJECT_SAYS.unnamed }
  const project = await hostResolve(folder)
  if (!project.ok) return { ok: false, why: project.reason === 'moved' ? project.why : `${project.why}`.trim() || NOT_A_PROJECT }
  const root = projectRoot(project.path)
  if (!root.ok) return { ok: false, why: root.error }
  return { ok: true, path: root.value, ...(project.movedFrom ? { movedFrom: project.movedFrom } : {}) }
}

/**
 * The project's settings at the module's door (protocol 2.15.0): `settings.get` and `settings.set`
 * at `/api/kehikot/settings`, for the host's Settings and its gear on the container. The same file
 * and format the board's own controls write. Every setting is the person's: a change is taken only
 * with the page's ticket or a pass the host vouches for, asked of the origins the host started
 * this module with (`KEHIKOT_ORIGINS`) and never of an address a request names.
 */
const settings = settingsDoor({
  module: ID,
  fields: SETTINGS,
  ticket: TICKET,
  vouch: (pass, about) => hostVouches(pass, about, { env: process.env }),
  read: async (project) => {
    if (!project) return { values: {}, problem: DOOR_PROJECT_SAYS.unnamed }
    const root = await held(project)
    if (!root.ok) return { values: {}, problem: root.why }
    const raw = readJson(root.path, 'settings')
    return { values: valuesOf(readSettings(root.path)), file: SETTINGS_FILE, ...(raw.ok ? {} : { problem: raw.error }) }
  },
  write: async (project, key, value) => {
    if (!project) return DOOR_PROJECT_SAYS.unnamed
    const root = await held(project)
    if (!root.ok) return root.why
    /* A file that does not read is not overwritten with the defaults. */
    const raw = readJson(root.path, 'settings')
    if (!raw.ok) return raw.error
    const changed = withValue(readSettings(root.path), key, value)
    if (!changed.ok) return changed.why
    const written = writeSettings(root.path, changed.settings)
    return written.ok ? null : written.error
  },
})

let needsFor: () => Needs = () => realNeeds(held, servedOrigin)
/** For tests: what the factory is given (a clock, an id suffix, the host's word). */
export function setNeeds(make: (() => Needs) | null): void {
  needsFor = make ?? (() => realNeeds(held, servedOrigin))
}

const realReviewNeeds = (): ReviewNeeds => ({ ...realNeeds(held, servedOrigin), cli: runCli, neighbours: realNeighbours, key: reviewKey })
let reviewNeedsFor: () => ReviewNeeds = realReviewNeeds
/** For tests: what `/review-factory` is given (stand-ins for gh, the other modules, the key). */
export function setReviewNeeds(make: (() => ReviewNeeds) | null): void {
  reviewNeedsFor = make ?? realReviewNeeds
}

const str = (value: unknown, max = 4096): string => (typeof value === 'string' ? value.slice(0, max) : '')

/* ------------------------------------------------------------------ *
 * The MCP door: read-only
 * ------------------------------------------------------------------ */

export const READ_ONLY_DOOR =
  'Factory’s agent door only reads. It cannot start, approve, merge or send back a job, nor start, steer or send a review: the person '
  + 'types /factory or /review-factory in Claude Code, or presses in the Factory board.'

function tools() {
  return [
    {
      name: 'jobs',
      description:
        'The software-factory jobs of a project, each as { id, title, ref (its issue, owner/repo#n, or null), stage (spec, plan, build, '
        + 'review, counter, judge, waiting, merged, failed), column (where its stage sits on the project\'s own board, or null), place '
        + '(epic, parts), updatedAt }. `job` says more about one. Give the absolute project directory '
        + `as project; give epic to keep to one epic. Jobs live at <project>/${KEHIKOT_DIR}/factory/jobs/.`,
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'The absolute directory of the project. Required.' },
          epic: { type: 'string', description: 'Only the jobs started on this epic.' },
        },
        required: ['project'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'job',
      description:
        'One job: its state and the list of its files; with file, that file\'s text (spec.md, plan.md, build.md, decision.md, '
        + 'round-<n>/review-<angle>.md, round-<n>/counter-<angle>.md, round-<n>/judgement.md). Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'The absolute directory of the project. Required.' },
          job: { type: 'string', description: 'The job id, as `jobs` lists it. Required.' },
          file: { type: 'string', description: 'One of the job\'s files to read, by its name in the list.' },
        },
        required: ['project', 'job'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'reviews',
      description:
        'The /review-factory reviews of a project, each as { id, change (url, ref, title, author), stage (queued, gathering, planning, reviewing, '
        + 'challenging, judging, diagrams, waiting, sent), round, door (one-way | two-way), uiux, verdict, pathToSuccess, files }. Give change '
        + `(its URL) to keep to one change. Read-only: reviews live at <project>/${KEHIKOT_DIR}/factory/reviews/.`,
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'The absolute directory of the project. Required.' },
          change: { type: 'string', description: 'Only the reviews of this pull or merge request, by its URL.' },
        },
        required: ['project'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'review',
      description:
        'One review: its state (points, rulings, checklist answers, budget and spend, notes) and the files of its record, "How this review was '
        + 'made"; with file, that file\'s text (packet.md, plan.md, review-<angle>.md, validation.md, points.md, challenge.md, judgement.md, '
        + 'diagrams.md, briefing.md, draft.md, budget.md, diff.patch). Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'The absolute directory of the project. Required.' },
          review: { type: 'string', description: 'The review id, as `reviews` lists it. Required.' },
          file: { type: 'string', description: 'One of the record\'s files, by its name in the list.' },
        },
        required: ['project', 'review'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ]
}

function jobLine(job: Job): Record<string, unknown> {
  return {
    id: job.id,
    title: job.title,
    ref: job.ref,
    stage: job.stage,
    said: describeStage(job),
    round: job.round,
    angles: job.angles.map((one) => one.id),
    place: job.place,
    ...(job.waiting ? { waiting: job.waiting.said } : {}),
    ...(job.required.length ? { required: job.required } : {}),
    ...(job.failed ? { failed: job.failed } : {}),
    ...(job.merge ? { merged: job.merge.commit } : {}),
    ...(job.git ? { branch: job.git.branch, worktree: job.git.present ? job.git.worktree : null } : {}),
  }
}

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  if (!['jobs', 'job', 'reviews', 'review'].includes(name)) throw new Error(`There is no tool "${name.slice(0, 60)}" here. ${READ_ONLY_DOOR}`)
  const project = await held(str(doorContext(args).project))
  if (!project.ok) throw new Error(project.why)
  const root = project.path
  const followed = project.movedFrom ? `\n\n${DOOR_PROJECT_SAYS.followed(project.movedFrom, root)}` : ''
  if (name === 'reviews') {
    const change = str(args.change, 2000).trim()
    const runs = listRuns(root).filter((run) => !run.archived && (!change || run.change.url === change))
    if (!runs.length) return `No reviews${change ? ` of ${change}` : ''} in ${root}.${followed}`
    return `${JSON.stringify(runs.map((run) => publishedRun(root, run)), null, 2)}${followed}`
  }
  if (name === 'review') {
    const read = readRun(root, str(args.review, 80))
    if (!read.ok) throw new Error(read.error)
    if (!read.value) throw new Error(`There is no review "${str(args.review, 80)}" in ${root}.`)
    const file = str(args.file, 200)
    if (file) {
      const content = recordOf(root, read.value.id, file)
      if (!content.ok) throw new Error(content.error)
      return content.value === null ? `${file} is not written yet.` : content.value
    }
    const { history, ...state } = read.value
    return `${JSON.stringify({ ...publishedRun(root, read.value), state, history: history.slice(-20) }, null, 2)}${followed}`
  }
  if (name === 'jobs') {
    const epic = str(doorContext(args).epic ?? args.epic, 80)
    const jobs = listJobs(root).filter((job) => !job.archived && (!epic || job.place?.epic === epic))
    if (!jobs.length) return `No factory jobs${epic ? ` on the epic ${epic}` : ''} in ${root}.${followed}`
    const board = readSettings(root).board
    return `${JSON.stringify(jobs.map((job) => published(job, board)), null, 2)}${followed}`
  }
  const read = readJob(root, str(args.job, 80))
  if (!read.ok) throw new Error(read.error)
  if (!read.value) throw new Error(`There is no job "${str(args.job, 80)}" in ${root}.`)
  const file = str(args.file, 200)
  if (file) {
    const content = readJobFile(root, read.value.id, file)
    if (!content.ok) throw new Error(content.error)
    return content.value === null ? `${file} is not written yet.` : content.value
  }
  return `${JSON.stringify({ ...jobLine(read.value), files: jobFiles(root, read.value.id), history: read.value.history.slice(-20) }, null, 2)}${followed}`
}

interface Rpc {
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

async function mcp(rpc: Rpc): Promise<Reply> {
  const reply = (result: unknown) => ok({ jsonrpc: '2.0', id: rpc.id ?? null, result })
  const said = (s: string, isError = false) => reply({ content: [{ type: 'text', text: s }], ...(isError ? { isError } : {}) })
  if (rpc.method === 'initialize') {
    return reply({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: ID, version: VERSION },
      instructions: `The software factory's jobs in a project, read-only. ${READ_ONLY_DOOR}`,
    })
  }
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) return { status: 202, body: null }
  if (rpc.method === 'tools/list') return reply({ tools: tools() })
  if (rpc.method === 'tools/call') {
    try {
      return said(await call(String(rpc.params?.name ?? ''), rpc.params?.arguments ?? {}))
    } catch (e) {
      return said(e instanceof Error ? e.message : String(e), true)
    }
  }
  return { status: 404, body: { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: String(rpc.method) } } }
}

/* ------------------------------------------------------------------ *
 * The doors
 * ------------------------------------------------------------------ */

/** A job as the board draws it: the state, its files, and a live line when a conversation runs it. */
function forBoard(root: string, job: Job) {
  const live = isRunning(job) && job.session ? lately(job.session) : null
  return { ...job, files: jobFiles(root, job.id), lately: live }
}

/** A review as the Reviews board draws it: the state, its record's files, and a live line while a conversation runs it. */
function runForBoard(root: string, run: Run) {
  const live = runIsRunning(run) && run.session ? lately(run.session) : null
  return { ...run, files: publishedRun(root, run).files, lately: live }
}

export async function answer(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
): Promise<Reply | null> {
  if (path === '/healthz') {
    return ok({ ok: true, id: ID, version: VERSION, where: `<project>/${KEHIKOT_DIR}/factory/jobs/<job-id>/`, agents: 'read-only' })
  }

  if (path === '/mcp') {
    if (method !== 'POST') return bad('the MCP door takes POST', 405)
    if (!body || typeof body.method !== 'string') return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a request' } } }
    return mcp(body as Rpc)
  }

  /* Settings, for the host (protocol 2.15.0): before the page's ticket rule, which it keeps itself. */
  const said = await settings(method, path, query, body, ticket)
  if (said) return said

  /* The skill this module offers (protocol 2.5.0): its SKILL.md, as text. Public: a host shows it. */
  const skill = skillAt(path)
  if (skill) {
    if (method !== 'GET' && method !== 'HEAD') return bad('a skill is read with GET', 405)
    return { status: 200, body: null, raw: { bytes: skill.text, type: 'text/markdown; charset=utf-8' } }
  }

  /* `/factory`, typed by a person: plain text the skill follows. */
  if (path === '/api/skill/say') {
    if (method !== 'POST') return text('Factory: the skill asks with POST.\n\nStop.', 405)
    return text(await say({ session: str(query.get('session'), 80), say: str(query.get('say'), 4000), cwd: str(query.get('cwd')) }, needsFor()))
  }
  if (path === '/api/skill/done') {
    if (method !== 'POST') return text('Factory: a report is sent with POST.\n\nStop.', 405)
    return text(
      await done(
        {
          project: str(query.get('project')),
          job: str(query.get('job'), 80),
          step: str(query.get('step'), 20),
          round: str(query.get('round'), 4),
          session: str(query.get('session'), 80),
          failed: query.has('failed') ? str(query.get('failed'), 400) : null,
        },
        needsFor(),
      ),
    )
  }

  /* `/review-factory`, typed by a person: plain text the skill follows. */
  if (path === '/api/review/say') {
    if (method !== 'POST') return text('Factory: the skill asks with POST.\n\nStop.', 405)
    return text(await sayReview({ session: str(query.get('session'), 80), say: str(query.get('say'), 4000), cwd: str(query.get('cwd')) }, reviewNeedsFor()))
  }
  if (path === '/api/review/done') {
    if (method !== 'POST') return text('Factory: a report is sent with POST.\n\nStop.', 405)
    return text(
      await doneReview(
        {
          project: str(query.get('project')),
          run: str(query.get('run'), 80),
          step: str(query.get('step'), 20),
          session: str(query.get('session'), 80),
          failed: query.has('failed') ? str(query.get('failed'), 400) : null,
        },
        reviewNeedsFor(),
      ),
    )
  }

  /*
   * Review (and any module) reads a change's reviews and their record with no ticket:
   * `GET /api/reviews?change=<url>&projectPath=<abs>`, and one file with `&run=<id>&file=<name>`.
   * Read-only, a fixed set of file names, and only for a folder the host holds as a project.
   */
  if (path === '/api/reviews' && query.has('change')) {
    if (method !== 'GET') return bad('this door only reads', 405)
    const change = str(query.get('change'), 2000).trim()
    if (!change) return bad('Name the change: change is its URL.')
    const project = await held(str(query.get('projectPath') ?? query.get('project')))
    if (!project.ok) return bad(project.why, 403)
    const root = project.path
    const runs = listRuns(root).filter((run) => !run.archived && run.change.url === change)
    const id = str(query.get('run'), 80)
    if (id) {
      const run = runs.find((one) => one.id === id)
      if (!run) return bad(`There is no review "${id}" of that change.`, 404)
      const file = recordOf(root, run.id, str(query.get('file'), 200))
      if (!file.ok) return bad(file.error, 404)
      return ok({ ok: true, text: file.value })
    }
    return ok({ reviews: runs.map((run) => publishedRun(root, run)) })
  }

  if (path === '/api/skill/issue' || path === '/api/skill/moved') {
    if (method !== 'POST') return text('Factory: a report is sent with POST.\n\nStop.', 405)
    const project = await held(str(query.get('project')))
    if (!project.ok) return text(`Factory: ${project.why}\n\nStop.`)
    const id = str(query.get('job'), 80)
    if (path === '/api/skill/moved') {
      const kept = moveFailedFor(project.path, id)
      return text(kept.ok ? 'Factory: noted; that move is not asked again for this column.\n\nStop.' : `Factory: ${kept.error}\n\nStop.`)
    }
    return text(withMoves(project.path, linkIssue(project.path, id, str(query.get('ref'), 300), needsFor()), needsFor()))
  }

  /*
   * Other modules (Journeys, Flows) read a job's live stage by its issue, with no ticket:
   * `GET /api/jobs?ref=<ref>&projectPath=<abs>`. Read-only and minimal — the published shape, never a
   * file's contents — and only for a folder the host holds as a project. Everything that writes
   * stays ticketed.
   */
  if (path === '/api/jobs' && query.has('ref')) {
    if (method !== 'GET') return bad('this door only reads', 405)
    const ref = str(query.get('ref'), 300).trim()
    if (!ref) return bad('Name the issue: ref is its URL or owner/repo#n.')
    const project = await held(str(query.get('projectPath') ?? query.get('project')))
    if (!project.ok) return bad(project.why, 403)
    const root = project.path
    const board = readSettings(root).board
    const repo = board ? { kind: board.kind, repo: board.repo } : remoteOf(root)
    const jobs = listJobs(root)
      .filter((job) => !job.archived && job.ref !== null && sameIssue(ref, job.ref, repo))
      .map((job) => published(job, board))
    return ok({ jobs })
  }

  if (!path.startsWith('/api/')) return null

  /* Every other /api route is the page's. */
  const stranger = refuseTicket(ticket, TICKET, STRANGER)
  if (stranger) return stranger

  if (path === '/api/jobs' && method === 'GET') {
    const project = await held(str(query.get('projectPath')))
    if (!project.ok) return bad(project.why)
    const root = project.path
    return ok({ ok: true, root, jobs: listJobs(root).map((job) => forBoard(root, job)), settings: readSettings(root), queue: readQueue(root) })
  }

  /* The boards the person's own gh/glab finds: the fallback when the host's reading has none. */
  if (path === '/api/columns' && method === 'GET') {
    const project = await held(str(query.get('projectPath')))
    if (!project.ok) return bad(project.why)
    const remote = remoteOf(project.path)
    return ok({ ok: true, remote, ...(query.get('look') === 'cli' ? { found: discover(project.path) } : {}) })
  }

  if (path === '/api/file' && method === 'GET') {
    const project = await held(str(query.get('projectPath')))
    if (!project.ok) return bad(project.why)
    const read = readJobFile(project.path, str(query.get('job'), 80), str(query.get('name'), 200))
    if (!read.ok) return bad(read.error, 404)
    return ok({ ok: true, text: read.value })
  }

  if (path === '/api/review-board' && method === 'GET') {
    const project = await held(str(query.get('projectPath')))
    if (!project.ok) return bad(project.why)
    const root = project.path
    const board = reviewBoard(root)
    return ok({ ok: true, root, ...board, runs: board.runs.map((run) => runForBoard(root, run)) })
  }

  if (path === '/api/review-file' && method === 'GET') {
    const project = await held(str(query.get('projectPath')))
    if (!project.ok) return bad(project.why)
    const read = recordOf(project.path, str(query.get('run'), 80), str(query.get('name'), 200))
    if (!read.ok) return bad(read.error, 404)
    return ok({ ok: true, text: read.value })
  }

  /* The person's presses on the Reviews board, and what the page reports: the kehikko it is on, the host's rows. */
  if (path === '/api/review-act' && method === 'POST') {
    if (!body) return bad('That was not a request.')
    const project = await held(str(body.projectPath))
    if (!project.ok) return bad(project.why)
    const did = await actReview(project.path, body as unknown as ReviewAct, reviewNeedsFor())
    return did.ok ? ok({ ok: true, said: did.value }) : bad(did.error, 409)
  }

  if (path === '/api/act' && method === 'POST') {
    if (!body) return bad('That was not a request.')
    const project = await held(str(body.projectPath))
    if (!project.ok) return bad(project.why)
    const did = act(project.path, body as unknown as Act, needsFor())
    return did.ok ? ok({ ok: true, said: did.value }) : bad(did.error, 409)
  }

  return bad('not here', 404)
}

/**
 * The page's live line: an event named `changed` whenever the project's `.kehikot/factory/` or a
 * running job's transcript changes. It says only that something changed; the page reads `/api/jobs`.
 */
export const stream: Stream = (method, path, query, emit, ticket) => {
  if (path !== '/api/watch') return null
  /* An EventSource cannot send a header, so the page puts its ticket in the query. */
  if (!sameTicket(ticket ?? query.get('ticket'), TICKET)) return { reply: refuseTicket(null, TICKET, STRANGER)! }
  if (method !== 'GET') return { reply: bad('the watch is a GET', 405) }
  const root = projectRoot(query.get('projectPath'))
  if (!root.ok) return { reply: bad(root.error) }
  const stop = watchProject(root.value, () => emit({ at: Date.now() }, 'changed'))
  return { close: stop }
}
