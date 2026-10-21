import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { ANGLE_ID } from '../review/angles.ts'
import { confined, factoryDir, makeDir, readJson, readText, writeAtomic, writeJson, type Result } from '../store.ts'
import { RUN_ID, runSchema, type Run } from './shape.ts'

/**
 * What `/review-factory` keeps, inside the project, under `<project>/.kehikot/factory/`:
 *
 *     reviews/<id>/run.json          a run's state (only rev/flow.ts decides it)
 *     reviews/<id>/packet.md …       its record: "How this review was made" (RECORD_FILES)
 *     review-seen.json               which kehikkos the page saw Factory on, with what else is there
 *     review-rows.json               the tracker rows of the changes under review, as the page read them
 *     review-questions.json          first-time questions about an author, waiting for the person
 *     review-authors.json            this project's re-review rules, per author
 *
 * The same confinement as the jobs (store.ts): every level from `.kehikot` down resolves inside the
 * project, and a name is one of a fixed set of shapes, never a path from a request. The record is
 * never posted anywhere; the person reads it on the card and in Review.
 */

const ANGLE = ANGLE_ID.source.slice(1, -1)

/** The record's files, in reading order. */
export const RECORD_ORDER = [
  'packet.md',
  'budget.md',
  'plan.md',
  'review-*.md',
  'validation.md',
  'points.md',
  'challenge.md',
  'judgement.md',
  'diagrams.md',
  'briefing.md',
  'draft.md',
  'diff.patch',
  'delta.patch',
] as const

export const RECORD_FILE = new RegExp(
  `^(?:(?:packet|budget|plan|validation|points|challenge|judgement|diagrams|briefing|draft)\\.md|review-${ANGLE}\\.md|(?:diff|delta)\\.patch)$`,
)

export const reviewsDir = (root: string): string => join(factoryDir(root), 'reviews')

export function runDir(root: string, id: string): string | null {
  return RUN_ID.test(id) ? join(reviewsDir(root), id) : null
}

export function recordPath(root: string, id: string, name: string): string | null {
  const dir = runDir(root, id)
  return dir && RECORD_FILE.test(name) ? join(dir, name) : null
}

export function makeRunDir(root: string, id: string): Result<string> {
  const dir = runDir(root, id)
  if (!dir) return { ok: false, error: `"${id.slice(0, 60)}" is not a review id.` }
  const made = makeDir(root, dir)
  return made ? { ok: false, error: made } : { ok: true, value: dir }
}

export function readRun(root: string, id: string): Result<Run | null> {
  const dir = runDir(root, id)
  if (!dir) return { ok: false, error: `"${id.slice(0, 60)}" is not a review id.` }
  const text = readText(root, join(dir, 'run.json'))
  if (!text.ok) return text
  if (text.value === null) return { ok: true, value: null }
  try {
    const parsed = runSchema.safeParse(JSON.parse(text.value))
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: `${join(dir, 'run.json')} is not a review this Factory can read.` }
  } catch {
    return { ok: false, error: `${join(dir, 'run.json')} is not readable JSON.` }
  }
}

export function writeRun(root: string, run: Run): Result<null> {
  const dir = runDir(root, run.id)
  if (!dir) return { ok: false, error: `"${run.id}" is not a review id.` }
  return writeAtomic(root, join(dir, 'run.json'), `${JSON.stringify(runSchema.parse(run), null, 2)}\n`)
}

/** Every readable run of the project, newest first. */
export function listRuns(root: string): Run[] {
  const dir = reviewsDir(root)
  if (!existsSync(dir) || confined(root, dir)) return []
  const runs: Run[] = []
  for (const name of readdirSync(dir)) {
    if (!RUN_ID.test(name)) continue
    const read = readRun(root, name)
    if (read.ok && read.value) runs.push(read.value)
  }
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function writeRecord(root: string, id: string, name: string, text: string): Result<null> {
  const path = recordPath(root, id, name)
  if (!path) return { ok: false, error: `"${name.slice(0, 80)}" is not one of a review's files.` }
  return writeAtomic(root, path, text)
}

export function readRecord(root: string, id: string, name: string): Result<string | null> {
  const path = recordPath(root, id, name)
  if (!path) return { ok: false, error: `"${name.slice(0, 80)}" is not one of a review's files.` }
  return readText(root, path)
}

/** The record's files that exist, in reading order. */
export function recordFiles(root: string, id: string): string[] {
  const dir = runDir(root, id)
  if (!dir || !existsSync(dir) || confined(root, dir)) return []
  const names = readdirSync(dir).filter((name) => RECORD_FILE.test(name))
  const order = (name: string) => RECORD_ORDER.findIndex((one) => (one.includes('*') ? name.startsWith(one.split('*')[0]!) : one === name))
  return names.sort((a, b) => order(a) - order(b) || a.localeCompare(b))
}

/* ---- What the page reports, and what the person said --------------------------------- */

export interface Seen {
  /** Per kehikko key: the modules on it when the page last looked, and the refs selected there. */
  kehikkos: Record<string, { modules: string[]; selection: string[]; at: string }>
}

export function readSeen(root: string): Seen {
  const read = readJson(root, 'review-seen')
  const value = read.ok ? (read.value as Partial<Seen> | null) : null
  return { kehikkos: value && typeof value.kehikkos === 'object' && value.kehikkos ? value.kehikkos : {} }
}

export function writeSeen(root: string, seen: Seen): Result<null> {
  return writeJson(root, 'review-seen', seen)
}

export function readJsonFile<T>(root: string, name: 'review-rows' | 'review-questions' | 'review-authors', fallback: T): T {
  const read = readJson(root, name)
  return read.ok && read.value !== null && typeof read.value === 'object' ? (read.value as T) : fallback
}

export function writeJsonFile(root: string, name: 'review-rows' | 'review-questions' | 'review-authors', value: unknown): Result<null> {
  return writeJson(root, name, value)
}
