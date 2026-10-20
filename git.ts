import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type { Job } from './job/shape.ts'

/**
 * The git a job needs, run as the person on their own repository: a worktree for the build, a merge
 * to main when somebody approves, and the worktree taken away once the merge is confirmed.
 *
 *  - **The worktree** is `../<repo>-factory/<job-id>/` beside the project, on `factory/<job-id>`,
 *    branched from main. Never inside the project's tree.
 *  - **A merge** goes to the project's main branch with a merge commit (`--no-ff`). Refused, and the
 *    job handed to the person, when: the branch has no commits; the job's worktree has uncommitted
 *    changes; main's checkout has uncommitted changes; or the merge conflicts (the usual cause: main
 *    moved since the build). A conflicting merge is aborted, so main is exactly as it was.
 *  - **Cleanup** happens only after the merge is confirmed (the branch's tip is in main), and only
 *    when the worktree holds nothing uncommitted. `git branch -d`, which itself refuses an unmerged
 *    branch.
 *
 * `node:child_process`, not `Bun.spawn`: the dev server runs under node (see run.sh).
 */

export interface Ran {
  ok: boolean
  code: number | null
  out: string
  err: string
}

export function git(cwd: string, args: string[]): Ran {
  const done = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 60_000 })
  return { ok: done.status === 0, code: done.status, out: (done.stdout ?? '').trim(), err: (done.stderr ?? '').trim() || (done.error?.message ?? '') }
}

const line = (text: string) => text.split('\n')[0]?.slice(0, 300) ?? ''

/** The top of the repository a folder is in, realpath'd, or null when it is in none. */
export function repoTop(dir: string): string | null {
  const ran = git(dir, ['rev-parse', '--show-toplevel'])
  if (!ran.ok || !ran.out) return null
  try {
    return realpathSync(ran.out)
  } catch {
    return null
  }
}

/** The main checkout of the repository a folder is in (not a linked worktree's), or null. */
export function mainCheckout(dir: string): string | null {
  const ran = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (!ran.ok || !ran.out) return null
  const common = ran.out
  const top = basename(common) === '.git' ? dirname(common) : null
  try {
    return top ? realpathSync(top) : repoTop(dir)
  } catch {
    return null
  }
}

const hasBranch = (root: string, branch: string) => git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).ok

/** The project's main branch: what origin's HEAD names, else `main`, else `master`. */
export function mainBranch(root: string): string | null {
  const remote = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (remote.ok && remote.out.startsWith('origin/')) {
    const name = remote.out.slice('origin/'.length)
    if (hasBranch(root, name)) return name
  }
  for (const name of ['main', 'master']) if (hasBranch(root, name)) return name
  return null
}

export const branchOf = (id: string) => `factory/${id}`

/** `../<repo>-factory/<job-id>/`, beside the project. */
export function worktreePath(root: string, id: string): string {
  return join(dirname(root), `${basename(root)}-factory`, id)
}

export type Worktree = NonNullable<Job['git']>

/** Make the job's worktree on its own branch from main. */
export function addWorktree(root: string, id: string): { ok: true; git: Worktree } | { ok: false; why: string } {
  const main = mainBranch(root)
  if (!main) return { ok: false, why: 'The project has no main (or master) branch with a commit on it, so there is nothing to branch from.' }
  const base = git(root, ['rev-parse', `refs/heads/${main}`])
  if (!base.ok) return { ok: false, why: `Could not read ${main}: ${line(base.err)}` }
  const path = worktreePath(root, id)
  const branch = branchOf(id)
  if (existsSync(path)) {
    /* A worktree this job already made (a conversation that stopped and came back) is used again. */
    const at = git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (at.ok && at.out === branch) return { ok: true, git: { main, base: base.out, branch, worktree: path, present: true } }
    return { ok: false, why: `${path} already exists and is not this job's worktree. Nothing was changed.` }
  }
  if (hasBranch(root, branch)) return { ok: false, why: `The branch ${branch} already exists. Nothing was changed.` }
  mkdirSync(dirname(path), { recursive: true })
  const made = git(root, ['worktree', 'add', '-b', branch, path, base.out])
  if (!made.ok) return { ok: false, why: `git worktree add failed: ${line(made.err)}` }
  return { ok: true, git: { main, base: base.out, branch, worktree: path, present: true } }
}

/** Where a branch is checked out, if anywhere. */
export function checkoutOf(root: string, branch: string): string | null {
  const ran = git(root, ['worktree', 'list', '--porcelain'])
  if (!ran.ok) return null
  let at: string | null = null
  for (const row of ran.out.split('\n')) {
    if (row.startsWith('worktree ')) at = row.slice('worktree '.length)
    else if (row === `branch refs/heads/${branch}` && at) return at
  }
  return null
}

const dirty = (dir: string, untracked: boolean) => {
  const ran = git(dir, ['status', '--porcelain', `--untracked-files=${untracked ? 'all' : 'no'}`])
  return !ran.ok || ran.out.length > 0
}

export type Merged = { ok: true; commit: string } | { ok: false; why: string }

/** Merge the job's branch into main with a merge commit, or say why not and leave main as it was. */
export function merge(root: string, job: Job): Merged {
  if (!job.git) return { ok: false, why: 'This job has no branch to merge.' }
  const { main, base, branch, worktree } = job.git
  const tip = git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  if (!tip.ok) return { ok: false, why: `The branch ${branch} is not there any more.` }
  if (tip.out === base) return { ok: false, why: `${branch} has no commits: the builder committed nothing.` }
  if (existsSync(worktree) && dirty(worktree, true)) return { ok: false, why: `The job's worktree (${worktree}) has uncommitted changes. Commit or discard them first.` }
  const mainTip = git(root, ['rev-parse', `refs/heads/${main}`])
  if (!mainTip.ok) return { ok: false, why: `Could not read ${main}: ${line(mainTip.err)}` }
  const moved = mainTip.out !== base
  const message = `Merge ${branch}: ${job.title}`
  const where = checkoutOf(root, main)

  if (where) {
    if (dirty(where, false)) return { ok: false, why: `${main} is checked out at ${where} with uncommitted changes. Commit or stash them, then approve again.` }
    const ran = git(where, ['merge', '--no-ff', '--no-edit', '-m', message, branch])
    if (!ran.ok) {
      const conflicts = git(where, ['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean)
      if (existsSync(join(where, '.git', 'MERGE_HEAD')) || git(where, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok) git(where, ['merge', '--abort'])
      return { ok: false, why: conflictSaid(main, moved, conflicts, ran.err) }
    }
  } else {
    const tree = git(root, ['merge-tree', '--write-tree', '--name-only', `refs/heads/${main}`, branch])
    if (!tree.ok) {
      /* The tree, then the conflicted files (one per line with --name-only), then a blank line and git's messages. */
      const rows = tree.out.split('\n')
      const blank = rows.indexOf('', 1)
      const conflicts = [...new Set(rows.slice(1, blank < 0 ? undefined : blank).filter(Boolean))]
      return { ok: false, why: conflictSaid(main, moved, conflicts, tree.err) }
    }
    const commit = git(root, ['commit-tree', tree.out.split('\n')[0]!, '-p', mainTip.out, '-p', tip.out, '-m', message])
    if (!commit.ok) return { ok: false, why: `git commit-tree failed: ${line(commit.err)}` }
    const moveRef = git(root, ['update-ref', `refs/heads/${main}`, commit.out, mainTip.out])
    if (!moveRef.ok) return { ok: false, why: `${main} moved while merging; nothing was changed. Approve again.` }
  }
  const now = git(root, ['rev-parse', `refs/heads/${main}`])
  return now.ok ? { ok: true, commit: now.out } : { ok: false, why: 'The merge ran but main could not be read back.' }
}

function conflictSaid(main: string, moved: boolean, conflicts: string[], err: string): string {
  const files = conflicts.length ? ` Conflicts in ${conflicts.slice(0, 6).join(', ')}${conflicts.length > 6 ? ` and ${conflicts.length - 6} more` : ''}.` : ` ${line(err)}`
  return `${moved ? `${main} moved since the build and the` : 'The'} merge conflicts, so nothing was merged and ${main} is as it was.${files}`
}

/** Whether the branch's tip is in main: what "the merge is confirmed" means here. */
export function isMerged(root: string, job: Job): boolean {
  if (!job.git) return false
  const tip = git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${job.git.branch}`])
  if (!tip.ok) return false
  return git(root, ['merge-base', '--is-ancestor', tip.out, `refs/heads/${job.git.main}`]).ok
}

/**
 * Take the job's worktree and branch away, ONLY after its merge is confirmed and only when the
 * worktree holds nothing uncommitted. Says what was left and why.
 */
export function cleanup(root: string, job: Job): { cleaned: boolean; left: string | null } {
  if (!job.git) return { cleaned: false, left: null }
  if (!isMerged(root, job)) return { cleaned: false, left: `${job.git.branch} is not in ${job.git.main}, so its worktree was kept.` }
  const { worktree, branch } = job.git
  if (existsSync(worktree)) {
    if (dirty(worktree, true)) return { cleaned: false, left: `${worktree} has uncommitted changes, so it was kept.` }
    const removed = git(root, ['worktree', 'remove', worktree])
    if (!removed.ok) return { cleaned: false, left: `git worktree remove failed: ${line(removed.err)}` }
  }
  const deleted = git(root, ['branch', '-d', branch])
  if (!deleted.ok) return { cleaned: true, left: `The worktree is gone; the branch ${branch} was kept: ${line(deleted.err)}` }
  return { cleaned: true, left: null }
}
