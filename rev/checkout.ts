import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { git } from '../git.ts'
import type { Remote } from '../tracker.ts'
import type { Target } from './forge.ts'

/**
 * The code a review reads: the change's head, fetched from the project's origin into refs of this
 * run's own (`refs/factory-review/<id>/…`), and checked out detached in a worktree of its own
 * beside the project (`../<repo>-factory/review-<id>/`), so reviewers can read files beyond the
 * diff at exactly the head reviewed. The person's project folder is never switched, and nothing is
 * committed. The worktree and the refs go when the run is done.
 */

export const reviewWorktree = (root: string, id: string): string => join(dirname(root), `${basename(root)}-factory`, `review-${id}`)

const refBase = (id: string) => `refs/factory-review/${id}`

export interface Checked {
  head: string
  base: string
  mergeBase: string
  path: string
  /** The whole change's diff, merge base to head, in the line frame Review anchors comments in. */
  diff: string
  /** Since the previous review's head, when that commit is still here. */
  delta: string | null
}

export type CheckedOut = { ok: true; value: Checked } | { ok: false; why: string }

const line = (text: string) => text.split('\n')[0]?.slice(0, 300) ?? ''

const DIFF = ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '-M']

export function checkout(root: string, id: string, target: Target, base: string, remote: Remote | null, previousHead: string | null = null): CheckedOut {
  if (!remote || remote.kind !== target.forge || remote.repo !== target.repo) {
    return { ok: false, why: `This change is in ${target.repo}, and this project's origin is ${remote ? remote.repo : 'not on GitHub or GitLab'}. Factory reviews changes to the project it is in.` }
  }
  const head = target.forge === 'github' ? `refs/pull/${target.number}/head` : `refs/merge-requests/${target.number}/head`
  const fetched = git(root, ['fetch', '--no-tags', '--quiet', 'origin', `+${head}:${refBase(id)}/head`, `+refs/heads/${base}:${refBase(id)}/base`])
  if (!fetched.ok) return { ok: false, why: `git could not fetch the change from origin: ${line(fetched.err)}` }
  const headSha = git(root, ['rev-parse', `${refBase(id)}/head`])
  const baseSha = git(root, ['rev-parse', `${refBase(id)}/base`])
  if (!headSha.ok || !baseSha.ok) return { ok: false, why: 'The fetched change could not be read back.' }
  const merged = git(root, ['merge-base', baseSha.out, headSha.out])
  const mergeBase = merged.ok ? merged.out : baseSha.out
  const path = reviewWorktree(root, id)
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    const made = git(root, ['worktree', 'add', '--detach', '--quiet', path, headSha.out])
    if (!made.ok) return { ok: false, why: `git worktree add failed: ${line(made.err)}` }
  }
  const diff = git(root, [...DIFF, mergeBase, headSha.out])
  if (!diff.ok) return { ok: false, why: `git diff failed: ${line(diff.err)}` }
  let delta: string | null = null
  if (previousHead && previousHead !== headSha.out && git(root, ['cat-file', '-e', `${previousHead}^{commit}`]).ok) {
    const since = git(root, [...DIFF, previousHead, headSha.out])
    if (since.ok) delta = `${since.out}\n`
  }
  return { ok: true, value: { head: headSha.out, base: baseSha.out, mergeBase, path, diff: `${diff.out}\n`, delta } }
}

/** The run's worktree and refs, gone. Says what was left, if anything. */
export function removeCheckout(root: string, id: string, path: string | null): string | null {
  const left: string[] = []
  if (path && existsSync(path)) {
    const removed = git(root, ['worktree', 'remove', '--force', path])
    if (!removed.ok) left.push(`the checkout at ${path} could not be removed: ${line(removed.err)}`)
  }
  git(root, ['worktree', 'prune'])
  for (const name of ['head', 'base']) git(root, ['update-ref', '-d', `${refBase(id)}/${name}`])
  return left.length ? left.join('; ') : null
}
