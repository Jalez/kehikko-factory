import { spawnSync } from 'node:child_process'

import { git } from './git.ts'
import type { GithubIds } from './job/board.ts'

/**
 * What columns the project's own board has, found with the person's own CLI — `gh` for GitHub
 * Projects (v2), `glab` for GitLab issue boards — on their behalf, when they open the mapping in
 * the board's settings. Reads only: nothing here moves an issue or changes a board.
 *
 *  - **GitHub**: the projects the repository is linked to (`gh api graphql`, read), and for each
 *    its single-select fields with their options (`gh project field-list`); the one called Status
 *    first. A token without the `read:project` scope is said, with the command that adds it.
 *  - **GitLab**: the repository's issue boards (`glab api projects/:path/boards`); each list is a
 *    label, and that label is the column.
 */

export interface Ran {
  ok: boolean
  out: string
  err: string
}

export type Run = (command: 'gh' | 'glab', args: string[], cwd: string) => Ran

export const runCli: Run = (command, args, cwd) => {
  const done = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 30_000, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } })
  if (done.error) return { ok: false, out: '', err: (done.error as NodeJS.ErrnoException).code === 'ENOENT' ? `${command} is not installed.` : done.error.message }
  return { ok: done.status === 0, out: done.stdout ?? '', err: (done.stderr ?? '').trim() }
}

export type Remote = { kind: 'github'; repo: string } | { kind: 'gitlab'; repo: string; host: string }

/** The repository the project's `origin` points at, on GitHub or a GitLab, or null. */
export function remoteOf(root: string): Remote | null {
  const ran = git(root, ['remote', 'get-url', 'origin'])
  if (!ran.ok) return null
  return readRemote(ran.out)
}

export function readRemote(url: string): Remote | null {
  const m = /^(?:git@([^:]+):|(?:ssh:\/\/git@|https:\/\/)([^/]+)\/)(.+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!m) return null
  const host = (m[1] ?? m[2] ?? '').replace(/:\d+$/, '')
  const repo = m[3]!
  if (host === 'github.com') return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repo) ? { kind: 'github', repo } : null
  if (host.includes('gitlab') && /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(repo)) return { kind: 'gitlab', repo, host }
  return null
}

export interface Board {
  board: string
  boardUrl?: string
  columns: string[]
}

export type Found = { ok: true; kind: 'github' | 'gitlab'; repo: string; boards: Board[] } | { ok: false; why: string }

const LINKED = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){projectsV2(first:20){nodes{id number title url owner{... on User{login} ... on Organization{login}}}}}}`

const said = (ran: Ran, what: string): string => {
  if (/read:project|scopes/i.test(ran.err)) return `${what}: your gh token cannot read projects. Run \`gh auth refresh -s project\` in a terminal, then look again.`
  return `${what}: ${ran.err.split('\n')[0]?.slice(0, 200) || 'no answer'}`
}

function json(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

interface Linked {
  id: string
  number: number
  title: string
  url?: string
  owner: string
}

function linkedProjects(root: string, repo: string, run: Run): Linked[] | string {
  const [owner, name] = repo.split('/') as [string, string]
  const ran = run('gh', ['api', 'graphql', '-f', `query=${LINKED}`, '-f', `owner=${owner}`, '-f', `name=${name}`], root)
  if (!ran.ok) return said(ran, 'gh could not list the projects')
  const nodes = ((json(ran.out) as { data?: { repository?: { projectsV2?: { nodes?: unknown[] } } } } | null)?.data?.repository?.projectsV2?.nodes ?? []) as {
    id?: unknown
    number?: unknown
    title?: unknown
    url?: unknown
    owner?: { login?: unknown }
  }[]
  return nodes.flatMap((node) =>
    typeof node.id === 'string' && typeof node.number === 'number' && typeof node.owner?.login === 'string'
      ? [{ id: node.id, number: node.number, title: typeof node.title === 'string' ? node.title : `#${node.number}`, ...(typeof node.url === 'string' ? { url: node.url } : {}), owner: node.owner.login }]
      : [],
  )
}

interface StatusField {
  id: string
  options: { id: string; name: string }[]
}

/** The project's Status field (or its first single-select field), with its options. */
function statusField(root: string, project: Linked, run: Run): StatusField | null | string {
  const ran = run('gh', ['project', 'field-list', String(project.number), '--owner', project.owner, '--format', 'json'], root)
  if (!ran.ok) return said(ran, `gh could not read the fields of "${project.title}"`)
  const listed = ((json(ran.out) as { fields?: unknown[] } | null)?.fields ?? []) as { id?: unknown; name?: unknown; type?: unknown; options?: { id?: unknown; name?: unknown }[] }[]
  const single = listed.filter((field) => field.type === 'ProjectV2SingleSelectField' && typeof field.id === 'string' && Array.isArray(field.options))
  const field = single.find((one) => one.name === 'Status') ?? single[0]
  if (!field) return null
  return {
    id: field.id as string,
    options: (field.options ?? []).filter((o) => typeof o.id === 'string' && typeof o.name === 'string').map((o) => ({ id: o.id as string, name: o.name as string })),
  }
}

/** The boards and their columns, found with the person's CLI: the fallback when the host read none. */
export function discover(root: string, run: Run = runCli): Found {
  const remote = remoteOf(root)
  if (!remote) return { ok: false, why: 'The project\'s origin is not a GitHub or GitLab repository, so there is no board to map to. Jobs stay on the Factory board.' }

  if (remote.kind === 'gitlab') {
    const ran = run('glab', ['api', `projects/${encodeURIComponent(remote.repo)}/boards`], root)
    if (!ran.ok) return { ok: false, why: said(ran, 'glab could not read the boards') }
    const listed = json(ran.out)
    const boards: Board[] = []
    for (const one of Array.isArray(listed) ? (listed as { name?: unknown; lists?: { label?: { name?: unknown } }[] }[]) : []) {
      const columns = (one.lists ?? []).map((list) => list.label?.name).filter((name): name is string => typeof name === 'string' && !!name)
      boards.push({ board: typeof one.name === 'string' && one.name ? one.name : 'Development', columns })
    }
    return { ok: true, kind: 'gitlab', repo: remote.repo, boards }
  }

  const projects = linkedProjects(root, remote.repo, run)
  if (typeof projects === 'string') return { ok: false, why: projects }
  const boards: Board[] = []
  for (const project of projects) {
    const field = statusField(root, project, run)
    if (typeof field === 'string') return { ok: false, why: field }
    boards.push({ board: project.title, ...(project.url ? { boardUrl: project.url } : {}), columns: field?.options.map((o) => o.name) ?? [] })
  }
  return { ok: true, kind: 'github', repo: remote.repo, boards }
}

const ids = new Map<string, { at: number; value: GithubIds | string }>()
export const IDS_FOR_MS = 5 * 60 * 1000

/** What a GitHub move needs for the board called `board`, by name; a sentence when it cannot be found. Cached a few minutes. */
export function githubIds(root: string, repo: string, board: string, run: Run = runCli, now = Date.now()): GithubIds | string {
  const key = `${root}\u0000${repo}\u0000${board}`
  const kept = ids.get(key)
  if (kept && now - kept.at < IDS_FOR_MS) return kept.value
  const value = ((): GithubIds | string => {
    const projects = linkedProjects(root, repo, run)
    if (typeof projects === 'string') return projects
    const project = projects.find((one) => one.title === board)
    if (!project) return `${repo} is not on a project called "${board}" any more. Map the stages again in Factory's settings.`
    const field = statusField(root, project, run)
    if (typeof field === 'string') return field
    if (!field) return `"${board}" has no Status field to move an issue in.`
    return { owner: project.owner, number: project.number, projectId: project.id, fieldId: field.id, options: Object.fromEntries(field.options.map((o) => [o.name, o.id])) }
  })()
  ids.set(key, { at: now, value })
  return value
}

/** For tests. */
export function forgetIds(): void {
  ids.clear()
}
