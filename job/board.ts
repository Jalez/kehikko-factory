import { z } from 'zod'

import type { Job, Stage } from './shape.ts'

/**
 * The project's own kanban board, and where each Factory stage sits on it.
 *
 * Factory has its stages (spec, plan, build, review, judge, waiting for you, merged, failed); a
 * project has its board — a GitHub Project (v2) with a Status field, or a GitLab issue board whose
 * lists are labels. The person maps one onto the other, per project, in the board's settings
 * (`.kehikot/factory/settings.json`), choosing from the boards and columns the host read
 * (`tracker.columns`, protocol 2.6.0) or, when the host has none, from what the person's own
 * `gh`/`glab` finds. The mapping is by NAME: the board's title and each column's name, as the host's
 * tracker reading says them, so Journeys and Flows (which read the issue's column from the host) and
 * this module agree. A stage may map to no column: then its issue is not moved. A guess is offered
 * for the person to confirm; nothing moves until they have.
 *
 * When a job's stage changes, the conversation running `/factory` moves the job's issue with the
 * person's own CLI (`gh project item-add` / `item-edit`, or `glab issue update`): `moveFor` says
 * which move and the exact commands, and nothing here runs them. For GitHub a move needs ids
 * (project, field, option), which the server looks up by name with `gh` (`tracker.ts`).
 */

/** The stages as the board maps them: counter-arguments sit with the judge. */
export const BOARD_STAGES = ['spec', 'plan', 'build', 'review', 'judge', 'waiting', 'merged', 'failed'] as const
export type BoardStage = (typeof BOARD_STAGES)[number]

export const boardStageOf = (stage: Stage): BoardStage => (stage === 'counter' ? 'judge' : stage)

const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/
const GITLAB_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/
const NAME = z.string().min(1).max(200)

export const boardSchema = z.object({
  kind: z.enum(['github', 'gitlab']),
  /** The repository the issues are in: `owner/repo`, or a GitLab `group/project`. */
  repo: z.string().max(300),
  /** The board's title, as `tracker.columns` names it. */
  board: NAME,
  boardUrl: z.string().max(2000).optional(),
  /** Each stage's column by name; `null` (or absent) is "no column": the issue is not moved for it. */
  columns: z.record(z.enum(BOARD_STAGES), NAME.nullable()),
  /** Whether the person confirmed the mapping. A guess is never applied. */
  confirmed: z.boolean(),
}).refine((board) => (board.kind === 'github' ? GITHUB_REPO : GITLAB_PATH).test(board.repo), { message: 'not a repository of that kind', path: ['repo'] })
export type BoardMap = z.infer<typeof boardSchema>

/** The column a job's stage maps to, by name, or null (no mapping, unconfirmed, or "no column"). */
export function columnFor(board: BoardMap | null | undefined, stage: Stage): string | null {
  if (!board?.confirmed) return null
  return board.columns[boardStageOf(stage)] ?? null
}

/* ------------------------------------------------------------------ *
 * Issues
 * ------------------------------------------------------------------ */

export interface Issue {
  kind: 'github' | 'gitlab'
  repo: string
  number: number
}

/** A ref as people write it — a URL, `owner/repo#12`, or `#12` / `12` in the project's repo — or null. */
export function readIssue(said: string, defaultRepo: { kind: 'github' | 'gitlab'; repo: string } | null): Issue | null {
  const text = said.trim()
  let m = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})\/issues\/(\d{1,9})\/?$/.exec(text)
  if (m) return { kind: 'github', repo: m[1]!, number: Number(m[2]) }
  m = /^https:\/\/[A-Za-z0-9.-]*gitlab[A-Za-z0-9.-]*\/([A-Za-z0-9._/-]+?)\/-\/issues\/(\d{1,9})\/?$/.exec(text)
  if (m && GITLAB_PATH.test(m[1]!)) return { kind: 'gitlab', repo: m[1]!, number: Number(m[2]) }
  m = /^([A-Za-z0-9._/-]+)#(\d{1,9})$/.exec(text)
  if (m) {
    const repo = m[1]!
    const kind = defaultRepo?.kind ?? (GITHUB_REPO.test(repo) ? 'github' : 'gitlab')
    if (!(kind === 'github' ? GITHUB_REPO : GITLAB_PATH).test(repo)) return null
    return { kind, repo, number: Number(m[2]) }
  }
  m = /^#?(\d{1,9})$/.exec(text)
  if (m && defaultRepo) return { ...defaultRepo, number: Number(m[1]) }
  return null
}

/**
 * Whether a ref as another module spells it (a URL, `owner/repo#12`, `#12`, `gh#12`, `gl#12`) names
 * the same issue as a job's ref. Short spellings are read in the project's own repository.
 */
export function sameIssue(said: string, jobRef: string, projectRepo: { kind: 'github' | 'gitlab'; repo: string } | null): boolean {
  const mine = readIssue(jobRef, projectRepo)
  const theirs = readIssue(said.trim().replace(/^(gh|gl|github|gitlab)#/i, '#'), projectRepo)
  return !!mine && !!theirs && mine.kind === theirs.kind && mine.repo.toLowerCase() === theirs.repo.toLowerCase() && mine.number === theirs.number
}

/** How a ref is written in job.json and shown to other modules: `owner/repo#12`. */
export const refOf = (issue: Issue): string => `${issue.repo}#${issue.number}`

export function issueUrl(issue: Issue, gitlabHost = 'gitlab.com'): string {
  return issue.kind === 'github' ? `https://github.com/${issue.repo}/issues/${issue.number}` : `https://${gitlabHost}/${issue.repo}/-/issues/${issue.number}`
}

/** No quote, dollar, backtick, backslash or line break: words that can stand inside double quotes in a shell command. */
export const shellSafe = (text: string, max = 200): string => text.replace(/["$`\\\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/* ------------------------------------------------------------------ *
 * Moves
 * ------------------------------------------------------------------ */

/** The ids a GitHub move needs, looked up by name with the person's `gh`. */
export interface GithubIds {
  owner: string
  number: number
  projectId: string
  fieldId: string
  /** Option id by column name. */
  options: Record<string, string>
}

export interface Move {
  job: string
  ref: string
  column: string
  /** The commands, in order. The second GitHub one needs the id the first printed (`ITEM_ID`). */
  commands: string[]
}

export type Moving = { kind: 'move'; move: Move } | { kind: 'blocked'; job: string; ref: string; column: string; why: string }

/**
 * The move a job needs now, or null: when it has an issue, the mapping is confirmed, its stage maps
 * to a column, and that column is not where the issue was last moved. "No column" moves nothing.
 * A GitHub move whose ids could not be found is `blocked`, with why.
 */
export function moveFor(job: Job, board: BoardMap | null | undefined, github: GithubIds | string | null = null): Moving | null {
  if (!job.ref || !board?.confirmed) return null
  const column = columnFor(board, job.stage)
  if (!column || job.column === column || job.moveFailed === column) return null
  const issue = readIssue(job.ref, { kind: board.kind, repo: board.repo })
  if (!issue || issue.kind !== board.kind) return null
  const blocked = (why: string): Moving => ({ kind: 'blocked', job: job.id, ref: job.ref!, column, why })
  if (board.kind === 'github') {
    if (!github || typeof github === 'string') return blocked(github || `The ids of "${board.board}" could not be looked up with gh.`)
    const option = github.options[column]
    if (!option) return blocked(`"${board.board}" has no column called "${column}" any more. Map the stages again in Factory's settings.`)
    return {
      kind: 'move',
      move: {
        job: job.id,
        ref: job.ref,
        column,
        commands: [
          `gh project item-add ${github.number} --owner ${github.owner} --url ${issueUrl(issue)} --format json --jq .id`,
          `gh project item-edit --id ITEM_ID --project-id ${github.projectId} --field-id ${github.fieldId} --single-select-option-id ${option}`,
        ],
      },
    }
  }
  const others = [...new Set(Object.values(board.columns).filter((one): one is string => !!one && one !== column).map((one) => shellSafe(one)))]
  return {
    kind: 'move',
    move: {
      job: job.id,
      ref: job.ref,
      column,
      commands: [`glab issue update ${issue.number} --repo ${issue.repo} --label "${shellSafe(column)}"${others.length ? ` --unlabel "${others.join(',')}"` : ''}`],
    },
  }
}

/** The MOVE lines of an answer to the conversation, or nothing. */
export function moveText(movings: readonly Moving[], reportFailed: (job: string) => string): string[] {
  if (!movings.length) return []
  const out = ['', 'MOVE first: the project\'s own board follows the jobs. Run these with the Bash tool, exactly as written, one at a time:']
  for (const moving of movings) {
    if (moving.kind === 'blocked') {
      out.push('', `- ${moving.ref} (job ${moving.job}) should go to "${moving.column}", but cannot: ${moving.why} Tell the person this in one line.`)
      continue
    }
    const { move } = moving
    out.push('', `- ${move.ref} (job ${move.job}) to "${move.column}":`)
    for (const command of move.commands) out.push(`  ${command}`)
    if (move.commands.some((command) => command.includes('ITEM_ID'))) out.push('  (put the id the first command printed where the second says ITEM_ID)')
    out.push(`  If a command fails, tell the person in one line, then run: ${reportFailed(move.job)}`)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * A guess, for the person to confirm
 * ------------------------------------------------------------------ */

const WANTS: Record<BoardStage, RegExp[]> = {
  spec: [/^(todo|to do)$/i, /todo|backlog|ready|new/i],
  plan: [/^(todo|to do)$/i, /todo|backlog|ready|new/i],
  build: [/^in progress$/i, /progress|doing|build|develop/i],
  review: [/^in review$/i, /review/i, /progress|doing/i],
  judge: [/^in review$/i, /review/i, /progress|doing/i],
  waiting: [/^in review$/i, /review|waiting|approval/i],
  merged: [/^done$/i, /done|closed|merged|complete/i],
  failed: [],
}

/** The mapping a person is shown first: each stage to the column whose name fits, or none. Never applied unconfirmed. */
export function guessColumns(columns: readonly string[]): Record<BoardStage, string | null> {
  const out = {} as Record<BoardStage, string | null>
  for (const stage of BOARD_STAGES) {
    let found: string | null = null
    for (const want of WANTS[stage]) {
      found = columns.find((one) => want.test(one)) ?? null
      if (found) break
    }
    out[stage] = found
  }
  return out
}
