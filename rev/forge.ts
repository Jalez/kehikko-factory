import { readTrackerRef, spellTrackerRef } from 'kehikot-module-protocol'

import { runCli, type Remote, type Run as CliRun } from '../tracker.ts'

/**
 * Which change a person means, and what its forge says about it — read with the person's own `gh`
 * or `glab`, on their behalf, as reads only. Nothing here posts, comments or approves: the draft
 * goes to Review, and only the person (or the switch they turned on) sends it.
 */

export interface Target {
  forge: 'github' | 'gitlab'
  repo: string
  number: number
  /** A GitLab host other than gitlab.com. */
  host?: string
}

const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/
const GITLAB_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/

export const NOT_A_CHANGE =
  'Factory reviews a pull or merge request. Open one (a draft is fine) and run /review-factory with its URL, or select it on the canvas.'

export type Located = { ok: true; target: Target } | { ok: false; why: string }

/** A change as people write it: its URL, owner/repo#12, group/project!12, gh#12, !12, or #12 in the project's repository. */
export function locate(said: string, origin: Remote | null): Located {
  const text = said.trim()
  if (!text) return { ok: false, why: `Name the change. ${NOT_A_CHANGE}` }
  let m = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})\/pull\/(\d{1,9})(?:\/[a-z]*)?\/?(?:[?#].*)?$/.exec(text)
  if (m) return { ok: true, target: { forge: 'github', repo: m[1]!, number: Number(m[2]) } }
  m = /^https:\/\/([A-Za-z0-9.-]+)\/([A-Za-z0-9._/-]+?)\/-\/merge_requests\/(\d{1,9})(?:\/[a-z]*)?\/?(?:[?#].*)?$/.exec(text)
  if (m && GITLAB_PATH.test(m[2]!)) return { ok: true, target: { forge: 'gitlab', repo: m[2]!, number: Number(m[3]), ...(m[1] !== 'gitlab.com' ? { host: m[1]! } : {}) } }
  if (/\/issues\/\d+/.test(text)) return { ok: false, why: `${text.slice(0, 120)} is an issue, not a change. ${NOT_A_CHANGE}` }
  m = /^([A-Za-z0-9._/-]+)([#!])(\d{1,9})$/.exec(text)
  if (m && m[1]!.includes('/') && !/^g[hl]:/.test(text)) {
    const repo = m[1]!
    if (m[2] === '!') return GITLAB_PATH.test(repo) ? { ok: true, target: { forge: 'gitlab', repo, number: Number(m[3]), ...(origin?.kind === 'gitlab' && origin.host !== 'gitlab.com' ? { host: origin.host } : {}) } } : { ok: false, why: `"${repo}" is not a repository.` }
    if (origin?.kind === 'gitlab') return { ok: false, why: `${text} is a GitLab issue, not a merge request. ${NOT_A_CHANGE}` }
    return GITHUB_REPO.test(repo) ? { ok: true, target: { forge: 'github', repo, number: Number(m[3]) } } : { ok: false, why: `"${repo}" is not a repository.` }
  }
  const ref = readTrackerRef(text.replace(/^#(\d+)$/, origin?.kind === 'github' ? 'gh#$1' : '#$1'))
  if (ref) {
    if (ref.kind === 'issue') return { ok: false, why: `${text} is an issue, not a change. ${NOT_A_CHANGE}` }
    const repo = ref.repo ?? (origin && origin.kind === ref.tracker ? origin.repo : null)
    if (!repo) return { ok: false, why: `${text} names no repository, and this project's origin is not on ${ref.tracker === 'github' ? 'GitHub' : 'GitLab'}.` }
    const host = ref.tracker === 'gitlab' && origin?.kind === 'gitlab' && origin.host !== 'gitlab.com' ? { host: origin.host } : {}
    return { ok: true, target: { forge: ref.tracker, repo, number: ref.number, ...host } }
  }
  return { ok: false, why: `"${text.slice(0, 120)}" is not a pull or merge request. ${NOT_A_CHANGE}` }
}

/** The change as the host spells refs: short in the project's own repository, qualified otherwise. */
export function spellRef(target: Target, origin: Remote | null): string {
  return spellTrackerRef({ tracker: target.forge, repo: target.repo, kind: 'change', number: target.number, isDefault: !!origin && origin.kind === target.forge && origin.repo === target.repo })
}

/** Every spelling a person or a module may have used for this change. */
export function spellingsOf(target: Target, origin: Remote | null): string[] {
  const own = !!origin && origin.kind === target.forge && origin.repo === target.repo
  if (target.forge === 'github') return [...(own ? [`gh#${target.number}`] : []), `gh:${target.repo}#${target.number}`, `${target.repo}#${target.number}`]
  return [...(own ? [`!${target.number}`, `gl!${target.number}`] : []), `gl:${target.repo}!${target.number}`, `${target.repo}!${target.number}`]
}

export function urlOf(target: Target): string {
  return target.forge === 'github'
    ? `https://github.com/${target.repo}/pull/${target.number}`
    : `https://${target.host ?? 'gitlab.com'}/${target.repo}/-/merge_requests/${target.number}`
}

export interface Meta {
  title: string
  body: string
  author: { login: string; name?: string } | null
  /** The branch it merges into. */
  base: string
  head: string
  labels: string[]
  commits: { sha: string; title: string }[]
  linked: string[]
  comments: { author: string; body: string; at: string }[]
  state: string
  draft: boolean
}

export type MetaRead = { ok: true; meta: Meta } | { ok: false; why: string }

function json(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const str = (value: unknown, max = 20_000): string => (typeof value === 'string' ? value.slice(0, max) : '')
const firstLine = (text: string) => text.split('\n')[0]?.slice(0, 200) ?? ''

const GITHUB_FIELDS = 'number,title,body,author,baseRefName,headRefOid,labels,commits,closingIssuesReferences,comments,state,isDraft'

export function readMeta(root: string, target: Target, run: CliRun = runCli): MetaRead {
  if (target.forge === 'github') {
    const ran = run('gh', ['pr', 'view', String(target.number), '--repo', target.repo, '--json', GITHUB_FIELDS], root)
    if (!ran.ok) return { ok: false, why: `gh could not read ${target.repo}#${target.number}: ${firstLine(ran.err) || 'no answer'}. ${/Could not resolve|not found/i.test(ran.err) ? NOT_A_CHANGE : ''}`.trim() }
    const pr = json(ran.out) as Record<string, unknown> | null
    if (!pr || typeof pr.headRefOid !== 'string') return { ok: false, why: `gh answered something that is not a pull request for ${target.repo}#${target.number}.` }
    const author = pr.author as { login?: unknown; name?: unknown } | null
    return {
      ok: true,
      meta: {
        title: str(pr.title, 300),
        body: str(pr.body),
        author: author && typeof author.login === 'string' ? { login: author.login, ...(typeof author.name === 'string' && author.name ? { name: author.name } : {}) } : null,
        base: str(pr.baseRefName, 300),
        head: pr.headRefOid,
        labels: (Array.isArray(pr.labels) ? pr.labels : []).map((one) => str((one as { name?: unknown }).name, 100)).filter(Boolean),
        commits: (Array.isArray(pr.commits) ? pr.commits : []).map((one) => {
          const c = one as { oid?: unknown; messageHeadline?: unknown }
          return { sha: str(c.oid, 64), title: str(c.messageHeadline, 200) }
        }),
        linked: (Array.isArray(pr.closingIssuesReferences) ? pr.closingIssuesReferences : []).map((one) => {
          const issue = one as { number?: unknown; repository?: { nameWithOwner?: unknown } }
          return `${str(issue.repository?.nameWithOwner, 200) || target.repo}#${String(issue.number ?? '')}`
        }),
        comments: (Array.isArray(pr.comments) ? pr.comments : []).map((one) => {
          const c = one as { author?: { login?: unknown }; body?: unknown; createdAt?: unknown }
          return { author: str(c.author?.login, 100), body: str(c.body, 4000), at: str(c.createdAt, 40) }
        }),
        state: str(pr.state, 20).toLowerCase(),
        draft: pr.isDraft === true,
      },
    }
  }
  const path = `projects/${encodeURIComponent(target.repo)}/merge_requests/${target.number}`
  const host = target.host ? ['--hostname', target.host] : []
  const ran = run('glab', ['api', ...host, path], root)
  if (!ran.ok) return { ok: false, why: `glab could not read ${target.repo}!${target.number}: ${firstLine(ran.err) || 'no answer'}.` }
  const mr = json(ran.out) as Record<string, unknown> | null
  if (!mr || typeof mr.sha !== 'string') return { ok: false, why: `glab answered something that is not a merge request for ${target.repo}!${target.number}.` }
  const commits = run('glab', ['api', ...host, `${path}/commits?per_page=100`], root)
  const notes = run('glab', ['api', ...host, `${path}/notes?per_page=100&sort=asc`], root)
  const author = mr.author as { username?: unknown; name?: unknown } | null
  return {
    ok: true,
    meta: {
      title: str(mr.title, 300),
      body: str(mr.description),
      author: author && typeof author.username === 'string' ? { login: author.username, ...(typeof author.name === 'string' && author.name ? { name: author.name } : {}) } : null,
      base: str(mr.target_branch, 300),
      head: mr.sha,
      labels: (Array.isArray(mr.labels) ? mr.labels : []).map((one) => str(one, 100)).filter(Boolean),
      commits: ((commits.ok ? json(commits.out) : null) as { id?: unknown; title?: unknown }[] | null ?? []).map((c) => ({ sha: str(c.id, 64), title: str(c.title, 200) })),
      linked: [],
      comments: ((notes.ok ? json(notes.out) : null) as { author?: { username?: unknown }; body?: unknown; created_at?: unknown; system?: unknown }[] | null ?? [])
        .filter((n) => n.system !== true)
        .map((n) => ({ author: str(n.author?.username, 100), body: str(n.body, 4000), at: str(n.created_at, 40) })),
      state: str(mr.state, 20).toLowerCase(),
      draft: mr.draft === true || mr.work_in_progress === true,
    },
  }
}
