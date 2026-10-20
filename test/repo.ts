import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { git } from '../git.ts'
import type { Needs } from '../factory.ts'

/** A scratch project: a git repository with one commit on main, in its own temporary folder. */
export function scratchRepo(): { root: string; done(): void } {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'factory-test-')))
  const root = join(parent, 'app')
  mkdirSync(root)
  git(root, ['init', '-q', '-b', 'main'])
  writeFileSync(join(root, 'README.md'), '# app\n')
  writeFileSync(join(root, 'greet.js'), 'export const greet = (name) => `Hello, ${name}`\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-q', '-m', 'start'])
  return { root, done: () => rmSync(parent, { recursive: true, force: true }) }
}

export function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

/** What the factory is given in a test: the host holds exactly `roots`, a fixed clock, a fixed suffix. */
export function testNeeds(roots: string[], over: Partial<Needs> = {}): Needs {
  let tick = 0
  return {
    resolve: async (folder) => (roots.includes(folder) ? { ok: true, path: folder } : { ok: false, why: `${folder} is not a project open in Kehikot.` }),
    origin: () => 'http://127.0.0.1:8040',
    now: () => new Date(Date.UTC(2026, 9, 21, 12, 0, tick++)).toISOString(),
    suffix: () => 'a1b2',
    remote: () => null,
    github: () => 'no gh in tests',
    ...over,
  }
}
