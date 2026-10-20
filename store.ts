import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { kehikotDir, moduleDir, moduleFile, within } from 'kehikot-module-protocol'

import { ANGLE_ID, DEFAULT_SETTINGS, JOB_ID, jobSchema, queueItemSchema, settingsSchema, type Job, type QueueItem, type Settings } from './job/shape.ts'
import { ID } from './manifest.ts'

/**
 * Everything this module keeps, inside the project it is about, under `<project>/.kehikot/factory/`:
 *
 *     settings.json            the person's switch: may the judge merge by itself (off)
 *     queue.json               what the person lined up for /factory next
 *     parts-known.json         the parts of each epic, as the page last saw them (for /factory next)
 *     jobs/<job-id>/job.json   a job's state (only `job/flow.ts` decides it)
 *     jobs/<job-id>/spec.md, plan.md, build.md, decision.md
 *     jobs/<job-id>/round-<n>/review-<angle>.md, counter-<angle>.md, judgement.md
 *
 * The folder and the joins are the protocol's (`moduleDir`, `moduleFile`). Nothing goes in the
 * project's own tree: a job's code lives in its worktree beside the project, on its own branch.
 *
 * There is no default project: with no root every read is empty and every write is refused. Both
 * sides are realpath'd before the containment check, so a `.kehikot` that is a symlink out of the
 * project is refused rather than followed. Every write is synchronous from read to rename, so two
 * writes in this one-threaded server never interleave.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const NO_PROJECT = 'Nothing has said which project this is, so there is nowhere to keep a job.'

/** The files of a job an agent writes and a person reads: a fixed set of shapes, never a path from a request. */
export const JOB_FILE = new RegExp(
  `^(?:(?:spec|plan|build|decision)\\.md|round-[1-9][0-9]?/(?:(?:review|counter)-${ANGLE_ID.source.slice(1, -1)}|judgement)\\.md)$`,
)

/** The real folder of a project, or why not. */
export function projectRoot(projectPath: string | null | undefined): Result<string> {
  const raw = typeof projectPath === 'string' ? projectPath.trim() : ''
  if (!raw) return { ok: false, error: NO_PROJECT }
  if (!isAbsolute(raw)) return { ok: false, error: `"${raw}" is not an absolute path.` }
  try {
    const real = realpathSync(raw)
    if (!statSync(real).isDirectory()) return { ok: false, error: `"${raw}" is not a folder.` }
    return { ok: true, value: real }
  } catch {
    return { ok: false, error: `there is no folder at "${raw}" on this machine.` }
  }
}

/** `<project>/.kehikot/factory`, the one folder this module writes in a project. */
export const factoryDir = (root: string): string => moduleDir(root, ID)!

export function jobsDir(root: string): string {
  return join(factoryDir(root), 'jobs')
}

export function jobDir(root: string, id: string): string | null {
  return JOB_ID.test(id) ? join(jobsDir(root), id) : null
}

/** A job's file by its relative name (`round-2/review-security.md`), or null when that is not one. */
export function jobFile(root: string, id: string, name: string): string | null {
  const dir = jobDir(root, id)
  if (!dir || !JOB_FILE.test(name)) return null
  return join(dir, name)
}

function escapes(root: string, child: string): string | null {
  let real: string
  try {
    real = realpathSync(child)
  } catch {
    return `${child} could not be resolved, so nothing is read or written through it.`
  }
  return within(root, real) ? null : `${child} resolves to ${real}, outside the project. Refused rather than followed.`
}

/** Every existing level from `.kehikot` down to `path` resolves inside the project. */
function confined(root: string, path: string): string | null {
  const top = kehikotDir(root)!
  if (!within(top, path)) return `${path} is not under ${top}.`
  let at = path
  const levels: string[] = []
  while (within(top, at)) {
    levels.push(at)
    if (at === top) break
    at = dirname(at)
  }
  for (const level of levels.reverse()) {
    if (!existsSync(level)) break
    const escaped = escapes(root, level)
    if (escaped) return escaped
  }
  return null
}

/** Make the folders down to `dir`, inside the project, checked before and after. */
function makeDir(root: string, dir: string): string | null {
  const before = confined(root, dir)
  if (before) return before
  mkdirSync(dir, { recursive: true })
  return confined(root, dir)
}

function writeAtomic(root: string, path: string, text: string): Result<null> {
  const made = makeDir(root, dirname(path))
  if (made) return { ok: false, error: made }
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, text)
  renameSync(temporary, path)
  return { ok: true, value: null }
}

function readText(root: string, path: string): Result<string | null> {
  if (!existsSync(path)) return { ok: true, value: null }
  const escaped = confined(root, path)
  if (escaped) return { ok: false, error: escaped }
  try {
    return { ok: true, value: readFileSync(path, 'utf8') }
  } catch (e) {
    return { ok: false, error: `${path} could not be read: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Make a job's folder (and a round's), so an agent has somewhere to write. */
export function makeJobDir(root: string, id: string, round = 0): Result<string> {
  const dir = jobDir(root, id)
  if (!dir) return { ok: false, error: `"${id}" is not a job id.` }
  const at = round > 0 ? join(dir, `round-${round}`) : dir
  const made = makeDir(root, at)
  return made ? { ok: false, error: made } : { ok: true, value: dir }
}

/* ---- Jobs ------------------------------------------------------------ */

export function readJob(root: string, id: string): Result<Job | null> {
  const dir = jobDir(root, id)
  if (!dir) return { ok: false, error: `"${id.slice(0, 60)}" is not a job id.` }
  const text = readText(root, join(dir, 'job.json'))
  if (!text.ok) return text
  if (text.value === null) return { ok: true, value: null }
  try {
    const parsed = jobSchema.safeParse(JSON.parse(text.value))
    if (!parsed.success) return { ok: false, error: `${join(dir, 'job.json')} is not a job this Factory can read.` }
    return { ok: true, value: parsed.data }
  } catch {
    return { ok: false, error: `${join(dir, 'job.json')} is not readable JSON.` }
  }
}

export function writeJob(root: string, job: Job): Result<null> {
  const dir = jobDir(root, job.id)
  if (!dir) return { ok: false, error: `"${job.id}" is not a job id.` }
  return writeAtomic(root, join(dir, 'job.json'), `${JSON.stringify(jobSchema.parse(job), null, 2)}\n`)
}

/** Every job of the project that can be read, newest first. Unreadable ones are skipped. */
export function listJobs(root: string): Job[] {
  const dir = jobsDir(root)
  if (!existsSync(dir) || confined(root, dir)) return []
  const jobs: Job[] = []
  for (const name of readdirSync(dir)) {
    if (!JOB_ID.test(name)) continue
    const read = readJob(root, name)
    if (read.ok && read.value) jobs.push(read.value)
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** One of a job's markdown files, or null when it is not written yet. */
export function readJobFile(root: string, id: string, name: string): Result<string | null> {
  const path = jobFile(root, id, name)
  if (!path) return { ok: false, error: `"${name.slice(0, 80)}" is not one of a job's files.` }
  return readText(root, path)
}

/** Which of a job's files exist, by relative name, in reading order. */
export function jobFiles(root: string, id: string): string[] {
  const dir = jobDir(root, id)
  if (!dir || !existsSync(dir) || confined(root, dir)) return []
  const out: string[] = []
  for (const name of ['spec.md', 'plan.md', 'build.md']) if (existsSync(join(dir, name))) out.push(name)
  const rounds = readdirSync(dir)
    .map((name) => /^round-([1-9][0-9]?)$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)
  for (const round of rounds) {
    const order = (name: string) => (name.startsWith('review-') ? 0 : name.startsWith('counter-') ? 1 : 2)
    const names = readdirSync(join(dir, `round-${round}`)).sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    for (const name of names) {
      const relative = `round-${round}/${name}`
      if (JOB_FILE.test(relative)) out.push(relative)
    }
  }
  if (existsSync(join(dir, 'decision.md'))) out.push('decision.md')
  return out
}

/** The module's own account of a job's end, `decision.md`. */
export function writeDecision(root: string, id: string, text: string): Result<null> {
  const path = jobFile(root, id, 'decision.md')
  if (!path) return { ok: false, error: `"${id}" is not a job id.` }
  return writeAtomic(root, path, text)
}

/* ---- Settings, queue, parts ------------------------------------------ */

function readJson(root: string, name: string): Result<unknown> {
  const text = readText(root, moduleFile(root, ID, name)!)
  if (!text.ok) return text
  if (text.value === null) return { ok: true, value: null }
  try {
    return { ok: true, value: JSON.parse(text.value) }
  } catch {
    return { ok: false, error: `${moduleFile(root, ID, name)} is not readable JSON. Nothing was changed; fix or remove the file.` }
  }
}

function writeJson(root: string, name: string, value: unknown): Result<null> {
  return writeAtomic(root, moduleFile(root, ID, name)!, `${JSON.stringify(value, null, 2)}\n`)
}

/** The person's settings, off by default; a file that cannot be read is the defaults. */
export function readSettings(root: string): Settings {
  const read = readJson(root, 'settings')
  if (!read.ok || read.value === null) return { ...DEFAULT_SETTINGS }
  const parsed = settingsSchema.safeParse(read.value)
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS }
}

export function writeSettings(root: string, settings: Settings): Result<null> {
  return writeJson(root, 'settings', settingsSchema.parse(settings))
}

export function readQueue(root: string): QueueItem[] {
  const read = readJson(root, 'queue')
  if (!read.ok || !read.value || typeof read.value !== 'object') return []
  const items = (read.value as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  return items.flatMap((one) => {
    const parsed = queueItemSchema.safeParse(one)
    return parsed.success ? [parsed.data] : []
  })
}

export function writeQueue(root: string, items: QueueItem[]): Result<null> {
  return writeJson(root, 'queue', { version: 1, items: items.map((one) => queueItemSchema.parse(one)) })
}

export interface KnownPart {
  id: string
  heading: string
}

/** The parts of each epic as the board last saw them: what /factory next walks. */
export function readKnownParts(root: string): Record<string, KnownPart[]> {
  const read = readJson(root, 'parts-known')
  if (!read.ok || !read.value || typeof read.value !== 'object') return {}
  const epics = (read.value as { epics?: unknown }).epics
  if (!epics || typeof epics !== 'object') return {}
  const out: Record<string, KnownPart[]> = {}
  for (const [epic, parts] of Object.entries(epics as Record<string, unknown>)) {
    if (!Array.isArray(parts)) continue
    out[epic] = parts.filter((one): one is KnownPart => !!one && typeof one.id === 'string' && typeof one.heading === 'string')
  }
  return out
}

/** Keep one epic's parts; no write when nothing changed. */
export function writeKnownParts(root: string, epic: string, parts: KnownPart[]): Result<boolean> {
  const all = readKnownParts(root)
  if (JSON.stringify(all[epic] ?? null) === JSON.stringify(parts)) return { ok: true, value: false }
  all[epic] = parts
  const written = writeJson(root, 'parts-known', { version: 1, epics: all })
  return written.ok ? { ok: true, value: true } : written
}
