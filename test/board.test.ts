import { describe, expect, test } from 'bun:test'

import { columnFor, guessColumns, moveFor, readIssue, sameIssue } from '../job/board.ts'
import { newJob } from '../job/flow.ts'
import { discover, forgetIds, githubIds, readRemote, type Run } from '../tracker.ts'
import { scratchRepo } from './repo.ts'
import { git } from '../git.ts'

const job = { ...newJob({ id: 'x-a1b2', title: 'X', feature: 'X', anglesAsked: null, place: null, session: 'session-1234', now: 'now' }), ref: 'jalez/app#7' }
const board = { kind: 'github' as const, repo: 'jalez/app', board: 'Roadmap', columns: { spec: 'Todo', build: 'In Progress', failed: null }, confirmed: true }

describe('mapping stages onto a board', () => {
  test('a stage maps to its column; an unmapped stage, "no column", or an unconfirmed mapping to none', () => {
    expect(columnFor(board, 'spec')).toBe('Todo')
    expect(columnFor(board, 'failed')).toBeNull()
    expect(columnFor(board, 'review')).toBeNull()
    expect(columnFor({ ...board, confirmed: false }, 'spec')).toBeNull()
    expect(columnFor(null, 'spec')).toBeNull()
  })

  test('a move needs an issue, a confirmed mapping, a column, and a column it is not already in', () => {
    const ids = { owner: 'jalez', number: 3, projectId: 'P', fieldId: 'F', options: { Todo: 'o1' } }
    expect(moveFor(job, board, ids)?.kind).toBe('move')
    expect(moveFor({ ...job, ref: null }, board, ids)).toBeNull()
    expect(moveFor(job, null, ids)).toBeNull()
    expect(moveFor({ ...job, column: 'Todo' }, board, ids)).toBeNull()
    expect(moveFor({ ...job, stage: 'failed' }, board, ids)).toBeNull()
    expect(moveFor(job, board, 'no scope')).toEqual({ kind: 'blocked', job: 'x-a1b2', ref: 'jalez/app#7', column: 'Todo', why: 'no scope' })
  })

  test('the guess fits column names, and leaves Failed without one', () => {
    expect(guessColumns(['Backlog', 'Todo', 'In Progress', 'In Review', 'Done'])).toEqual({
      spec: 'Todo', plan: 'Todo', build: 'In Progress', review: 'In Review', judge: 'In Review', waiting: 'In Review', merged: 'Done', failed: null,
    })
  })

  test('issues are read from a URL, owner/repo#n, or a number in the project\'s repo', () => {
    expect(readIssue('https://github.com/jalez/app/issues/12', null)).toEqual({ kind: 'github', repo: 'jalez/app', number: 12 })
    expect(readIssue('#12', { kind: 'github', repo: 'jalez/app' })).toEqual({ kind: 'github', repo: 'jalez/app', number: 12 })
    expect(readIssue('https://gitlab.com/group/sub/app/-/issues/3', null)).toEqual({ kind: 'gitlab', repo: 'group/sub/app', number: 3 })
    expect(readIssue('nonsense', null)).toBeNull()
    expect(readIssue('12', null)).toBeNull()
  })

  test('a ref another module spells differently names the same issue', () => {
    const repo = { kind: 'github' as const, repo: 'jalez/app' }
    for (const said of ['jalez/app#7', 'https://github.com/jalez/app/issues/7', '#7', 'gh#7', 'Jalez/App#7']) expect(sameIssue(said, 'jalez/app#7', repo)).toBe(true)
    expect(sameIssue('#8', 'jalez/app#7', repo)).toBe(false)
    expect(sameIssue('other/app#7', 'jalez/app#7', repo)).toBe(false)
  })
})

describe('finding the boards with the person\'s CLI', () => {
  test('a remote is GitHub or GitLab, or nothing', () => {
    expect(readRemote('git@github.com:Jalez/kehikko.git')).toEqual({ kind: 'github', repo: 'Jalez/kehikko' })
    expect(readRemote('https://gitlab.com/group/app.git')).toEqual({ kind: 'gitlab', repo: 'group/app', host: 'gitlab.com' })
    expect(readRemote('/some/local/path')).toBeNull()
  })

  test('GitHub: the projects the repo is on, with their Status options; ids looked up by name', () => {
    const repo = scratchRepo()
    try {
      git(repo.root, ['remote', 'add', 'origin', 'git@github.com:jalez/app.git'])
      const asked: string[][] = []
      const run: Run = (command, args) => {
        asked.push([command, ...args])
        if (args[0] === 'api') return { ok: true, err: '', out: JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_1', number: 3, title: 'Roadmap', url: 'https://github.com/users/jalez/projects/3', owner: { login: 'jalez' } }] } } } }) }
        return { ok: true, err: '', out: JSON.stringify({ fields: [{ id: 'F_T', name: 'Title', type: 'ProjectV2Field' }, { id: 'F_S', name: 'Status', type: 'ProjectV2SingleSelectField', options: [{ id: 'o1', name: 'Todo' }, { id: 'o2', name: 'Done' }] }] }) }
      }
      expect(discover(repo.root, run)).toEqual({ ok: true, kind: 'github', repo: 'jalez/app', boards: [{ board: 'Roadmap', boardUrl: 'https://github.com/users/jalez/projects/3', columns: ['Todo', 'Done'] }] })
      expect(asked.every(([command, sub]) => command === 'gh' && (sub === 'api' || sub === 'project'))).toBe(true)
      forgetIds()
      expect(githubIds(repo.root, 'jalez/app', 'Roadmap', run)).toEqual({ owner: 'jalez', number: 3, projectId: 'PVT_1', fieldId: 'F_S', options: { Todo: 'o1', Done: 'o2' } })
      forgetIds()
      expect(typeof githubIds(repo.root, 'jalez/app', 'Gone', run)).toBe('string')
    } finally {
      repo.done()
    }
  })

  test('a token without the project scope is said, with what to run', () => {
    const repo = scratchRepo()
    try {
      git(repo.root, ['remote', 'add', 'origin', 'https://github.com/jalez/app.git'])
      const found = discover(repo.root, () => ({ ok: false, out: '', err: 'error: your authentication token is missing required scopes [read:project]' }))
      expect(found.ok).toBe(false)
      if (!found.ok) expect(found.why).toContain('gh auth refresh -s project')
    } finally {
      repo.done()
    }
  })

  test('GitLab: each board\'s lists are its columns', () => {
    const repo = scratchRepo()
    try {
      git(repo.root, ['remote', 'add', 'origin', 'git@gitlab.com:group/app.git'])
      const found = discover(repo.root, () => ({ ok: true, err: '', out: JSON.stringify([{ name: 'Dev', lists: [{ label: { name: 'Doing' } }, { label: { name: 'Review' } }] }]) }))
      expect(found).toEqual({ ok: true, kind: 'gitlab', repo: 'group/app', boards: [{ board: 'Dev', columns: ['Doing', 'Review'] }] })
    } finally {
      repo.done()
    }
  })
})
