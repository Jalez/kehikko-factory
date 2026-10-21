import { readNeighbour } from 'kehikot-module-protocol/serve'

import type { Run, RunChecklist } from './shape.ts'

/**
 * The other modules a review writes into, through their own MCP doors — the same tools an agent
 * would call, so every rule those modules keep (Review's anchor check, Checklist's "an agent never
 * changes the person's tick") holds for Factory too:
 *
 *  - **Review** (C4): `add_comment` with `meta`, `propose_review`, `drop_run_comments`, and the
 *    Factory-only send (`POST /api/factory/send` with the key).
 *  - **Checklist** (C1): `checklists` to read what is held against the change, in its print
 *    (`[x]` passed, `[!]` failed, `[-]` n/a, `[ ]` unchecked); `create_checklist`,
 *    `add_checklist_item`, `hold_checklist` for an accepted proposal; `check_item` with `state`.
 *  - **Paper**: `propose_edit`, for a one-way change's briefing in an epic that has a paper.
 *
 * Found through the registry (`readNeighbour`), on loopback. Nothing here is an agent's door.
 */

export const REVIEW = 'kehikot.review'
export const CHECKLIST = 'kehikot.checklist'
export const FLOWS = 'kehikot.flows'
export const PAPER = 'kehikot.paper'

/** The name Factory signs its checklist answers with. */
export const AGENT_NAME = 'Factory review'

export interface Said {
  ok: boolean
  text: string
}

export interface Neighbours {
  /** Is it registered and answering here? */
  present(id: string): Promise<boolean>
  call(id: string, tool: string, args: Record<string, unknown>): Promise<Said>
  /** Review's Factory-only send. */
  send(body: { project: string; change: string; run: string }, key: string): Promise<{ status: number; text: string }>
}

const CALL_TIMEOUT_MS = 60_000

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), CALL_TIMEOUT_MS)
  try {
    return await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body), signal: control.signal })
  } finally {
    clearTimeout(timer)
  }
}

export const realNeighbours: Neighbours = {
  async present(id) {
    return (await readNeighbour(id)).found
  },
  async call(id, tool, args) {
    const found = await readNeighbour(id)
    if (!found.found) return { ok: false, text: found.sentence }
    if (!found.door) return { ok: false, text: `${id} has no MCP door Factory can reach.` }
    try {
      const response = await post(found.door, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })
      const body = (await response.json()) as { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } }
      if (body.error) return { ok: false, text: body.error.message ?? `${id} refused ${tool}.` }
      const text = (body.result?.content ?? []).map((one) => one.text ?? '').join('\n')
      return { ok: body.result?.isError !== true, text }
    } catch (e) {
      return { ok: false, text: `${id} did not answer ${tool}: ${e instanceof Error ? e.message : String(e)}` }
    }
  },
  async send(body, key) {
    const found = await readNeighbour(REVIEW)
    if (!found.found) return { status: 0, text: found.sentence }
    try {
      const response = await post(`${found.origin}/api/factory/send`, body, { 'X-Kehikot-Factory-Key': key })
      return { status: response.status, text: await response.text() }
    } catch (e) {
      return { status: 0, text: `Review did not answer the send: ${e instanceof Error ? e.message : String(e)}` }
    }
  },
}

/* ------------------------------------------------------------------ *
 * Checklist
 * ------------------------------------------------------------------ */

const MARK: Record<string, RunChecklist['items'][number]['state']> = { x: 'passed', '!': 'failed', '-': 'na', ' ': null }

/** One list, as `checklists` prints it for a target (C1). */
export function parseList(text: string): RunChecklist | null {
  const head = /^"(.*)" \(([^()\s]+)\)/.exec(text.split('\n')[0] ?? '')
  if (!head) return null
  const items: RunChecklist['items'] = []
  for (const line of text.split('\n')) {
    const m = /^\d+\. \[(.)\] (\S+) — (.*)$/.exec(line)
    if (!m) continue
    let rest = m[3]!
    let tick: { by: string; mcp: boolean; note?: string } | null = null
    const who = /  \((.+)\)$/.exec(rest)
    if (who && MARK[m[1]!] !== null) {
      rest = rest.slice(0, who.index)
      const inner = who[1]!.replace(/; ticked on ".*"$/, '')
      const parts = /^(.*?)(, over MCP)?(?:: (.*))?$/.exec(inner)!
      tick = { by: parts[1]!, mcp: !!parts[2], ...(parts[3] ? { note: parts[3] } : {}) }
    }
    rest = rest.replace(/  \[evidence: [^\]]*\]$/, '')
    items.push({
      id: m[2]!,
      text: rest,
      state: MARK[m[1]!] ?? null,
      byPerson: !!tick && !tick.mcp,
      ...(tick ? { by: tick.by } : {}),
      ...(tick?.note ? { note: tick.note } : {}),
    })
  }
  return { id: head[2]!, name: head[1]!, items }
}

/** The lists held against the change, with what is set for it. `spellings`: every way the change may have been named. */
export async function checklistsHeld(n: Neighbours, project: string, spellings: readonly string[]): Promise<{ lists: RunChecklist[]; ref: string | null; trouble: string | null }> {
  const all = await n.call(CHECKLIST, 'checklists', { project })
  if (!all.ok) return { lists: [], ref: null, trouble: all.text }
  const lists: RunChecklist[] = []
  let ref: string | null = null
  for (const line of all.text.split('\n')) {
    const m = /^ {2}(\S+) — ".*" \(.*held against (.*)\)$/.exec(line)
    if (!m) continue
    const held = m[2]!
    let named = spellings.find((one) => held.split(', ').includes(one)) ?? null
    if (!named && /^\d+ targets/.test(held)) {
      const whole = await n.call(CHECKLIST, 'checklists', { project, checklist: m[1]! })
      const tail = /\n\nHeld against: (.*)$/.exec(whole.text)?.[1] ?? ''
      named = spellings.find((one) => tail.includes(`${one} (`)) ?? null
    }
    if (!named) continue
    const one = await n.call(CHECKLIST, 'checklists', { project, checklist: m[1]!, ref: named })
    const list = one.ok ? parseList(one.text) : null
    if (list) {
      lists.push(list)
      ref = ref ?? named
    }
  }
  return { lists, ref, trouble: null }
}

/** A proposal the person accepted: a new list, its items, held against the change. */
export async function createChecklist(n: Neighbours, project: string, ref: string, name: string, items: readonly string[]): Promise<{ ok: true; list: RunChecklist } | { ok: false; why: string }> {
  const made = await n.call(CHECKLIST, 'create_checklist', { project, name, agent: AGENT_NAME })
  const id = made.ok ? /"[^"]*" \(([^()\s]+)\)/.exec(made.text)?.[1] : undefined
  if (!id) return { ok: false, why: `Checklist did not make the list: ${made.text.slice(0, 300)}` }
  for (const text of items) {
    const added = await n.call(CHECKLIST, 'add_checklist_item', { project, checklist: id, text, agent: AGENT_NAME })
    if (!added.ok) return { ok: false, why: `Checklist did not add "${text.slice(0, 80)}": ${added.text.slice(0, 300)}` }
  }
  const held = await n.call(CHECKLIST, 'hold_checklist', { project, checklist: id, ref, agent: AGENT_NAME })
  if (!held.ok) return { ok: false, why: `Checklist did not hold the list against ${ref}: ${held.text.slice(0, 300)}` }
  const read = await n.call(CHECKLIST, 'checklists', { project, checklist: id, ref })
  const list = read.ok ? parseList(read.text) : null
  return list ? { ok: true, list } : { ok: false, why: 'Checklist made the list, but it could not be read back.' }
}

const STATE_OF = { pass: 'passed', fail: 'failed', 'n/a': 'na' } as const

/**
 * The reviewers' answers set in Checklist, as Factory's. Only an unchecked item, or one Factory set
 * itself: never the person's (Checklist refuses that anyway), and not another agent's either. Where
 * the panel disagrees, that is said in a note on the card and in the record instead.
 */
export async function setStates(n: Neighbours, project: string, ref: string, run: Pick<Run, 'answers' | 'checklists'>): Promise<{ set: number; notes: string[] }> {
  const notes: string[] = []
  let set = 0
  for (const answer of run.answers) {
    const item = run.checklists.find((one) => one.id === answer.checklist)?.items.find((one) => one.id === answer.item)
    if (!item) continue
    const state = STATE_OF[answer.state]
    if (item.state !== null && item.by !== AGENT_NAME) {
      if (item.state !== state) notes.push(`${item.byPerson ? 'You' : item.by} marked "${item.text.slice(0, 80)}" ${item.state}; the ${answer.by} reviewer found it ${state}: ${answer.note}`)
      continue
    }
    const done = await n.call(CHECKLIST, 'check_item', { project, checklist: answer.checklist, item: answer.item, ref, state, note: `${answer.note} (${answer.by} reviewer)`.slice(0, 600), agent: AGENT_NAME })
    if (done.ok) set++
    else notes.push(`Checklist did not take the answer for "${item.text.slice(0, 80)}": ${done.text.slice(0, 200)}`)
  }
  return { set, notes }
}

/* ------------------------------------------------------------------ *
 * Review
 * ------------------------------------------------------------------ */

export type ReviewVerdict = 'approve' | 'comment' | 'request-changes'

/** What a kept point says on its line: plain words, the other places, the sources. */
export function commentBody(point: Run['points'][number], ruling: { ruling: string; reason: string }): string {
  const out = [`**${point.claim}** ${point.why}`, '', point.suggestion]
  if (point.also.length) out.push('', `Also at: ${point.also.map((one) => `${one.path}:${one.startLine ? `${one.startLine}-` : ''}${one.line}`).join(', ')}.`)
  if (point.evidence.length) out.push('', 'Sources:', ...point.evidence.map((one) => `- ${one.ref}${one.quote ? ` — "${one.quote.slice(0, 200)}"` : ''}`))
  out.push('', `_${ruling.ruling === 'required' ? 'Required' : 'Optional'}: ${ruling.reason}_`)
  return out.join('\n')
}

/** The summary proposed beside the person's: the judge's words, the vision, and the path to success. */
export function summaryOf(run: Pick<Run, 'judged' | 'vision' | 'plan'>): string {
  const judged = run.judged!
  const out = [judged.summary.trim()]
  if (judged.visionFit.trim()) out.push('', judged.visionFit.trim())
  else if (!run.vision?.epic) out.push('', 'This change is in no epic, so it was reviewed without a vision to weigh it against.')
  if (judged.verdict === 'close' && judged.close) out.push('', `Close this change: ${judged.close.why}`, `Instead: ${judged.close.instead}`)
  if (judged.pathToSuccess.length && judged.verdict !== 'approve') out.push('', 'To get this approved:', ...judged.pathToSuccess)
  else if (judged.verdict === 'approve') out.push('', 'Nothing blocks this change.')
  return out.join('\n').slice(0, 20_000)
}

export const reviewVerdict = (verdict: NonNullable<Run['judged']>['verdict']): ReviewVerdict => (verdict === 'close' ? 'request-changes' : verdict)

export interface Drafted {
  comments: number
  refused: { point: string; why: string }[]
  proposal: boolean
  notes: string[]
}

/**
 * The run's result as a draft in Review: earlier runs' unsent agent comments on this change dropped
 * (only those: never the person's, never a sent one — Review keeps that rule), one comment per
 * required or kept optional point with its `meta`, and the summary and verdict proposed beside the
 * person's, never over them.
 */
export async function draftToReview(n: Neighbours, project: string, run: Run, earlier: readonly string[]): Promise<Drafted> {
  const change = run.change.url
  const notes: string[] = []
  for (const id of earlier) {
    const dropped = await n.call(REVIEW, 'drop_run_comments', { project, change, run: id })
    if (!dropped.ok) notes.push(`Review did not drop the unsent comments of ${id}: ${dropped.text.slice(0, 200)}`)
  }
  const judged = run.judged!
  const refused: Drafted['refused'] = []
  let comments = 0
  for (const point of run.points) {
    const ruling = judged.rulings.find((one) => one.point === point.id)
    if (!ruling || ruling.ruling === 'rejected') continue
    const challenge = run.challenges.find((one) => one.point === point.id)
    const meta = {
      run: run.id,
      severity: point.severity,
      evidence: point.evidence,
      ...(challenge ? { challenge: challenge.concede ? 'Conceded by the adversary.' : challenge.case } : {}),
      ruling: ruling.ruling,
      reason: ruling.reason,
      ...(point.checklist.length ? { checklist: point.checklist } : {}),
    }
    const added = await n.call(REVIEW, 'add_comment', {
      project,
      change,
      path: point.path,
      line: point.line,
      ...(point.startLine && point.startLine !== point.line ? { start_line: point.startLine } : {}),
      side: point.side,
      body: commentBody(point, ruling),
      meta,
    })
    if (added.ok) comments++
    else refused.push({ point: point.id, why: added.text.slice(0, 400) })
  }
  const proposed = await n.call(REVIEW, 'propose_review', {
    project,
    change,
    run: run.id,
    summary: summaryOf(run),
    verdict: reviewVerdict(judged.verdict),
    door: run.plan?.door.kind ?? 'one-way',
    uiux: run.plan?.uiux.touches ?? false,
    pathToSuccess: judged.pathToSuccess,
  })
  if (!proposed.ok) notes.push(`Review did not take the proposed summary and verdict: ${proposed.text.slice(0, 300)}`)
  return { comments, refused, proposal: proposed.ok, notes }
}

/* ------------------------------------------------------------------ *
 * Paper
 * ------------------------------------------------------------------ */

const TEX_SPECIAL = /[\\{}$&#^_%~]/g
const tex = (text: string) => text.replace(TEX_SPECIAL, (c) => (c === '\\' ? '\\textbackslash{}' : c === '~' ? '\\textasciitilde{}' : c === '^' ? '\\textasciicircum{}' : `\\${c}`))

/** A one-way change's briefing as a pending section of the epic's paper: the person accepts or drops it. */
export async function proposeBriefing(n: Neighbours, project: string, epic: string, title: string, briefing: string): Promise<Said> {
  const body = briefing
    .split(/\n{2,}/)
    .map((para) => tex(para.replace(/^#+\s*/gm, '').trim()))
    .filter(Boolean)
    .join('\n\n')
  return n.call(PAPER, 'propose_edit', {
    project,
    epic,
    find: '\\end{document}',
    replace: `\\section*{Decision briefing: ${tex(title)}}\n\n${body}\n\n\\end{document}`,
    why: `Factory's decision briefing for ${title}: a one-way change, for you to read before anything is posted.`,
    agent: AGENT_NAME,
  })
}
