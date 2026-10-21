/**
 * Reading a unified diff (`git diff`), and finding the lines a point is anchored to (part of
 * `review/`, free of anything Factory-specific). The line numbers are the diff's own: `old` is the
 * first column, `new` the second, the same frame Review anchors a comment in, so a point that is
 * checked here is a point Review can place.
 */

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx'
  old: number | null
  new: number | null
  text: string
}

export interface Hunk {
  lines: DiffLine[]
}

export interface DiffFile {
  /** The path on the new side, or the old path for a deleted file. */
  path: string
  /** The path before, when the change renamed (or deleted) it. */
  from: string | null
  hunks: Hunk[]
}

/** The line git writes for a renamed file's old path. */
const RENAMED = ['rename', 'from', ''].join(' ')

const unquote = (path: string) => path.replace(/^"(.*)"$/, '$1')

export function parseUnified(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: Hunk | null = null
  let oldAt = 0
  let newAt = 0
  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(raw)
      file = { path: unquote(m?.[2] ?? ''), from: m && m[1] !== m[2] ? unquote(m[1]!) : null, hunks: [] }
      files.push(file)
      hunk = null
      continue
    }
    if (!file) continue
    if (!hunk) {
      if (raw.startsWith('--- ')) continue
      if (raw.startsWith('+++ ')) {
        const now = raw.slice(4)
        if (now === '/dev/null') {
          /* Deleted: the file is named by its old path. */
          file.from = file.from ?? file.path
        } else file.path = unquote(now.replace(/^b\//, ''))
        continue
      }
      if (raw.startsWith(RENAMED)) {
        file.from = raw.slice(RENAMED.length)
        continue
      }
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (header) {
      hunk = { lines: [] }
      file.hunks.push(hunk)
      oldAt = Number(header[1])
      newAt = Number(header[2])
      continue
    }
    if (!hunk) continue
    if (raw.startsWith('+')) hunk.lines.push({ kind: 'add', old: null, new: newAt++, text: raw.slice(1) })
    else if (raw.startsWith('-')) hunk.lines.push({ kind: 'del', old: oldAt++, new: null, text: raw.slice(1) })
    else if (raw.startsWith(' ')) hunk.lines.push({ kind: 'ctx', old: oldAt++, new: newAt++, text: raw.slice(1) })
    else if (raw.startsWith('\\')) continue
    else if (raw === '') continue
    else hunk = null
  }
  return files
}

export function fileIn(files: readonly DiffFile[], path: string): DiffFile | null {
  return files.find((one) => one.path === path) ?? files.find((one) => one.from === path) ?? null
}

export interface At {
  path: string
  side: 'new' | 'old'
  line: number
  startLine?: number
}

export type Lines = { ok: true; text: string; lines: DiffLine[] } | { ok: false; why: string }

/** The lines of a diff an anchor names: on one side, inside one hunk. */
export function linesAt(files: readonly DiffFile[], at: At): Lines {
  const file = fileIn(files, at.path)
  if (!file) return { ok: false, why: `${at.path} is not in this diff.` }
  const first = at.startLine ?? at.line
  if (first > at.line) return { ok: false, why: `the range starts at ${first}, after its last line ${at.line}.` }
  const on = (line: DiffLine) => (at.side === 'new' ? line.new : line.old)
  for (const hunk of file.hunks) {
    const start = hunk.lines.findIndex((line) => on(line) === first)
    if (start < 0) continue
    const end = hunk.lines.findIndex((line) => on(line) === at.line)
    if (end < 0) return { ok: false, why: `lines ${first}–${at.line} of ${at.path} are not in one hunk of this diff.` }
    const lines = hunk.lines.slice(start, end + 1).filter((line) => on(line) !== null)
    return { ok: true, lines, text: lines.map((line) => line.text).join('\n') }
  }
  return { ok: false, why: `line ${first} (${at.side} side) of ${at.path} is not in this diff.` }
}

export function totals(files: readonly DiffFile[]): { files: number; added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const file of files) for (const hunk of file.hunks) for (const line of hunk.lines) {
    if (line.kind === 'add') added++
    else if (line.kind === 'del') removed++
  }
  return { files: files.length, added, removed }
}
