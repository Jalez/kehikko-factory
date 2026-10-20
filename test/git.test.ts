import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { addWorktree, cleanup, git, isMerged, merge, worktreePath } from '../git.ts'
import { newJob } from '../job/flow.ts'
import type { Job } from '../job/shape.ts'
import { scratchRepo } from './repo.ts'

let repo: ReturnType<typeof scratchRepo>
afterEach(() => repo?.done())

function jobWith(root: string): Job {
  const job = newJob({ id: 'shout-a1b2', title: 'Shout', feature: 'Shout', anglesAsked: null, place: null, session: 'session-1234', now: 'now' })
  const made = addWorktree(root, job.id)
  if (!made.ok) throw new Error(made.why)
  return { ...job, stage: 'waiting', git: made.git }
}

function commitIn(dir: string, file: string, text: string) {
  writeFileSync(join(dir, file), text)
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', `change ${file}`])
}

describe('a job\'s worktree and merge', () => {
  test('the worktree is beside the project, on factory/<job>, from main', () => {
    repo = scratchRepo()
    const job = jobWith(repo.root)
    expect(job.git!.worktree).toBe(worktreePath(repo.root, job.id))
    expect(job.git!.worktree.startsWith(join(repo.root, '..', 'app-factory'))).toBe(true)
    expect(git(job.git!.worktree, ['rev-parse', '--abbrev-ref', 'HEAD']).out).toBe('factory/shout-a1b2')
    expect(job.git!.main).toBe('main')
  })

  test('merges with a merge commit, then removes the worktree and branch once the merge is confirmed', () => {
    repo = scratchRepo()
    const job = jobWith(repo.root)
    commitIn(job.git!.worktree, 'greet.js', 'export const greet = (name) => `HELLO, ${name}`\n')
    expect(cleanup(repo.root, job).cleaned).toBe(false)
    expect(existsSync(job.git!.worktree)).toBe(true)
    const merged = merge(repo.root, job)
    expect(merged.ok).toBe(true)
    expect(git(repo.root, ['rev-list', '--parents', '-n', '1', 'main']).out.split(' ').length).toBe(3)
    expect(isMerged(repo.root, job)).toBe(true)
    expect(cleanup(repo.root, job)).toEqual({ cleaned: true, left: null })
    expect(existsSync(job.git!.worktree)).toBe(false)
    expect(git(repo.root, ['show-ref', '--verify', '--quiet', 'refs/heads/factory/shout-a1b2']).ok).toBe(false)
  })

  test('refuses on a conflict after main moved, and leaves main exactly as it was', () => {
    repo = scratchRepo()
    const job = jobWith(repo.root)
    commitIn(job.git!.worktree, 'greet.js', 'export const greet = () => "built"\n')
    commitIn(repo.root, 'greet.js', 'export const greet = () => "moved on main"\n')
    const before = git(repo.root, ['rev-parse', 'main']).out
    const merged = merge(repo.root, job)
    expect(merged.ok).toBe(false)
    if (!merged.ok) {
      expect(merged.why).toContain('main moved since the build')
      expect(merged.why).toContain('greet.js')
    }
    expect(git(repo.root, ['rev-parse', 'main']).out).toBe(before)
    expect(git(repo.root, ['status', '--porcelain']).out).toBe('')
    expect(existsSync(job.git!.worktree)).toBe(true)
  })

  test('main that moved without a conflict is merged', () => {
    repo = scratchRepo()
    const job = jobWith(repo.root)
    commitIn(job.git!.worktree, 'greet.js', 'export const greet = () => "built"\n')
    commitIn(repo.root, 'README.md', '# app, moved\n')
    expect(merge(repo.root, job).ok).toBe(true)
  })

  test('refuses an empty branch, a dirty worktree and uncommitted changes on main\'s checkout', () => {
    repo = scratchRepo()
    const job = jobWith(repo.root)
    expect(merge(repo.root, job).ok).toBe(false)
    commitIn(job.git!.worktree, 'greet.js', 'x\n')
    writeFileSync(join(job.git!.worktree, 'stray.txt'), 'x')
    expect(merge(repo.root, job).ok).toBe(false)
    git(job.git!.worktree, ['clean', '-fq'])
    writeFileSync(join(repo.root, 'README.md'), 'edited, not committed\n')
    const dirty = merge(repo.root, job)
    expect(dirty.ok).toBe(false)
    if (!dirty.ok) expect(dirty.why).toContain('uncommitted')
  })

  test('merges when main is checked out nowhere, without touching any checkout', () => {
    repo = scratchRepo()
    git(repo.root, ['checkout', '-q', '-b', 'elsewhere'])
    const job = jobWith(repo.root)
    commitIn(job.git!.worktree, 'greet.js', 'export const greet = () => "built"\n')
    const merged = merge(repo.root, job)
    expect(merged.ok).toBe(true)
    expect(git(repo.root, ['rev-parse', '--abbrev-ref', 'HEAD']).out).toBe('elsewhere')
    expect(isMerged(repo.root, job)).toBe(true)
  })
})
