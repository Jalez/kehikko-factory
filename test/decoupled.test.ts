import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import * as manifest from '../manifest.ts'

/* Modules do not name each other: text an agent or a person reads says what the other thing does.
   "Inbox" is a host term and may stay. */
const OTHERS = ['Journeys', 'References', 'Checklist', 'Paper', 'Slides', 'Citations', 'Notes', 'Learning', 'Source', 'Diff', 'Review', 'Explorer', 'Terminal', 'History', 'Orchestrator', 'Browser', 'Editor', 'Build Pipeline', 'Kanban', 'Monitor', 'Queue', 'Worktrees', 'Flows', 'Screenplay', 'Codex', 'Antigravity', 'OpenCode', 'Vibe'].filter((n) => n !== 'Build Pipeline')
const ROOT = join(import.meta.dir, '..')
/* Agent modules are named by id only: "Claude" as a word is the model. */
const lower = [...OTHERS.map((n) => n.toLowerCase()), 'claude', 'notifications'].join('|')
const names = new RegExp(`\\b(${OTHERS.join('|')})\\b|(kehikot|roadmap)\\.(${lower})\\b|\\.kehikot/(${lower})\\b|mcp__(${lower})__`)
/* Another module's id (either spelling) or its folder under `.kehikot/`. */
const ids = new RegExp(`(kehikot|roadmap)\\.(${lower})\\b|\\.kehikot/(${lower})\\b`)

/* Lines where a capitalised everyday word is only a word, not a module. */
const PLAIN: string[] = ['Spec, Plan, Build, Review, Judge', 'Review a pull or merge request', 'Review, round 1', '"text": "Review"']
const found = (text: string): string[] => text.split('\n').filter((line) => names.test(line) && !PLAIN.some((one) => line.includes(one)))
const read = (path: string): string => (existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), 'utf8') : '')

describe('no module names another', () => {
  test('the manifest, its help and what agents are told', () => {
    /* Everything the manifest module exports: the manifest itself, its help, what agents are told. */
    expect(found(JSON.stringify({ ...manifest }, null, 1))).toEqual([])
  })

  test('the skills', () => {
    const dir = join(ROOT, 'plugin', 'skills')
    const skills = existsSync(dir) ? readdirSync(dir).map((one) => read(`plugin/skills/${one}/SKILL.md`)) : []
    /* allowed-tools names tools, which is functional; the prose is what is read. */
    for (const text of skills) expect(found(text.split('\n').filter((line) => !line.startsWith('allowed-tools')).join('\n'))).toEqual([])
  })

  test('it would catch one', () => {
    expect(ids.test("const X = 'roadmap.paper'")).toBe(true)
    expect(ids.test("join(root, '.kehikot/claude/places.json')")).toBe(true)
    expect(names.test('open it in the Browser')).toBe(true)
  })

  test('the descriptions an agent reads in the code', () => {
    for (const file of ["doors.ts", "job/prompts.ts", "review/prompts.ts", "review-factory.ts", "factory.ts", "place.ts", "settings.ts", "skills.ts", "rev/neighbours.ts"]) {
      let inBlock = false
      const lines = read(file).split('\n').filter((line) => {
        const was = inBlock
        if (!inBlock && /^\s*\/\*/.test(line)) inBlock = true
        if (inBlock && line.includes('*/')) inBlock = false
        return !was && !/^\s*(\/\*|\*|\/\/)/.test(line) && !/^\s*import /.test(line)
      })
      expect(lines.filter((line) => ids.test(line)).map((line) => `${file}: ${line.trim()}`)).toEqual([])
    }
  })
})
