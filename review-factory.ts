import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { moduleDir, type TrackerRow } from 'kehikot-module-protocol'

import { mainCheckout } from './git.ts'
import { stopped } from './job/steps.ts'
import { readFactoryKey } from './machine.ts'
import { angleFor } from './review/angles.ts'
import { parseUnified, totals, type DiffFile } from './review/diff.ts'
import { numbered, rulePanel } from './review/panel.ts'
import { parseChallenge, parseJudge, parsePlanner, parseReviewer } from './review/points.ts'
import { mergeNearDuplicates, validateAnswers, validatePoints, type CheckedPoint } from './review/validate.ts'
import { answered as questionAnswered, ask, questionText, readQuestions, ruleFor, setRule } from './rev/authors.ts'
import { startBackground, type Spawner } from './rev/background.ts'
import { budgetLine, editBudget, sizeBudget, spentSince } from './rev/budget.ts'
import { checkout, removeCheckout } from './rev/checkout.ts'
import { doorByRules, hasBeforeAfter, settleDoor } from './rev/doors-rule.ts'
import { advanceRun, describeRun, newRun, runAnglesOpen, runIsRunning, type RunEvent } from './rev/flow.ts'
import { locate, readMeta, spellRef, spellingsOf, urlOf, type Meta, type Target } from './rev/forge.ts'
import { CHECKLIST, checklistsHeld, createChecklist, draftToReview, FLOWS, PAPER, proposeBriefing, REVIEW, setStates, type Neighbours } from './rev/neighbours.ts'
import { due, needsComments, parseRule } from './rev/rerev.ts'
import { DEFAULT_REVIEW_SETTINGS, doorRuleSchema, MAX_ROUNDS, reviewSettingsSchema, type Change, type ReviewSettings, type Run, type RunAngle, type RunChecklist } from './rev/shape.ts'
import { agentsFor, instructRun, itemsOf } from './rev/steps.ts'
import { listRuns, makeRunDir, readRecord, readRun, readSeen, recordFiles, writeJsonFile, writeRecord, writeRun, writeSeen } from './rev/store.ts'
import { epicOf, visionOf, visionText, type HostAsk } from './rev/vision.ts'
import { placeOfSession } from './place.ts'
import { readSettings, writeSettings, type Result } from './store.ts'
import type { Remote, Run as CliRun } from './tracker.ts'
import { ID } from './manifest.ts'

/**
 * `/review-factory` on the server: what the skill asks (`sayReview`), what a step's report does
 * (`doneReview`), what the person presses (`actReview`), and what the page reports (`pageSaw`,
 * `pageRows`). Every change of a run goes through `advanceRun` (rev/flow.ts) and is written here,
 * so run.json has one writer: this module, moved by the conversation that runs the review and by
 * the person — never by an agent's own hand.
 *
 * Agents only write their own files in the record. Gathering, validation and drafting are done
 * here, by the module, with no agent: the points are checked mechanically before any agent sees
 * them, and only this module writes into Review and Checklist, through their doors.
 */

export interface ReviewNeeds {
  resolve(folder: string): Promise<{ ok: true; path: string } | { ok: false; why: string }>
  origin(): string
  now(): string
  suffix(): string
  remote(root: string): Remote | null
  /** The person's gh / glab, for reads. */
  cli: CliRun
  neighbours: Neighbours
  spawner?: Spawner
  /** Review's key for the Factory-only send, or null. */
  key(): string | null
  /** Claude Code's folder, for reading what a review spent. */
  claudeDir?: string
  /** How this server asks the host about the project (`askHost`); the real one when absent. */
  ask?: HostAsk
}

export const reviewKey = (): string | null => readFactoryKey()

export const REVIEW_HELP = [
  '/review-factory [<pull or merge request>]     review it: the change selected on the canvas when none is named',
  '/review-factory status                        the reviews of this project',
  '/review-factory resume <review>               carry on a review here (one waiting for you, or one whose conversation stopped)',
  '/review-factory angles <review> a,b           the two angles, before the reviewers start',
  '/review-factory checklist <review> accept     accept the proposed checklist; it is made in Checklist and held against the change',
  '/review-factory checklist <review> edit <item>; <item>; …   the checklist as you want it instead',
  '/review-factory budget <review> points=N files=N tokens=N',
  '/review-factory stop <review>',
]

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '') || 'change'
}

const runIdFor = (target: Target, suffix: string) => `${slug(target.repo.split('/').at(-1) ?? 'repo')}-${target.number}-${suffix}`

function commit(root: string, run: Run, event: RunEvent, needs: Pick<ReviewNeeds, 'now'>): Result<Run> {
  const moved = advanceRun(run, event, needs.now())
  if (!moved.ok) return { ok: false, error: moved.why }
  const written = writeRun(root, moved.run)
  return written.ok ? { ok: true, value: moved.run } : written
}

function settingsOf(root: string): ReviewSettings {
  return readSettings(root).review ?? DEFAULT_REVIEW_SETTINGS
}

function targetOf(change: Change): Target {
  return { forge: change.forge, repo: change.repo, number: change.number, ...(change.host ? { host: change.host } : {}) }
}

function findRun(root: string, said: string): Result<Run> {
  const wanted = said.trim().toLowerCase()
  if (!wanted) return { ok: false, error: 'Name the review: its id is on its card on the Reviews board, and in /review-factory status.' }
  const runs = listRuns(root)
  const exact = runs.find((run) => run.id === wanted)
  if (exact) return { ok: true, value: exact }
  const some = runs.filter((run) => run.id.startsWith(wanted))
  if (some.length === 1) return { ok: true, value: some[0]! }
  return { ok: false, error: some.length ? `"${said}" could be ${some.map((run) => run.id).join(' or ')}.` : `There is no review "${said}" in this project.` }
}

const FACTORY_ID = ID

/** The kehikko this conversation is placed on, and whether the Factory page saw itself there. */
function kehikkoCheck(root: string, session: string): { ok: true; kehikko: string; place: Run['place'] } | { ok: false; why: string } {
  const place = placeOfSession(root, session)
  if (!place?.kehikko) {
    return {
      ok: false,
      why: 'this conversation is not placed on a kehikko in Kehikot, so there is no Factory to run a review. Start the conversation from a kehikko that has the Factory module on it.',
    }
  }
  const missing = missingForReview(readSeen(root).kehikkos[place.kehikko]?.modules ?? [])
  if (missing.length) return { ok: false, why: missingSaid(missing) }
  return { ok: true, kehikko: place.kehikko, place }
}

/**
 * What /review-factory needs on its kehikko: Review, which it drafts into, and Factory, whose page
 * saw the kehikko (`seen.modules`). The skill declares Review in `needs` (skills.ts), so the Claude
 * module leaves it out of a conversation on a kehikko without Review; this is the same rule at run
 * time, for a conversation that outlived its kehikko's arrangement.
 */
const REVIEW_NEEDS = [
  { id: REVIEW, name: 'Review' },
  { id: FACTORY_ID, name: 'Factory' },
] as const

export function missingForReview(modules: readonly string[]): string[] {
  return REVIEW_NEEDS.filter((one) => !modules.includes(one.id)).map((one) => one.name)
}

/** "/review-factory needs Review and Factory on this kehikko; Review is missing." and what to do. */
export function missingSaid(missing: readonly string[]): string {
  const names = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)} are` : `${missing[0]} is`
  return `/review-factory needs Review and Factory on this kehikko; ${names} missing.\nPut ${missing.join(' and ')} on that kehikko${missing.includes('Factory') ? ' (and open Factory there once)' : ''}, then try again.`
}

const modulesOn = (root: string, kehikko: string | undefined): string[] => (kehikko ? readSeen(root).kehikkos[kehikko]?.modules ?? [] : [])

/* ------------------------------------------------------------------ *
 * /review-factory …
 * ------------------------------------------------------------------ */

export interface Said {
  session: string
  say: string
  cwd: string
}

async function projectOf(cwd: string, needs: ReviewNeeds): Promise<{ ok: true; root: string } | { ok: false; why: string }> {
  if (!cwd) return { ok: false, why: 'The skill did not say which folder the conversation is in.' }
  const top = mainCheckout(cwd)
  if (!top) return { ok: false, why: `${cwd} is not in a git repository. A review reads the change in a git worktree, so it needs one.` }
  const held = await needs.resolve(top)
  if (!held.ok) return { ok: false, why: `${held.why} Factory works on a project open in Kehikot.` }
  return { ok: true, root: held.path }
}

export async function sayReview(input: Said, needs: ReviewNeeds): Promise<string> {
  const session = input.session.trim()
  if (!/^[A-Za-z0-9-]{8,64}$/.test(session)) return stopped(['the skill did not pass this conversation\'s id, so no review can be run from it.'])
  const project = await projectOf(input.cwd, needs)
  if (!project.ok) return stopped([project.why])
  const root = project.root
  const words = input.say.trim()
  const [head = '', ...rest] = words.split(/\s+/)
  const command = head.toLowerCase()
  if (command === 'help') return stopped(['what /review-factory can do:', ...REVIEW_HELP])
  if (command === 'status') return status(root)
  if (command === 'resume') return resumeSaid(root, rest[0] ?? '', session, needs)
  if (command === 'angles') return anglesSaid(root, rest[0] ?? '', rest.slice(1).join(' '), needs)
  if (command === 'checklist') return checklistSaid(root, rest[0] ?? '', rest.slice(1).join(' '), session, needs)
  if (command === 'budget') return budgetSaid(root, rest[0] ?? '', rest.slice(1).join(' '), needs)
  if (command === 'stop') {
    const found = findRun(root, rest[0] ?? '')
    if (!found.ok) return stopped([found.error])
    const done = stopRun(root, found.value, 'you stopped it.', needs)
    return stopped([done.ok ? `${done.value.id} is stopped. Its record is kept.` : done.error])
  }
  return startReview(root, words, session, needs)
}

function status(root: string): string {
  const runs = listRuns(root).filter((run) => !run.archived)
  if (!runs.length) return stopped(['no reviews in this project yet. Type /review-factory with a pull or merge request, or select one on the canvas.'])
  return stopped([
    `${runs.length} review${runs.length === 1 ? '' : 's'} in this project:`,
    ...runs.map((run) => `- ${run.id} — ${run.change.ref} ${run.change.title} — ${describeRun(run)}${run.waiting ? ` (${run.waiting.said})` : ''}`),
  ])
}

async function startReview(root: string, words: string, session: string, needs: ReviewNeeds): Promise<string> {
  const here = kehikkoCheck(root, session)
  if (!here.ok) return stopped([here.why])
  const remote = needs.remote(root)
  let said = words
  if (!said) {
    const selected = readSeen(root).kehikkos[here.kehikko]?.selection ?? []
    said = selected.find((ref) => locate(ref, remote).ok) ?? ''
    if (!said) return stopped(['no pull or merge request is selected on this kehikko, and none was named. Factory reviews a pull or merge request: open one (a draft is fine), then select it on the canvas or type /review-factory <its URL>.'])
  }
  const located = locate(said, remote)
  if (!located.ok) return stopped([located.why])
  const target = located.target
  const meta = readMeta(root, target, needs.cli)
  if (!meta.ok) return stopped([meta.why])
  if (meta.meta.state && !['open', 'opened'].includes(meta.meta.state)) return stopped([`${target.repo}${target.forge === 'github' ? '#' : '!'}${target.number} is ${meta.meta.state}; Factory reviews open changes.`])

  const url = urlOf(target)
  const runs = listRuns(root).filter((run) => run.change.url === url)
  const live = runs.find((run) => (runIsRunning(run) || run.stage === 'queued' || run.waiting?.why === 'checklist') && !run.archived)
  if (live) return stopped([`${live.id} is already reviewing this change (${describeRun(live)}). To carry it on here, type /review-factory resume ${live.id}.`])
  const last = runs.find((run) => run.stage === 'sent' || run.waiting?.why === 'drafted')
  const reReview = !!last && last.stage === 'sent'
  const round = last ? (reReview ? Math.min(last.round + 1, MAX_ROUNDS) : last.round) : 1
  const change = changeFrom(target, meta.meta, remote)
  const run = newRun({
    id: runIdFor(target, needs.suffix()),
    change,
    session,
    place: here.place,
    now: needs.now(),
    round,
    previous: last?.id ?? null,
    listed: reReview && last ? listedOf(last) : [],
  })
  return gatherAndGo(root, run, meta.meta, session, needs, [])
}

function changeFrom(target: Target, meta: Meta, remote: Remote | null): Change {
  return {
    forge: target.forge,
    ...(target.host ? { host: target.host } : {}),
    repo: target.repo,
    number: target.number,
    url: urlOf(target),
    ref: spellRef(target, remote),
    title: meta.title.slice(0, 300),
    author: meta.author,
    labels: meta.labels.slice(0, 50),
  }
}

/** The required points of a finished review, as the next round checks them. */
function listedOf(run: Run): Run['listed'] {
  const required = new Set((run.judged?.rulings ?? []).filter((one) => one.ruling === 'required').map((one) => one.point))
  const fromPoints = run.points.filter((point) => required.has(point.id)).map((point) => ({ id: point.id, text: `${point.suggestion} (${point.path}:${point.line}) — ${point.claim}`.slice(0, 1000) }))
  const general = run.general.filter((one) => required.has(one.id)).map((one) => ({ id: one.id, text: `${one.suggestion} — ${one.claim}` }))
  return [...general, ...fromPoints]
}

/** Gather (no agent), then hand out the planner. */
async function gatherAndGo(root: string, fresh: Run, meta: Meta, session: string, needs: ReviewNeeds, lead: string[]): Promise<string> {
  const made = makeRunDir(root, fresh.id)
  if (!made.ok) return stopped([made.error])
  const written = writeRun(root, fresh)
  if (!written.ok) return stopped([written.error])
  const gathered = await gather(root, fresh, meta, needs)
  if (!gathered.ok) return stopped([gathered.error])
  const run = gathered.value
  if (run.stage === 'waiting') return ended(root, run)
  const intro = [
    `Budget: ${run.budget ? budgetLine(run.budget) : 'none'}. Change it with /review-factory budget ${run.id} points=N files=N tokens=N, or on its card.`,
    `Tell the person, in one line, the review's id (${run.id}) and its budget, then go on.`,
    ...lead,
  ]
  return nextFor(root, run, session, needs, null, null, intro)
}

/** The input packet: the change, its vision, its checklists, the budget. Written to the record; no agent. */
export async function gather(root: string, run0: Run, meta: Meta, needs: ReviewNeeds): Promise<Result<Run>> {
  let run = run0
  const step = commit(root, run, { kind: 'gathering' }, needs)
  if (!step.ok) return step
  run = step.value
  const remote = needs.remote(root)
  const target = targetOf(run.change)
  const previous = run.previous ? readRun(root, run.previous) : null
  const previousHead = run.round > 1 && previous?.ok && previous.value?.pinned ? previous.value.pinned.head : null
  const checked = checkout(root, run.id, target, meta.base, remote, previousHead)
  if (!checked.ok) return stopRun(root, run, checked.why, needs)
  writeRecord(root, run.id, 'diff.patch', checked.value.diff)
  if (checked.value.delta !== null) writeRecord(root, run.id, 'delta.patch', checked.value.delta)
  const files = parseUnified(checked.value.diff)
  const sum = totals(files)
  const budget = run.budget ?? sizeBudget(sum.files, sum.added + sum.removed)

  const slugOf = await epicOf(root, target, remote, needs.ask)
  const vision = slugOf ? await visionOf(root, slugOf, needs.ask) : null

  let checklists: RunChecklist[] = []
  const notes: string[] = []
  if (await needs.neighbours.present(CHECKLIST)) {
    const held = await checklistsHeld(needs.neighbours, root, spellingsOf(target, remote))
    if (held.trouble) notes.push(`Checklist could not be read: ${held.trouble.slice(0, 200)}`)
    checklists = held.lists
  } else notes.push('Checklist is not running here, so no checklist was read for this change.')
  if (run.round > 1 && checked.value.delta === '') notes.push('No new commits since the last review: this re-review checks only whether the listed points are met, and raises nothing new.')
  else if (run.round > 1 && checked.value.delta === null) notes.push('The head of the last review is not here any more (a force-push?), so this re-review reads the whole change and cannot tell new code from old.')

  const settings = settingsOf(root)
  const packet = packetText(run, meta, vision ? visionText(vision) : visionText(null), checklists, budget, settings, sum, checked.value.head)
  writeRecord(root, run.id, 'packet.md', packet)
  writeRecord(root, run.id, 'budget.md', budgetText({ ...run, budget }))
  const moved = commit(
    root,
    run,
    {
      kind: 'gathered',
      pinned: { head: checked.value.head, base: checked.value.base, mergeBase: checked.value.mergeBase, previousHead: checked.value.delta !== null ? previousHead : null, at: needs.now() },
      checkout: { path: checked.value.path, present: true },
      budget,
      change: run.change,
      vision: { epic: vision?.epic ?? null, said: vision ? `${vision.title}${vision.lede ? ` — ${vision.lede}` : ''}`.slice(0, 400) : 'In no epic: reviewed without a vision, and the review says so.' },
      checklists,
    },
    needs,
  )
  if (!moved.ok) return moved
  run = moved.value
  for (const note of notes) {
    const noted = commit(root, run, { kind: 'note', note }, needs)
    if (noted.ok) run = noted.value
  }
  return { ok: true, value: run }
}

function packetText(run: Run, meta: Meta, vision: string, checklists: readonly RunChecklist[], budget: NonNullable<Run['budget']>, settings: ReviewSettings, sum: { files: number; added: number; removed: number }, head: string): string {
  const out = [
    `# ${run.change.ref}: ${run.change.title}`,
    '',
    `${run.change.url} — by ${meta.author?.login ?? 'unknown'}${meta.draft ? ' (draft)' : ''}. Reviewed at ${head}, ${sum.files} files, +${sum.added} −${sum.removed}.`,
    run.round > 1 ? `Re-review, round ${run.round} of at most ${MAX_ROUNDS}.` : '',
    '',
    '## Description',
    '',
    meta.body.trim() || '(none)',
    '',
    '## Commits',
    '',
    ...(meta.commits.length ? meta.commits.map((one) => `- ${one.sha.slice(0, 10)} ${one.title}`) : ['(none listed)']),
    '',
    `Labels: ${meta.labels.join(', ') || 'none'}. Linked issues: ${meta.linked.join(', ') || 'none'}. ${meta.comments.length} comment${meta.comments.length === 1 ? '' : 's'}.`,
    '',
    ...pictureComments(meta),
    '## The vision: the epic this change belongs to',
    '',
    vision,
    '',
    '## Checklists held against the change',
    '',
  ]
  if (!checklists.length) out.push('None. The planner proposes one, and the person accepts or edits it.')
  for (const list of checklists) {
    out.push(`### ${list.name} (${list.id})`, '')
    for (const item of list.items) out.push(`- [${item.state ?? 'unchecked'}] ${list.id}/${item.id}: ${item.text}${item.byPerson ? ` — set by ${item.by ?? 'the person'}` : ''}`)
    out.push('')
  }
  if (run.listed.length) out.push('## Listed last time ("To get this approved")', '', ...run.listed.map((one) => `- ${one.id}: ${one.text}`), '')
  out.push('## Budget', '', budgetLine(budget) + '.', '')
  if (settings.doorRules.length) out.push('## The project\'s door rules', '', ...settings.doorRules.map((rule) => `- ${rule.kind === 'path' ? `\`${rule.glob}\`` : `label "${rule.label}"`} → ${rule.door}`), '')
  return `${out.filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n')}\n`
}

/** Comments that carry pictures (before and after shots are often posted there), as the packet quotes them. */
function pictureComments(meta: Meta): string[] {
  const shown = meta.comments.filter((one) => /!\[[^\]]*\]\(https?:|<img\b/i.test(one.body)).slice(0, 10)
  if (!shown.length) return []
  return ['## Comments with pictures', '', ...shown.flatMap((one) => [`${one.author} (${one.at}):`, '', one.body.slice(0, 2000), ''])]
}

function budgetText(run: Pick<Run, 'budget' | 'spend' | 'notes'>): string {
  const out = ['# Budget and spend', '', run.budget ? `${budgetLine(run.budget)}.` : 'No budget yet.', '', '| Step | Tokens | Cache reads |', '| --- | --- | --- |']
  for (const one of run.spend) out.push(`| ${one.step} | ${one.tokens} | ${one.cached} |`)
  const total = run.spend.reduce((sum, one) => sum + one.tokens, 0)
  out.push(`| total | ${total} | ${run.spend.reduce((sum, one) => sum + one.cached, 0)} |`, '')
  return `${out.join('\n')}\n`
}

const spentTotal = (run: Run) => run.spend.reduce((sum, one) => sum + one.tokens, 0)
const overBudget = (run: Run) => !!run.budget && spentTotal(run) >= run.budget.tokens

/* ------------------------------------------------------------------ *
 * The next step
 * ------------------------------------------------------------------ */

function nextFor(root: string, run0: Run, session: string, needs: ReviewNeeds, fix: string | null = null, only: readonly string[] | null = null, lead: string[] = []): Promise<string> {
  let run = run0
  if (!runIsRunning(run)) return Promise.resolve(ended(root, run))
  const settings = settingsOf(root)
  const meta = readRecord(root, run.id, 'diff.patch')
  const paths = meta.ok && meta.value ? parseUnified(meta.value).map((one) => one.path) : []
  const byRules = doorByRules(settings.doorRules, paths, run.change.labels)
  const agents = agentsFor(root, run, settings, { doorRule: byRules.door ? `${byRules.said.join('; ')} — so this change is ${byRules.door}.` : null, project: root, only })
  if (!agents.length) return Promise.resolve(stopped([`${run.id} is ${describeRun(run)}, which has nobody to start. This is a fault in Factory.`]))
  const at = commit(root, run, { kind: 'step-at', at: needs.now() }, needs)
  if (at.ok) run = at.value
  return Promise.resolve(instructRun(run, agents, { origin: needs.origin(), project: root, session, fix, lead }))
}

/** How a run that is no longer running is said. */
function ended(root: string, run: Run): string {
  if (run.stage === 'sent') {
    return stopped([
      `${run.id} — ${run.change.ref} "${run.change.title}" — was ${run.sent?.by === 'factory' ? 'posted by Factory (two-way, no UI/UX, as the project\'s switch allows)' : 'sent'}: ${run.judged?.verdict ?? ''}.`,
      'The whole record is on its card on the Reviews board.',
    ])
  }
  if (run.waiting?.why === 'checklist') {
    return stopped([
      `${run.id} — ${run.change.ref} has no checklist. The planner proposes these ${run.proposed?.length ?? 0} items; the review waits for you:`,
      ...(run.proposed ?? []).map((one, i) => `${i + 1}. ${one}`),
      `Accept: /review-factory checklist ${run.id} accept — or your own: /review-factory checklist ${run.id} edit <item>; <item>; … (or on its card). The review goes on in this conversation.`,
    ])
  }
  if (run.waiting?.why === 'drafted') {
    const judged = run.judged
    return stopped([
      `${run.id} — ${run.change.ref} "${run.change.title}": ${judged?.verdict ?? 'drafted'}${run.plan ? `, ${run.plan.door.kind}${run.plan.uiux.touches ? ', touches what people see' : ''}` : ''}.`,
      run.waiting.said,
      ...(judged?.pathToSuccess.length && judged.verdict !== 'approve' ? ['To get this approved:', ...numbered(judged.pathToSuccess)] : judged?.verdict === 'approve' ? ['Nothing blocks this change.'] : []),
      ...(run.plan?.door.kind === 'one-way' ? [`One-way: read the decision briefing (${run.drafted?.briefing === 'paper' ? 'proposed in the epic\'s paper, and in the record' : 'in the record'}) before you send.`] : []),
      ...run.notes.slice(-4),
    ])
  }
  return stopped([`${run.id} — ${run.change.ref} — ${run.waiting?.said ?? describeRun(run)}`])
}

/* ------------------------------------------------------------------ *
 * A step's report
 * ------------------------------------------------------------------ */

export interface ReviewReport {
  project: string
  run: string
  step: string
  session: string
  failed: string | null
}

export async function doneReview(report: ReviewReport, needs: ReviewNeeds): Promise<string> {
  const held = await needs.resolve(report.project)
  if (!held.ok) return stopped([held.why])
  const root = held.path
  const read = readRun(root, report.run)
  if (!read.ok) return stopped([read.error])
  if (!read.value) return stopped([`there is no review "${report.run}" in this project.`])
  let run: Run = read.value
  if (run.session !== report.session) {
    return stopped([runIsRunning(run) ? `another conversation is running ${run.id}. To carry it on here instead, type /review-factory resume ${run.id}.` : `${run.id} is ${describeRun(run)}; nothing is being run for it.`])
  }
  if (run.stage !== report.step) return nextFor(root, run, report.session, needs, `that report was for ${report.step}, but the review is ${describeRun(run)}.`)

  /* What the step spent, from the conversation's own transcript. */
  if (run.stepAt) {
    const spent = spentSince(report.session, run.stepAt, needs.claudeDir)
    const noted = commit(root, run, { kind: 'spent', step: run.stage, tokens: spent.tokens, cached: spent.cached }, needs)
    if (noted.ok) run = noted.value
    writeRecord(root, run.id, 'budget.md', budgetText(run))
  }

  if (report.failed !== null) {
    const done = stopRun(root, run, `a subagent could not do its job: ${report.failed.trim().slice(0, 300) || 'no reason given.'}`, needs)
    return done.ok ? ended(root, done.value) : stopped([done.error])
  }

  const text = (name: string) => {
    const got = readRecord(root, run.id, name)
    return got.ok ? got.value : null
  }
  /** One more try for a malformed answer, then the run stops. */
  const again = (fix: string, only: string[] | null = null): Promise<string> => {
    if ((run.tries[run.stage] ?? 0) >= 1) {
      const done = stopRun(root, run, `${fix} (after one more try)`, needs)
      return Promise.resolve(done.ok ? ended(root, done.value) : stopped([done.error]))
    }
    const tried = commit(root, run, { kind: 'tried', step: run.stage }, needs)
    return nextFor(root, tried.ok ? tried.value : run, report.session, needs, fix, only)
  }

  switch (run.stage) {
    case 'planning': {
      const plan = text('plan.md')
      if (!plan) return again('plan.md is not there. Start the planner again.')
      const parsed = parsePlanner(plan)
      if (!parsed.ok) return again(`${parsed.why} Start the planner again; it rewrites plan.md.`)
      if (parsed.value.angles[0]!.id === parsed.value.angles[1]!.id) return again('plan.md names the same angle twice. Start the planner again.')
      const moved = planned(root, run, parsed.value, needs)
      if (!moved.ok) return stopped([moved.error])
      run = moved.value
      return run.waiting ? ended(root, run) : nextFor(root, run, report.session, needs)
    }
    case 'reviewing': {
      const angles = run.plan?.angles ?? []
      const outputs = new Map<string, ReturnType<typeof parseReviewer>>()
      const missing: string[] = []
      for (const angle of angles) {
        const got = text(`review-${angle.id}.md`)
        const parsed = got === null ? null : parseReviewer(got, `review-${angle.id}.md`)
        if (!parsed?.ok) missing.push(angle.id)
        outputs.set(angle.id, parsed ?? { ok: false, why: 'not written' })
      }
      if (missing.length) {
        const why = missing.map((id) => {
          const one = outputs.get(id)
          return one && !one.ok ? `${id}: ${one.why}` : id
        })
        return again(`no readable review from ${why.join('; ')}. Start only those reviewers again.`, missing)
      }
      const moved = reviewed(root, run, outputs as Map<string, { ok: true; value: import('./review/points.ts').ReviewerOutput }>, needs)
      if (!moved.ok) return stopped([moved.error])
      run = moved.value
      if (run.stage === 'challenging' && overBudget(run)) {
        const skipped = commit(root, run, { kind: 'challenged', challenges: [], adversaryCloses: false }, needs)
        if (skipped.ok) run = skipped.value
        const noted = commit(root, run, { kind: 'note', note: `Over the budget of ${run.budget?.tokens} tokens after the reviews, so the adversary was not run: the judge rules without a challenge.` }, needs)
        if (noted.ok) run = noted.value
      }
      return nextFor(root, run, report.session, needs)
    }
    case 'challenging': {
      const got = text('challenge.md')
      const parsed = got === null ? null : parseChallenge(got)
      if (!parsed?.ok) return again(`${parsed ? parsed.why : 'challenge.md is not there.'} Start the adversary again.`)
      const known = new Set(run.points.map((point) => point.id))
      const moved = commit(root, run, { kind: 'challenged', challenges: parsed.value.challenges.filter((one) => known.has(one.point)), adversaryCloses: parsed.value.close === true }, needs)
      if (!moved.ok) return stopped([moved.error])
      return nextFor(root, moved.value, report.session, needs)
    }
    case 'judging': {
      const got = text('judgement.md')
      const parsed = got === null ? null : parseJudge(got)
      if (!parsed?.ok) return again(`${parsed ? parsed.why : 'judgement.md is not there.'} Start the judge again.`)
      const judgement = parsed.value
      const result = rulePanel({
        points: run.points as CheckedPoint[],
        general: run.general,
        judge: judgement,
        reviewersClose: run.closeVotes.reviewers,
        adversaryCloses: run.closeVotes.adversary,
      })
      if (result.verdict === 'close' && !result.pathToSuccess.length && judgement.close) result.pathToSuccess = [judgement.close.instead]
      const flows = modulesOn(root, run.place?.kehikko).includes(FLOWS) && (await needs.neighbours.present(FLOWS))
      const drawable = flows && !!run.vision?.epic && !overBudget(run)
      const notes: string[] = []
      if (judgement.diagrams.length && !drawable) {
        notes.push(
          !run.vision?.epic
            ? 'The judge asked for a diagram, but this change is in no epic, so none was drawn.'
            : !flows
              ? 'The judge asked for a diagram, but Flows is not on this kehikko, so the point is text only.'
              : 'The judge asked for a diagram, but the run is over its budget, so none was drawn.',
        )
      }
      if (run.plan?.door.kind !== 'two-way' && !text('briefing.md')) notes.push('This change is one-way, and the judge wrote no decision briefing.')
      let moved = commit(root, run, { kind: 'judged', result, visionFit: judgement.visionFit, summary: judgement.summary, close: judgement.close ?? null, diagrams: judgement.diagrams, drawable }, needs)
      if (!moved.ok) return stopped([moved.error])
      run = moved.value
      for (const note of notes) {
        moved = commit(root, run, { kind: 'note', note }, needs)
        if (moved.ok) run = moved.value
      }
      if (run.stage === 'diagrams') return nextFor(root, run, report.session, needs)
      return draftAndSay(root, run, needs)
    }
    case 'diagrams': {
      const got = text('diagrams.md') ?? ''
      const diagrams = [...got.matchAll(/^\s*-\s*(\S+?):\s*`?([A-Za-z0-9._-]+)`?\s*$/gm)].map((m) => ({ point: m[1]!, flow: m[2]! })).filter((one) => run.points.some((point) => point.id === one.point)).slice(0, 10)
      const moved = commit(root, run, { kind: 'diagrammed', diagrams, notes: diagrams.length ? [] : ['The diagram drawer wrote no flow; diagrams.md says why.'] }, needs)
      if (!moved.ok) return stopped([moved.error])
      return draftAndSay(root, moved.value, needs)
    }
    default:
      return stopped([`${run.id} is ${describeRun(run)}; nothing is being run for it.`])
  }
}

/** The plan, settled against the project's rules: door, UI/UX, the checklist split. */
function planned(root: string, run: Run, plan: import('./review/points.ts').PlannerOutput, needs: ReviewNeeds): Result<Run> {
  const settings = settingsOf(root)
  const diff = readRecord(root, run.id, 'diff.patch')
  const paths = diff.ok && diff.value ? parseUnified(diff.value).map((one) => one.path) : []
  const door = settleDoor(doorByRules(settings.doorRules, paths, run.change.labels), plan.door)
  const packet = readRecord(root, run.id, 'packet.md')
  const shots = hasBeforeAfter([packet.ok && packet.value ? packet.value : ''])
  const general: Run['general'] = []
  if (plan.uiux.touches && !shots) {
    const screens = plan.uiux.screens.length ? plan.uiux.screens.join(', ') : 'every screen it changes'
    general.push({ id: 'shots', claim: 'This changes what people see, and the change has no before and after pictures.', suggestion: `Add before and after pictures of: ${screens}.` })
  }
  const items = itemsOf(run).map((one) => `${one.checklist}/${one.item}`)
  const angles: RunAngle[] = plan.angles.map((one) => ({ id: one.id, brief: one.brief, by: 'planner', practices: one.practices, items: one.items.filter((item) => items.includes(item)) }))
  /* Every item answered by exactly one reviewer: what the planner left out is shared out here. */
  const given = new Set<string>()
  for (const angle of angles) angle.items = angle.items.filter((item) => (given.has(item) ? false : (given.add(item), true)))
  items.filter((item) => !given.has(item)).forEach((item, i) => angles[i % 2]!.items.push(item))
  return commit(
    root,
    run,
    {
      kind: 'planned',
      plan: { angles, door, uiux: { touches: plan.uiux.touches, reason: plan.uiux.reason, screens: plan.uiux.screens, shots } },
      proposed: plan.proposedChecklist?.length ? plan.proposedChecklist : null,
      general,
    },
    needs,
  )
}

/** Validation: no agent. Each reviewer's points held to the rules, near-duplicates merged, answers checked. */
function reviewed(root: string, run: Run, outputs: Map<string, { ok: true; value: import('./review/points.ts').ReviewerOutput }>, needs: ReviewNeeds): Result<Run> {
  const diff = readRecord(root, run.id, 'diff.patch')
  const files: DiffFile[] = diff.ok && diff.value ? parseUnified(diff.value) : []
  const deltaText = run.round > 1 ? readRecord(root, run.id, 'delta.patch') : null
  const delta = deltaText?.ok && deltaText.value !== null ? parseUnified(deltaText.value) : null
  const kept: CheckedPoint[] = []
  const rejected: Run['rejected'] = []
  const answers: Run['answers'] = []
  const skipped: string[] = []
  const closes: boolean[] = []
  const notes: string[] = []
  const lines: string[] = ['# Validation', '', 'The mechanical rules, before any agent sees a point: anchored to lines of this diff that say what the quote says, at least one source, under 600 characters; on a re-review, new points only about new code. Checklist answers need a note.', '']
  for (const angle of run.plan?.angles ?? []) {
    const output = outputs.get(angle.id)!.value
    closes.push(!!output.close)
    if (output.close) notes.push(`The ${angle.id} reviewer asked to close the change: ${output.close.why} Instead: ${output.close.instead}`)
    const checked = validatePoints(angle.id, output.points, files, { perReviewer: run.budget?.pointsPerReviewer ?? 6, delta }, kept.length + 1)
    kept.push(...checked.kept)
    rejected.push(...checked.rejected, ...checked.over.map((one) => ({ ...one, why: `not got to: ${one.why}` })))
    const assigned = angle.items.map((key) => ({ checklist: key.split('/')[0]!, item: key.split('/').slice(1).join('/') }))
    const checkedAnswers = validateAnswers(angle.id, output.answers, assigned)
    answers.push(...checkedAnswers.kept)
    skipped.push(...checkedAnswers.skipped)
    rejected.push(...checkedAnswers.refused.map((one) => ({ angle: angle.id, point: `checklist ${one.item}`, why: one.why })))
    lines.push(`## ${angle.id} (verdict ${output.verdict})`, '', `${output.points.length} point${output.points.length === 1 ? '' : 's'} written, ${checked.kept.length} passed.`)
    for (const one of checked.rejected) lines.push(`- Refused: ${one.point} — ${one.why}`)
    for (const one of checked.over) lines.push(`- Not got to: ${one.point} — ${one.why}`)
    for (const one of checkedAnswers.refused) lines.push(`- Checklist ${one.item}: ${one.why}`)
    for (const one of checkedAnswers.skipped) lines.push(`- Checklist ${one}: not answered.`)
    lines.push('')
  }
  const merged = mergeNearDuplicates(kept).map((point, i) => ({ ...point, id: `p${i + 1}` }))
  if (merged.length < kept.length) lines.push(`${kept.length - merged.length} near-duplicate point${kept.length - merged.length === 1 ? ' was' : 's were'} merged into one listing every place.`, '')
  if (skipped.length) notes.push(`Checklist items not answered: ${skipped.join(', ')}.`)
  writeRecord(root, run.id, 'validation.md', `${lines.join('\n')}\n`)
  writeRecord(root, run.id, 'points.md', pointsText(merged, run.general))
  return commit(root, run, { kind: 'reviewed', points: merged, rejected, skipped, answers, reviewersClose: closes, notes }, needs)
}

function pointsText(points: readonly CheckedPoint[], general: Run['general']): string {
  const out = ['# The points that passed the rules', '']
  for (const one of general) out.push(`## ${one.id} (raised by Factory, required by rule)`, '', one.claim, '', one.suggestion, '')
  for (const point of points) {
    out.push(
      `## ${point.id} — ${point.severity}, from ${point.angles.join(' and ')}`,
      '',
      `${point.path}:${point.startLine && point.startLine !== point.line ? `${point.startLine}-` : ''}${point.line} (${point.side} side)${point.also.length ? `, also ${point.also.map((one) => `${one.path}:${one.line}`).join(', ')}` : ''}`,
      '',
      '```',
      point.quote,
      '```',
      '',
      `**Claim:** ${point.claim}`,
      `**Why it matters:** ${point.why}`,
      `**Suggestion:** ${point.suggestion}`,
      `**Evidence:** ${point.evidence.map((one) => `${one.kind} ${one.ref}`).join('; ')}`,
      ...(point.checklist.length ? [`**Checklist:** ${point.checklist.join(', ')}`] : []),
      ...(point.listed ? [`**Listed last time:** ${point.listed}`] : []),
      '',
    )
  }
  return `${out.join('\n')}\n`
}

/* ------------------------------------------------------------------ *
 * Draft (no agent), and the send
 * ------------------------------------------------------------------ */

async function draftAndSay(root: string, run: Run, needs: ReviewNeeds): Promise<string> {
  const done = await draft(root, run, needs)
  return done.ok ? ended(root, done.value) : stopped([done.error])
}

export async function draft(root: string, run0: Run, needs: ReviewNeeds): Promise<Result<Run>> {
  let run = run0
  const target = targetOf(run.change)
  /* Nothing is anchored to a head the run did not read. */
  const now = readMeta(root, target, needs.cli)
  if (now.ok && run.pinned && now.meta.head !== run.pinned.head) {
    removeCheckout(root, run.id, run.checkout?.path ?? null)
    const moved = commit(root, run, { kind: 'moved-on', head: now.meta.head }, needs)
    if (moved.ok) writeRecord(root, run.id, 'draft.md', `# Draft\n\nNothing was drafted: ${moved.value.waiting?.said}\n`)
    return moved
  }
  const notes: string[] = []
  if (!now.ok) notes.push(`The head could not be read again before drafting (${now.why.slice(0, 160)}); drafted against ${run.pinned?.head.slice(0, 10)}, which Review checks itself.`)
  const n = needs.neighbours
  const review = await n.present(REVIEW)
  let drafted = { comments: 0, refused: [] as { point: string; why: string }[], proposal: false, notes: [] as string[] }
  if (review) {
    const earlier = listRuns(root).filter((one) => one.change.url === run.change.url && one.id !== run.id).map((one) => one.id)
    drafted = await draftToReview(n, root, withDiagramLinks(run), earlier)
  } else notes.push('Review is not running here, so nothing was drafted there: the result is in this record only.')
  let ticks = 0
  if (run.answers.length && (await n.present(CHECKLIST))) {
    const ref = spellingsOf(target, needs.remote(root))[0] ?? run.change.ref
    const set = await setStates(n, root, run.change.ref || ref, run)
    ticks = set.set
    notes.push(...set.notes)
  }
  let briefing: 'none' | 'record' | 'paper' = 'none'
  const briefingText = readRecord(root, run.id, 'briefing.md')
  if (run.plan?.door.kind !== 'two-way' && briefingText.ok && briefingText.value) {
    briefing = 'record'
    const epic = run.vision?.epic
    const paperDir = epic ? moduleDir(root, PAPER) : null
    const hasPaper = !!epic && !!paperDir && existsSync(join(paperDir, epic, 'main.tex'))
    if (hasPaper && (await n.present(PAPER))) {
      const proposed = await proposeBriefing(n, root, epic!, `${run.change.ref} ${run.change.title}`, briefingText.value)
      if (proposed.ok) briefing = 'paper'
      else notes.push(`Paper did not take the briefing (${proposed.text.slice(0, 160)}); it is in the record.`)
    } else notes.push(epic ? 'The epic has no paper, so the decision briefing is in the record only. Factory does not create a paper.' : 'This change is in no epic, so the decision briefing is in the record only.')
  }
  const left = removeCheckout(root, run.id, run.checkout?.path ?? null)
  if (left) notes.push(left)

  /* The send without the person: only two-way, no UI/UX, the switch on, and Review agreeing. */
  let sent = false
  const settings = settingsOf(root)
  if (review && drafted.proposal && settings.postTwoWay) {
    if (run.plan?.door.kind !== 'two-way') notes.push('Not posted by Factory: this change is one-way, so it waits for you.')
    else if (run.plan.uiux.touches) notes.push('Not posted by Factory: it touches what people see, so it waits for you.')
    else {
      const key = needs.key()
      if (!key) notes.push('Not posted by Factory: Review has not made its key for Factory yet. Send it yourself from Review.')
      else {
        const answer = await n.send({ project: root, change: run.change.url, run: run.id }, key)
        if (answer.status === 200) sent = true
        else notes.push(`Review did not send it: ${sentenceOf(answer.text)}`)
      }
    }
  }
  const all = [...drafted.notes, ...notes]
  writeRecord(root, run.id, 'draft.md', draftText(run, drafted, ticks, briefing, all, sent))
  return commit(root, run, { kind: 'drafted', drafted: { at: needs.now(), comments: drafted.comments, refused: drafted.refused, proposal: drafted.proposal, ticks, briefing }, notes: all, sent }, needs)
}

/** A refusal's sentence out of Review's answer (JSON with `error`, or text). */
function sentenceOf(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown; said?: unknown }
    if (typeof body.error === 'string') return body.error.slice(0, 400)
  } catch {
    /* plain text */
  }
  return text.slice(0, 400) || 'no reason given.'
}

/** A point the judge asked to draw links to its flows. */
function withDiagramLinks(run: Run): Run {
  if (!run.diagrams.length) return run
  return {
    ...run,
    points: run.points.map((point) => {
      const flows = run.diagrams.filter((one) => one.point === point.id).map((one) => one.flow)
      return flows.length ? { ...point, suggestion: `${point.suggestion} Drawn in Flows (epic ${run.vision?.epic}): ${flows.join(', ')}.`.slice(0, 600) } : point
    }),
  }
}

function draftText(run: Run, drafted: { comments: number; refused: { point: string; why: string }[]; proposal: boolean }, ticks: number, briefing: string, notes: string[], sent: boolean): string {
  const judged = run.judged
  return `${[
    '# Draft',
    '',
    `Verdict: ${judged?.verdict ?? 'none'}. ${run.plan ? `${run.plan.door.kind} (${run.plan.door.reasons.join(' ')})` : ''}${run.plan?.uiux.touches ? ' Touches what people see.' : ''}`,
    '',
    `${drafted.comments} comment${drafted.comments === 1 ? '' : 's'} drafted in Review; the summary and verdict ${drafted.proposal ? 'proposed beside yours' : 'not proposed'}. ${ticks} checklist answer${ticks === 1 ? '' : 's'} set in Checklist. Briefing: ${briefing}.`,
    sent ? 'Posted by Factory, as the project\'s switch allows for a two-way change.' : 'Nothing was posted: you read it in Review and send it yourself.',
    '',
    ...(judged ? ['## Rulings', '', ...judged.rulings.map((one) => `- ${one.point}: ${one.ruling} — ${one.reason}`), ''] : []),
    ...(judged?.pathToSuccess.length ? ['## To get this approved', '', ...numbered(judged.pathToSuccess), ''] : []),
    ...(drafted.refused.length ? ['## Refused by Review', '', ...drafted.refused.map((one) => `- ${one.point}: ${one.why}`), ''] : []),
    ...(notes.length ? ['## Notes', '', ...notes.map((one) => `- ${one}`), ''] : []),
    ...(run.rejected.length ? ['## What the review did not get to, or refused', '', ...run.rejected.map((one) => `- (${one.angle}) ${one.point} — ${one.why}`), ''] : []),
  ].join('\n')}\n`
}

/* ------------------------------------------------------------------ *
 * The person's words, typed or pressed
 * ------------------------------------------------------------------ */

function stopRun(root: string, run: Run, why: string, needs: ReviewNeeds): Result<Run> {
  removeCheckout(root, run.id, run.checkout?.path ?? null)
  const moved = commit(root, run, { kind: 'stop', why }, needs)
  return moved.ok ? { ok: true, value: moved.value } : moved
}

async function resumeSaid(root: string, said: string, session: string, needs: ReviewNeeds): Promise<string> {
  const found = findRun(root, said)
  if (!found.ok) return stopped([found.error])
  let run = found.value
  if (!run.background) {
    const here = kehikkoCheck(root, session)
    if (!here.ok) return stopped([here.why])
  }
  if (run.waiting?.why === 'checklist') return ended(root, run)
  if (run.stage === 'queued') {
    const claimed = commit(root, run, { kind: 'claim', session }, needs)
    if (!claimed.ok) return stopped([claimed.error])
    const meta = readMeta(root, targetOf(run.change), needs.cli)
    if (!meta.ok) return stopped([meta.why])
    const gathered = await gather(root, claimed.value, meta.meta, needs)
    if (!gathered.ok) return stopped([gathered.error])
    return gathered.value.stage === 'waiting' ? ended(root, gathered.value) : nextFor(root, gathered.value, session, needs)
  }
  if (!runIsRunning(run)) return ended(root, run)
  const claimed = commit(root, run, { kind: 'claim', session }, needs)
  if (!claimed.ok) return stopped([claimed.error])
  run = claimed.value
  return nextFor(root, run, session, needs)
}

function anglesSaid(root: string, said: string, list: string, needs: ReviewNeeds): string {
  const found = findRun(root, said)
  if (!found.ok) return stopped([found.error])
  const ids = list.split(/[,\s]+/).map((one) => one.trim().toLowerCase()).filter(Boolean)
  const done = setAngles(root, found.value, ids.map((id) => ({ id })), needs)
  return stopped([done.ok ? done.value : done.error])
}

function setAngles(root: string, run: Run, asked: { id: string; brief?: string }[], needs: ReviewNeeds): Result<string> {
  if (!runAnglesOpen(run)) return { ok: false, error: 'The reviewers have started; the angles of this review are settled.' }
  if (asked.length !== 2) return { ok: false, error: 'Name exactly two angles, like: security,tests.' }
  const angles: RunAngle[] = []
  for (const one of asked) {
    const id = one.id.trim().toLowerCase()
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || id.length > 32) return { ok: false, error: `"${id.slice(0, 40)}" is not an angle id: lowercase words joined by dashes.` }
    const had = run.plan?.angles.find((a) => a.id === id)
    angles.push({ id, brief: angleFor(id, one.brief, had ? { id, brief: had.brief, by: had.by } : undefined).brief, by: 'person', practices: had?.practices ?? [], items: had?.items ?? [] })
  }
  if (angles[0]!.id === angles[1]!.id) return { ok: false, error: 'Two different angles.' }
  /* Before the planner, the angles are kept as the person's; the planner keeps them. */
  const base = run.plan ?? { angles: [], door: { kind: 'one-way' as const, reasons: ['Not planned yet.'], rule: null }, uiux: { touches: false, reason: '', screens: [], shots: false } }
  const written = writeRun(root, { ...run, plan: { ...base, angles }, updatedAt: needs.now() })
  return written.ok ? { ok: true, value: `Angles of ${run.id}: ${angles.map((one) => one.id).join(' and ')}.` } : written
}

async function checklistSaid(root: string, said: string, what: string, session: string, needs: ReviewNeeds): Promise<string> {
  const found = findRun(root, said)
  if (!found.ok) return stopped([found.error])
  const [verb = '', ...rest] = what.trim().split(/\s+/)
  const items = verb === 'accept' ? null : verb === 'edit' ? rest.join(' ').split(';').map((one) => one.trim()).filter(Boolean) : undefined
  if (items === undefined) return stopped([`say accept, or edit <item>; <item>; …  — for example: /review-factory checklist ${found.value.id} accept`])
  const done = await acceptChecklist(root, found.value, items, needs)
  if (!done.ok) return stopped([done.error])
  const claimed = commit(root, done.value, { kind: 'claim', session }, needs)
  if (!claimed.ok) return stopped([claimed.error])
  return nextFor(root, claimed.value, session, needs, null, null, ['The checklist is made in Checklist and held against the change. The reviewers start now.'])
}

/** The person's checklist (the proposal, or their edit of it), made in Checklist and split between the reviewers. */
export async function acceptChecklist(root: string, run: Run, edited: string[] | null, needs: ReviewNeeds): Promise<Result<Run>> {
  if (run.waiting?.why !== 'checklist' || !run.proposed) return { ok: false, error: 'No proposed checklist is waiting for you on this review.' }
  const items = (edited ?? run.proposed).map((one) => one.slice(0, 200)).filter(Boolean).slice(0, 15)
  if (!items.length) return { ok: false, error: 'A checklist needs at least one item.' }
  if (!(await needs.neighbours.present(CHECKLIST))) return { ok: false, error: 'Checklist is not running here, so the list cannot be made. Start Checklist, then accept again.' }
  const made = await createChecklist(needs.neighbours, root, run.change.ref, `What ${run.change.ref} owes before it lands`, items)
  if (!made.ok) return { ok: false, error: made.why }
  const angles = (run.plan?.angles ?? []).map((one) => ({ ...one, items: [] as string[] }))
  made.list.items.forEach((item, i) => angles[i % Math.max(1, angles.length)]?.items.push(`${made.list.id}/${item.id}`))
  const packet = readRecord(root, run.id, 'packet.md')
  writeRecord(root, run.id, 'packet.md', `${packet.ok && packet.value ? packet.value : ''}\n## The checklist you accepted (${made.list.id})\n\n${made.list.items.map((one) => `- ${made.list.id}/${one.id}: ${one.text}`).join('\n')}\n`)
  return commit(root, run, { kind: 'checklist', checklists: [...run.checklists, made.list], angles }, needs)
}

function budgetSaid(root: string, said: string, words: string, needs: ReviewNeeds): string {
  const found = findRun(root, said)
  if (!found.ok) return stopped([found.error])
  const done = setBudget(root, found.value, words, needs)
  return stopped([done.ok ? done.value : done.error])
}

function setBudget(root: string, run: Run, words: string, needs: ReviewNeeds): Result<string> {
  const base = run.budget ?? sizeBudget(0, 0)
  const edited = editBudget(base, words)
  if (!edited.ok) return { ok: false, error: edited.why }
  const moved = commit(root, run, { kind: 'budget', budget: edited.budget }, needs)
  if (!moved.ok) return moved
  writeRecord(root, run.id, 'budget.md', budgetText(moved.value))
  return { ok: true, value: `Budget of ${run.id}: ${budgetLine(edited.budget)}. It holds from the next step.` }
}

/* ------------------------------------------------------------------ *
 * The board: the person's presses (ticketed, the page only)
 * ------------------------------------------------------------------ */

export type ReviewAct =
  | { act: 'review-settings'; settings: Partial<ReviewSettings> }
  | { act: 'review-angles'; run: string; angles: { id: string; brief?: string }[] }
  | { act: 'review-checklist'; run: string; items: string[] | null }
  | { act: 'review-budget'; run: string; budget: string }
  | { act: 'review-stop'; run: string }
  | { act: 'review-archive'; run: string }
  | { act: 'review-sent'; run: string }
  | { act: 'author-rule'; author: string; sentence: string; allProjects: boolean }
  | { act: 'seen'; kehikko: string; modules: string[]; selection: string[] }
  | { act: 'rows'; rows: unknown[] }

export async function actReview(root: string, body: ReviewAct, needs: ReviewNeeds): Promise<Result<string>> {
  switch (body.act) {
    case 'review-settings': {
      const had = settingsOf(root)
      const merged = { ...had, ...(body.settings ?? {}) }
      const parsed = reviewSettingsSchema.safeParse(merged)
      if (!parsed.success) return { ok: false, error: `That is not a setting Factory can keep: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`.trim() }
      if (!parseRule(parsed.data.defaultRule).ok) return { ok: false, error: (parseRule(parsed.data.defaultRule) as { why: string }).why }
      for (const rule of parsed.data.doorRules) if (!doorRuleSchema.safeParse(rule).success) return { ok: false, error: 'A door rule is a path glob or a label, and one-way or two-way.' }
      const written = writeSettings(root, { ...readSettings(root), review: parsed.data })
      return written.ok ? { ok: true, value: 'Saved for this project.' } : written
    }
    case 'author-rule': {
      const set = setRule(root, String(body.author ?? ''), String(body.sentence ?? ''), body.allProjects === true, needs.now())
      if (!set.ok) return set
      questionAnswered(root, set.value.author)
      return { ok: true, value: `${set.value.author}: re-review ${set.value.sentence}${set.value.allProjects ? ', in every project' : ''}.` }
    }
    case 'seen':
      return pageSaw(root, body)
    case 'rows':
      return pageRows(root, body.rows, needs)
    default:
      break
  }
  const found = typeof body.run === 'string' ? readRun(root, body.run) : ({ ok: false, error: 'Name the review.' } as const)
  if (!found.ok) return found
  const run = found.value
  if (!run) return { ok: false, error: `There is no review "${String(body.run).slice(0, 60)}".` }
  switch (body.act) {
    case 'review-angles':
      return setAngles(root, run, Array.isArray(body.angles) ? body.angles : [], needs)
    case 'review-checklist': {
      const done = await acceptChecklist(root, run, Array.isArray(body.items) ? body.items.map(String) : null, needs)
      return done.ok ? { ok: true, value: `The checklist is made and held against ${run.change.ref}. Type /review-factory resume ${run.id} in the conversation to go on.` } : done
    }
    case 'review-budget':
      return setBudget(root, run, String(body.budget ?? ''), needs)
    case 'review-stop': {
      const done = stopRun(root, run, 'you stopped it on the board.', needs)
      return done.ok ? { ok: true, value: 'Stopped. Its record is kept.' } : done
    }
    case 'review-archive': {
      const done = commit(root, run, { kind: 'archive' }, needs)
      return done.ok ? { ok: true, value: 'Cleared from the board.' } : done
    }
    case 'review-sent': {
      const done = commit(root, run, { kind: 'sent', by: 'person' }, needs)
      return done.ok ? { ok: true, value: 'Marked as sent.' } : done
    }
  }
}

const KEY = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/
const MODULE = /^[a-z0-9][a-z0-9.-]{0,127}$/

/** The page says which kehikko it is on, what else is there, and what is selected. */
export function pageSaw(root: string, said: { kehikko?: unknown; modules?: unknown; selection?: unknown }): Result<string> {
  if (typeof said.kehikko !== 'string' || !KEY.test(said.kehikko)) return { ok: false, error: 'That is not a kehikko.' }
  const modules = (Array.isArray(said.modules) ? said.modules : []).filter((one): one is string => typeof one === 'string' && MODULE.test(one)).slice(0, 128)
  const selection = (Array.isArray(said.selection) ? said.selection : []).filter((one): one is string => typeof one === 'string' && one.length <= 300).slice(0, 32)
  const seen = readSeen(root)
  const had = seen.kehikkos[said.kehikko]
  if (had && JSON.stringify(had.modules) === JSON.stringify(modules) && JSON.stringify(had.selection) === JSON.stringify(selection)) return { ok: true, value: 'unchanged' }
  seen.kehikkos[said.kehikko] = { modules, selection, at: new Date().toISOString() }
  const written = writeSeen(root, seen)
  return written.ok ? { ok: true, value: 'kept' } : written
}

/* ------------------------------------------------------------------ *
 * Re-review: from the host's rows (protocol 2.7.0)
 * ------------------------------------------------------------------ */

const rowSchemaLoose = (row: unknown): row is TrackerRow =>
  !!row && typeof row === 'object' && typeof (row as TrackerRow).repo === 'string' && typeof (row as TrackerRow).number === 'number' && typeof (row as TrackerRow).tracker === 'string'

/** The page hands over the host's rows for the changes under review; Factory sees who is ready for another look. */
export async function pageRows(root: string, rows: unknown[], needs: ReviewNeeds): Promise<Result<string>> {
  const good = (Array.isArray(rows) ? rows : []).filter(rowSchemaLoose).filter((row) => row.kind === 'change').slice(0, 500)
  writeJsonFile(root, 'review-rows', { version: 1, at: needs.now(), rows: good })
  const started = await checkReReviews(root, good, needs, Date.parse(needs.now()))
  return { ok: true, value: started.length ? started.join(' ') : 'nothing due' }
}

/** For each change whose last review is finished: is it due again, by its author's rule? Says what it did. */
export async function checkReReviews(root: string, rows: readonly TrackerRow[], needs: ReviewNeeds, now: number): Promise<string[]> {
  const said: string[] = []
  const settings = settingsOf(root)
  const runs = listRuns(root)
  const urls = [...new Set(runs.map((run) => run.change.url))]
  for (const url of urls) {
    const ofChange = runs.filter((run) => run.change.url === url)
    const last = ofChange[0]!
    if (last.archived || ofChange.some((run) => run.stage === 'queued' || runIsRunning(run) || run.waiting?.why === 'checklist')) continue
    const row = rows.find((one) => one.tracker === last.change.forge && one.repo === last.change.repo && one.number === last.change.number)
    if (!row) continue
    const author = last.change.author?.login ?? row.authorLogin ?? null
    if (!author) continue
    const rule = ruleFor(root, author)
    if (!rule) {
      const fallback = parseRule(settings.defaultRule)
      if (fallback.ok && due(fallback.rule, row, last, now).due) {
        if (ask(root, { author, ref: last.change.ref, url, run: last.id, askedAt: needs.now() })) said.push(`Asked you about ${author}.`)
      }
      continue
    }
    let comments: Meta['comments'] = []
    if (needsComments(rule.rule)) {
      const meta = readMeta(root, targetOf(last.change), needs.cli)
      if (meta.ok) comments = meta.meta.comments
    }
    const verdict = due(rule.rule, row, last, now, comments)
    if (!verdict.due) continue
    const run = newRun({
      id: runIdFor(targetOf(last.change), needs.suffix()),
      change: last.change,
      session: null,
      place: last.place,
      now: needs.now(),
      round: Math.min(last.round + 1, MAX_ROUNDS),
      previous: last.id,
      listed: listedOf(last),
      background: settings.reReviewByItself,
    })
    const made = makeRunDir(root, run.id)
    if (!made.ok) continue
    writeRun(root, { ...run, notes: [`Due: ${verdict.why}`] })
    if (settings.reReviewByItself) {
      const started = await startBackground(root, run, needs.spawner)
      if (!started.ok) writeRun(root, { ...run, notes: [`Due: ${verdict.why}`, `The background session could not start: ${started.error}`] })
      said.push(started.ok ? `${run.id}: re-review started in the background (${verdict.why})` : `${run.id}: ${started.error}`)
    } else said.push(`${run.id}: due for re-review (${verdict.why}); type /review-factory resume ${run.id}.`)
  }
  return said
}

/* ------------------------------------------------------------------ *
 * What others read
 * ------------------------------------------------------------------ */

/** A run as the page and other modules read it. */
export function publishedRun(root: string, run: Run) {
  return {
    id: run.id,
    change: run.change,
    stage: run.stage,
    said: describeRun(run),
    round: run.round,
    waiting: run.waiting,
    door: run.plan?.door.kind ?? null,
    uiux: run.plan?.uiux.touches ?? null,
    verdict: run.judged?.verdict ?? null,
    pathToSuccess: run.judged?.pathToSuccess ?? [],
    files: recordFiles(root, run.id),
    updatedAt: run.updatedAt,
  }
}

export function questionsOf(root: string) {
  const settings = settingsOf(root)
  return readQuestions(root).map((one) => ({ ...one, text: questionText(one.author), recommended: settings.defaultRule }))
}

/** The page's whole board: runs, questions, settings, author rules. */
export function reviewBoard(root: string) {
  return { runs: listRuns(root), questions: questionsOf(root), settings: settingsOf(root) }
}

export const recordOf = (root: string, id: string, name: string) => readRecord(root, id, name)

