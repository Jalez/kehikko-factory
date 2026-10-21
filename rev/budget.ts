import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { claudeDir, transcriptOf } from '../transcript.ts'
import type { Budget } from './shape.ts'

/**
 * A review's budget: sized from the change, shown before the run starts, editable by the person,
 * and never exceeded silently.
 *
 *  - **Caps**: points per reviewer, files a reviewer may read beyond the diff, and a soft token
 *    budget. Small (under 150 changed lines), medium (under 600), large.
 *  - **Spend** is read from Claude Code's own transcript of the conversation running the review,
 *    and its subagents' (`<session>/subagents/*.jsonl`), the way the Orchestrator follows a session:
 *    nothing is asked of the session. Every assistant message's usage counted once (a message
 *    streamed in several rows carries the same id): input, output and cache writes; cache reads
 *    are counted apart, being cheap.
 */

export const SIZES = {
  small: { pointsPerReviewer: 4, filesBeyondDiff: 5, tokens: 150_000 },
  medium: { pointsPerReviewer: 6, filesBeyondDiff: 10, tokens: 300_000 },
  large: { pointsPerReviewer: 8, filesBeyondDiff: 20, tokens: 600_000 },
} as const

export function sizeBudget(files: number, lines: number): Budget {
  const size = lines < 150 && files <= 8 ? 'small' : lines < 600 && files <= 30 ? 'medium' : 'large'
  return { size, files, lines, ...SIZES[size] }
}

export const budgetLine = (budget: Budget): string =>
  `${budget.size} change (${budget.files} file${budget.files === 1 ? '' : 's'}, ${budget.lines} lines): at most ${budget.pointsPerReviewer} points per reviewer, `
  + `${budget.filesBeyondDiff} files read beyond the diff, about ${Math.round(budget.tokens / 1000)}k tokens`

/** `points=6 files=10 tokens=300k`, as a person types it; what is not named stays as it was. */
export function editBudget(budget: Budget, said: string): { ok: true; budget: Budget } | { ok: false; why: string } {
  const next = { ...budget }
  const words = said.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return { ok: false, why: 'Say what to change: points=N files=N tokens=N (tokens may end in k).' }
  for (const word of words) {
    const m = /^(points|files|tokens)=(\d{1,7})(k?)$/i.exec(word)
    if (!m) return { ok: false, why: `"${word.slice(0, 40)}" is not points=N, files=N or tokens=N.` }
    const value = Number(m[2]) * (m[3] ? 1000 : 1)
    if (m[1]!.toLowerCase() === 'points') next.pointsPerReviewer = Math.min(20, Math.max(1, value))
    else if (m[1]!.toLowerCase() === 'files') next.filesBeyondDiff = Math.min(100, value)
    else next.tokens = Math.max(1000, value)
  }
  return { ok: true, budget: next }
}

const TAIL_BYTES = 4 * 1024 * 1024

function rows(path: string): string[] {
  const size = statSync(path).size
  if (size <= TAIL_BYTES) return readFileSync(path, 'utf8').split('\n')
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(TAIL_BYTES)
    readSync(fd, buffer, 0, TAIL_BYTES, size - TAIL_BYTES)
    return buffer.toString('utf8').split('\n').slice(1)
  } finally {
    closeSync(fd)
  }
}

export interface Spent {
  tokens: number
  cached: number
}

/** What a conversation and its subagents spent since `since` (ISO), from the transcripts. */
export function spentSince(session: string, since: string, dir = claudeDir()): Spent {
  const main = transcriptOf(session, dir)
  if (!main) return { tokens: 0, cached: 0 }
  const files = [main]
  const subagents = join(dirname(main), session, 'subagents')
  if (existsSync(subagents)) for (const name of readdirSync(subagents)) if (name.endsWith('.jsonl')) files.push(join(subagents, name))
  const seen = new Set<string>()
  let tokens = 0
  let cached = 0
  for (const file of files) {
    let lines: string[]
    try {
      lines = rows(file)
    } catch {
      continue
    }
    for (const row of lines) {
      if (!row.includes('"usage"')) continue
      let entry: { type?: string; timestamp?: string; message?: { id?: string; usage?: Record<string, unknown> } }
      try {
        entry = JSON.parse(row)
      } catch {
        continue
      }
      if (entry.type !== 'assistant' || !entry.message?.usage || (entry.timestamp ?? '') < since) continue
      const id = entry.message.id ?? `${file}:${entry.timestamp}`
      if (seen.has(id)) continue
      seen.add(id)
      const usage = entry.message.usage
      const n = (key: string) => (typeof usage[key] === 'number' ? (usage[key] as number) : 0)
      tokens += n('input_tokens') + n('output_tokens') + n('cache_creation_input_tokens')
      cached += n('cache_read_input_tokens')
    }
  }
  return { tokens, cached }
}
