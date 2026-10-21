import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'

import { git } from '../git.ts'
import { checkout, removeCheckout, reviewWorktree } from '../rev/checkout.ts'
import { locate, readMeta, spellRef, spellingsOf } from '../rev/forge.ts'
import type { Run as CliRun } from '../tracker.ts'
import { scratchForge } from './repo.ts'

let forge: ReturnType<typeof scratchForge> | null = null
afterEach(() => {
  forge?.done()
  forge = null
})

const target = { forge: 'github' as const, repo: 'me/app', number: 7 }
const remote = { kind: 'github' as const, repo: 'me/app' }

describe('which change', () => {
  test('URLs, short spellings, and refs; an issue is refused', () => {
    expect(locate('https://github.com/me/app/pull/7/files', remote)).toEqual({ ok: true, target })
    expect(locate('me/app#7', remote)).toEqual({ ok: true, target })
    expect(locate('gh#7', remote)).toEqual({ ok: true, target })
    expect(locate('#7', remote)).toEqual({ ok: true, target })
    expect(locate('https://gitlab.example.org/g/p/-/merge_requests/3', null)).toEqual({ ok: true, target: { forge: 'gitlab', repo: 'g/p', number: 3, host: 'gitlab.example.org' } })
    expect(locate('https://github.com/me/app/issues/7', remote)).toMatchObject({ ok: false, why: expect.stringContaining('an issue, not a change') })
    expect(locate('gl:g/p#4', null)).toMatchObject({ ok: false })
    expect(locate('fix the thing', remote)).toMatchObject({ ok: false, why: expect.stringContaining('Open one (a draft is fine)') })
    expect(spellRef(target, remote)).toBe('gh#7')
    expect(spellRef(target, null)).toBe('gh:me/app#7')
    expect(spellingsOf(target, remote)).toContain('gh#7')
  })

  test('gh is asked for the pull request, read only', () => {
    const calls: string[][] = []
    const run: CliRun = (command, args) => {
      calls.push([command, ...args])
      return { ok: true, err: '', out: JSON.stringify({ title: 'Shout', body: 'Makes it loud.', author: { login: 'alice', name: 'Alice' }, baseRefName: 'main', headRefOid: 'abc', labels: [{ name: 'ui' }], commits: [{ oid: 'abc', messageHeadline: 'shout' }], comments: [], state: 'OPEN', isDraft: false }) }
    }
    const read = readMeta('/p', target, run)
    expect(read).toMatchObject({ ok: true, meta: { title: 'Shout', author: { login: 'alice' }, base: 'main', head: 'abc', labels: ['ui'] } })
    expect(calls[0]!.slice(0, 5)).toEqual(['gh', 'pr', 'view', '7', '--repo'])
  })
})

describe('the run\'s own checkout', () => {
  test('is the change\'s head in a worktree beside the project, with the diff from the merge base; the project is untouched', () => {
    forge = scratchForge()
    const before = git(forge.root, ['rev-parse', '--abbrev-ref', 'HEAD']).out
    const done = checkout(forge.root, 'app-7-a1b2', target, 'main', remote)
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.value.head).toBe(forge.head)
    expect(done.value.path).toBe(reviewWorktree(forge.root, 'app-7-a1b2'))
    expect(git(done.value.path, ['rev-parse', 'HEAD']).out).toBe(forge.head)
    expect(done.value.diff).toContain('+export const greet = (name) => `HELLO, ${name}`')
    expect(git(forge.root, ['rev-parse', '--abbrev-ref', 'HEAD']).out).toBe(before)
    expect(git(forge.root, ['status', '--porcelain']).out).toBe('')
    expect(removeCheckout(forge.root, 'app-7-a1b2', done.value.path)).toBeNull()
    expect(existsSync(done.value.path)).toBe(false)
    expect(git(forge.root, ['show-ref']).out).not.toContain('factory-review')
  })

  test('a change in another repository is refused', () => {
    forge = scratchForge()
    expect(checkout(forge.root, 'app-7-a1b2', { ...target, repo: 'them/other' }, 'main', remote)).toMatchObject({ ok: false, why: expect.stringContaining('them/other') })
  })
})
