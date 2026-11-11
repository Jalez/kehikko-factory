import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Modules never name each other: Factory finds what it writes into by SERVICE (rev/neighbours.ts) and
 * says each provider's own name. This scans every tracked file of Factory's own code and words — not
 * tests, notes, docs, the changelog, the skills' text (their own pass) or the lockfile — for another
 * module's id, the tools it used to call by name, another module's data folder, and the retired key.
 */

const ROOT = join(import.meta.dirname, '..')

const SKIPPED = [/^test\//, /^notes\//, /^docs\//, /^plugin\/skills\//, /^CHANGELOG/, /^bun\.lock$/, /^node_modules\//, /^dist\//]

const OTHER_MODULES = ['paper', 'review', 'checklist', 'flows', 'journeys', 'claude', 'codex', 'antigravity', 'opencode', 'vibe', 'notes', 'history', 'screenplay', 'queue', 'source', 'slides', 'browser', 'explorer', 'learning', 'notifications', 'monitor', 'editor', 'diff']

const FORBIDDEN: { what: string; pattern: RegExp }[] = [
  { what: 'another module\'s id', pattern: new RegExp(`\\b(?:kehikot|roadmap)\\.(?:${OTHER_MODULES.join('|')})\\b`) },
  { what: 'another module\'s data folder', pattern: new RegExp(`\\.kehikot/(?:${OTHER_MODULES.join('|')})\\b`) },
  { what: 'a tool spelled instead of read from a descriptor', pattern: /\b(?:add_comment|propose_review|drop_run_comments|create_checklist|add_checklist_item|hold_checklist|check_item|propose_edit|write_flow|list_sections|read_source)\b|,\s*['"`]checklists['"`]\s*,/ },
  { what: 'the retired private key', pattern: /Factory-Key|review-factory\.key|readFactoryKey|REVIEW_FACTORY_KEY|keysDir|KEHIKOT_KEYS_DIR/i },
]

/** What still names another module, each with why. Not for growing: none is left. */
const ALLOWED: { file: string; line: RegExp }[] = []

function files(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path && !SKIPPED.some((skip) => skip.test(path)) && /\.(?:ts|tsx|json|md|html|css)$/.test(path))
}

describe('Factory names no other module', () => {
  test('no id, tool, data folder or key of another module in its code and words', () => {
    const hits: string[] = []
    for (const file of files()) {
      let text: string
      try {
        text = readFileSync(join(ROOT, file), 'utf8')
      } catch {
        continue
      }
      text.split('\n').forEach((line, i) => {
        for (const one of FORBIDDEN) {
          if (!one.pattern.test(line)) continue
          if (ALLOWED.some((allowed) => allowed.file === file && allowed.line.test(line))) continue
          hits.push(`${file}:${i + 1}: ${one.what}: ${line.trim().slice(0, 160)}`)
        }
      })
    }
    expect(hits).toEqual([])
  })

  test('the scan sees what it is meant to (it would catch a hit)', () => {
    expect(files()).toContain('rev/neighbours.ts')
    expect(files()).toContain('review-factory.ts')
    expect(FORBIDDEN[0]!.pattern.test("const X = 'kehikot.paper'")).toBe(true)
    expect(FORBIDDEN[2]!.pattern.test("n.call(id, 'check_item', {})")).toBe(true)
  })
})
