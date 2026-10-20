import { closeSync, existsSync, fstatSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * What the conversation running a job did last, read from Claude Code's own transcript — the way
 * the Orchestrator module follows a session: nothing is asked of the session, nothing attached to
 * it; the JSONL Claude Code keeps for its own resume is read, from the end. Used to put one live line
 * on a running job's card ("Agent: reviewer (security)", "Bash: bun test").
 *
 * Read only, and only the last few kilobytes. `node:fs`: the server runs under node.
 */

/** Claude Code's folder: `$CLAUDE_CONFIG_DIR`, or `~/.claude`. Read, never written. */
export function claudeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude') // kehikot-storage: allow reading Claude Code's own transcripts, never writing there
}

const SESSION = /^[A-Za-z0-9-]{8,64}$/
const TAIL_BYTES = 64 * 1024

/** The transcript file of a session, looked for in every project folder Claude Code keeps. */
export function transcriptOf(session: string, dir = claudeDir()): string | null {
  if (!SESSION.test(session)) return null
  const projects = join(dir, 'projects')
  if (!existsSync(projects)) return null
  for (const folder of readdirSync(projects)) {
    const path = join(projects, folder, `${session}.jsonl`)
    if (existsSync(path)) return path
  }
  return null
}

export interface Lately {
  /** When the transcript last changed, ms. */
  at: number
  /** One line: the last tool the conversation called, or the start of what it last said. */
  line: string
}

function tail(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

const short = (text: string, max = 100) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`
}

/** One line for a tool call: its name and the argument a person would recognise. */
function toolLine(name: string, input: Record<string, unknown>): string {
  const said = input.description ?? input.command ?? input.file_path ?? input.pattern ?? input.prompt ?? ''
  return short(`${name}${said ? `: ${String(said)}` : ''}`)
}

export function lately(session: string, dir = claudeDir()): Lately | null {
  const path = transcriptOf(session, dir)
  if (!path) return null
  let rows: string[]
  try {
    rows = tail(path).split('\n').filter(Boolean)
  } catch {
    return null
  }
  const at = statSync(path).mtimeMs
  for (const row of rows.reverse()) {
    let entry: { type?: string; message?: { content?: unknown } }
    try {
      entry = JSON.parse(row)
    } catch {
      continue
    }
    if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue
    const blocks = entry.message.content as { type?: string; name?: string; input?: Record<string, unknown>; text?: string }[]
    const tool = [...blocks].reverse().find((block) => block.type === 'tool_use')
    if (tool?.name) return { at, line: toolLine(tool.name, tool.input ?? {}) }
    const text = blocks.find((block) => block.type === 'text' && block.text?.trim())
    if (text?.text) return { at, line: short(text.text) }
  }
  return { at, line: '' }
}
