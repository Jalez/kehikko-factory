import { CHECKLIST_HOLDER, CHECKLIST_JSON, DIAGRAM_WRITER, DOCUMENT_PROPOSALS, REVIEW_DRAFTS, checklistJson, checklistJsonIn, checklistListsJson, holderTakesJson, type Service } from 'kehikot-module-protocol'
import { callServiceTool, fetchService, findService, type FoundService } from 'kehikot-module-protocol/serve'

import { ID } from '../manifest.ts'
import type { Run, RunChecklist } from './shape.ts'

/**
 * The other modules a review writes into, found only by the SERVICE they provide (protocol 2.83.0,
 * docs/services.md): Build Pipeline never names one. `findService` asks the host who provides a service here,
 * and every tool name, route and name said to the person comes from that provider's descriptor. Calls
 * go to the provider's own doors, so every rule it keeps (the draft's anchor check, the checklist's "an
 * agent never changes the person's tick") holds for Build Pipeline too:
 *
 *  - `review.drafts`: `tools.comment` with `meta`, `tools.propose`, `tools.drop`, and `send` — a run's
 *    review sent without the person, POSTed with this server's caller pass (`fetchService`), which the
 *    provider checks (`vouchCaller`). No descriptor `send`: nothing is posted by Build Pipeline.
 *  - `checklist.holder`: `tools.list` to read what is held against the change — as JSON when the
 *    descriptor's `formats` has it (protocol 2.85.0, `checklistListsJson` / `checklistJson`), otherwise
 *    in its print (`[x]` passed, `[!]` failed, `[-]` n/a, `[ ]` unchecked; in the protocol's schema comment);
 *    `tools.create`, `tools.add`, `tools.hold` for an accepted proposal; `tools.check` with `state`.
 *  - `document.proposals`: `tools.propose`, for a one-way change's briefing in an epic that has a document.
 *  - `diagram.writer`: whose `tool` the diagram drawer is told to use.
 *
 * Nothing here is an agent's door.
 */

export { CHECKLIST_HOLDER, DIAGRAM_WRITER, DOCUMENT_PROPOSALS, REVIEW_DRAFTS }

/** The name Build Pipeline signs its checklist answers with. */
export const AGENT_NAME = 'Build Pipeline review'
/** What this module signed with before it was renamed: ticks it set then are still its own. */
const FORMER_AGENT_NAMES = ['Factory review']

export interface Said {
  ok: boolean
  text: string
}

/** A provider found, as Build Pipeline uses it: its id (as the host answered), its name, whether placed, its descriptor. */
export type Provider<S extends Service> = FoundService<S>

export interface Neighbours {
  /** The provider of a service here, or null when none (or the host cannot say). With `kehikko`, `placed` says whether it is on it. */
  find<S extends Service>(service: S, where: { project: string; kehikko?: string }): Promise<Provider<S> | null>
  /** One tool on a provider's MCP door, by the name its descriptor gives. */
  call(module: string, tool: string, args: Record<string, unknown>): Promise<Said>
  /** A POST to a route a provider's descriptor names, carrying this server's caller pass. */
  send(module: string, path: string, body: unknown): Promise<{ status: number; text: string }>
}

export const realNeighbours: Neighbours = {
  async find(service, where) {
    const found = await findService(service, { module: ID, project: where.project, ...(where.kehikko ? { kehikko: where.kehikko } : {}) })
    return found.ok ? found.provider : null
  },
  call(module, tool, args) {
    return callServiceTool(module, tool, args, { from: ID })
  },
  async send(module, path, body) {
    const sent = await fetchService(module, path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }, { from: ID })
    if (!sent.ok) return { status: 0, text: sent.why }
    try {
      return { status: sent.response.status, text: await sent.response.text() }
    } catch (e) {
      return { status: 0, text: e instanceof Error ? e.message : String(e) }
    }
  },
}

type Holder = Provider<typeof CHECKLIST_HOLDER>
type Drafts = Provider<typeof REVIEW_DRAFTS>
type Document = Provider<typeof DOCUMENT_PROPOSALS>

/* ------------------------------------------------------------------ *
 * checklist.holder
 * ------------------------------------------------------------------ */
const MARK: Record<string, RunChecklist['items'][number]['state']> = { x: 'passed', '!': 'failed', '-': 'na', ' ': null }

/** One list, as `tools.list` prints it for a target (the print is in the protocol's `checklist.holder` comment). */
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

/** One list as answered for `ref`: JSON from a holder that takes it, the print from one that does not. */
async function readList(n: Neighbours, holder: Holder, project: string, checklist: string, ref: string): Promise<RunChecklist | null> {
  const json = holderTakesJson(holder.descriptor)
  const one = await n.call(holder.module, holder.descriptor.tools.list, { project, checklist, ref, ...(json ? { format: CHECKLIST_JSON } : {}) })
  if (!one.ok) return null
  if (!json) return parseList(one.text)
  const read = checklistJsonIn(checklistJson, one.text)
  return read ? { id: read.id, name: read.name, items: read.items.slice(0, 200) } : null
}

/** The lists held against the change, with what is set for it. `spellings`: every way the change may have been named. */
export async function checklistsHeld(n: Neighbours, holder: Holder, project: string, spellings: readonly string[]): Promise<{ lists: RunChecklist[]; ref: string | null; trouble: string | null }> {
  const tool = holder.descriptor.tools.list
  if (holderTakesJson(holder.descriptor)) {
    const all = await n.call(holder.module, tool, { project, format: CHECKLIST_JSON })
    if (!all.ok) return { lists: [], ref: null, trouble: all.text }
    const read = checklistJsonIn(checklistListsJson, all.text)
    if (!read) return { lists: [], ref: null, trouble: `${holder.name} answered its lists in a shape Build Pipeline does not read.` }
    const lists: RunChecklist[] = []
    let ref: string | null = null
    for (const one of read.lists) {
      const named = spellings.find((spelling) => one.held.includes(spelling))
      if (!named) continue
      const list = await readList(n, holder, project, one.id, named)
      if (list) {
        lists.push(list)
        ref = ref ?? named
      }
    }
    return { lists, ref, trouble: null }
  }
  /* A holder without `formats`: its print, as before 2.85.0. */
  const all = await n.call(holder.module, tool, { project })
  if (!all.ok) return { lists: [], ref: null, trouble: all.text }
  const lists: RunChecklist[] = []
  let ref: string | null = null
  for (const line of all.text.split('\n')) {
    const m = /^ {2}(\S+) — ".*" \(.*held against (.*)\)$/.exec(line)
    if (!m) continue
    const held = m[2]!
    let named = spellings.find((one) => held.split(', ').includes(one)) ?? null
    if (!named && /^\d+ targets/.test(held)) {
      const whole = await n.call(holder.module, tool, { project, checklist: m[1]! })
      const tail = /\n\nHeld against: (.*)$/.exec(whole.text)?.[1] ?? ''
      named = spellings.find((one) => tail.includes(`${one} (`)) ?? null
    }
    if (!named) continue
    const list = await readList(n, holder, project, m[1]!, named)
    if (list) {
      lists.push(list)
      ref = ref ?? named
    }
  }
  return { lists, ref, trouble: null }
}

/** A proposal the person accepted: a new list, its items, held against the change. */
export async function createChecklist(n: Neighbours, holder: Holder, project: string, ref: string, name: string, items: readonly string[]): Promise<{ ok: true; list: RunChecklist } | { ok: false; why: string }> {
  const { module, name: by, descriptor } = holder
  const made = await n.call(module, descriptor.tools.create, { project, name, agent: AGENT_NAME })
  const id = made.ok ? /"[^"]*" \(([^()\s]+)\)/.exec(made.text)?.[1] : undefined
  if (!id) return { ok: false, why: `${by} did not make the list: ${made.text.slice(0, 300)}` }
  for (const text of items) {
    const added = await n.call(module, descriptor.tools.add, { project, checklist: id, text, agent: AGENT_NAME })
    if (!added.ok) return { ok: false, why: `${by} did not add "${text.slice(0, 80)}": ${added.text.slice(0, 300)}` }
  }
  const held = await n.call(module, descriptor.tools.hold, { project, checklist: id, ref, agent: AGENT_NAME })
  if (!held.ok) return { ok: false, why: `${by} did not hold the list against ${ref}: ${held.text.slice(0, 300)}` }
  const list = await readList(n, holder, project, id, ref)
  return list ? { ok: true, list } : { ok: false, why: `${by} made the list, but it could not be read back.` }
}

const STATE_OF = { pass: 'passed', fail: 'failed', 'n/a': 'na' } as const

/**
 * The reviewers' answers set in the checklist holder, as Build Pipeline's. Only an unchecked item, or one Build Pipeline
 * set itself: never the person's (the holder refuses that anyway), and not another agent's either. Where
 * the panel disagrees, that is said in a note on the card and in the record instead.
 */
export async function setStates(n: Neighbours, holder: Holder, project: string, ref: string, run: Pick<Run, 'answers' | 'checklists'>): Promise<{ set: number; notes: string[] }> {
  const notes: string[] = []
  let set = 0
  for (const answer of run.answers) {
    const item = run.checklists.find((one) => one.id === answer.checklist)?.items.find((one) => one.id === answer.item)
    if (!item) continue
    const state = STATE_OF[answer.state]
    if (item.state !== null && item.by !== AGENT_NAME && !FORMER_AGENT_NAMES.includes(item.by ?? '')) {
      if (item.state !== state) notes.push(`${item.byPerson ? 'You' : item.by} marked "${item.text.slice(0, 80)}" ${item.state}; the ${answer.by} reviewer found it ${state}: ${answer.note}`)
      continue
    }
    const done = await n.call(holder.module, holder.descriptor.tools.check, { project, checklist: answer.checklist, item: answer.item, ref, state, note: `${answer.note} (${answer.by} reviewer)`.slice(0, 600), agent: AGENT_NAME })
    if (done.ok) set++
    else notes.push(`${holder.name} did not take the answer for "${item.text.slice(0, 80)}": ${done.text.slice(0, 200)}`)
  }
  return { set, notes }
}

/* ------------------------------------------------------------------ *
 * review.drafts
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

/**
 * The summary proposed beside the person's: the judge's words and the vision. The path to success
 * goes beside it as `pathToSuccess`, and the draft's keeper adds it under "To get this approved:", numbered.
 */
export function summaryOf(run: Pick<Run, 'judged' | 'vision' | 'plan'>): string {
  const judged = run.judged!
  const out = [judged.summary.trim()]
  if (judged.visionFit.trim()) out.push('', judged.visionFit.trim())
  else if (!run.vision?.epic) out.push('', 'This change is in no epic, so it was reviewed without a vision to weigh it against.')
  if (judged.verdict === 'close' && judged.close) out.push('', `Close this change: ${judged.close.why}`, `Instead: ${judged.close.instead}`)
  if (judged.verdict === 'approve') out.push('', 'Nothing blocks this change.')
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
 * The run's result as a draft review: earlier runs' unsent agent comments on this change dropped
 * (only those: never the person's, never a sent one — the provider keeps that rule), one comment per
 * required or kept optional point with its `meta`, and the summary and verdict proposed beside the
 * person's, never over them.
 */
export async function draftToReview(n: Neighbours, drafts: Drafts, project: string, run: Run, earlier: readonly string[]): Promise<Drafted> {
  const change = run.change.url
  const notes: string[] = []
  const { module, name, descriptor } = drafts
  for (const id of earlier) {
    const dropped = await n.call(module, descriptor.tools.drop, { project, change, run: id })
    if (!dropped.ok) notes.push(`${name} did not drop the unsent comments of ${id}: ${dropped.text.slice(0, 200)}`)
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
    const added = await n.call(module, descriptor.tools.comment, {
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
  const proposed = await n.call(module, descriptor.tools.propose, {
    project,
    change,
    run: run.id,
    summary: summaryOf(run),
    verdict: reviewVerdict(judged.verdict),
    door: run.plan?.door.kind ?? 'one-way',
    uiux: run.plan?.uiux.touches ?? false,
    pathToSuccess: judged.pathToSuccess,
  })
  if (!proposed.ok) notes.push(`${name} did not take the proposed summary and verdict: ${proposed.text.slice(0, 300)}`)
  return { comments, refused, proposal: proposed.ok, notes }
}

/* ------------------------------------------------------------------ *
 * document.proposals
 * ------------------------------------------------------------------ */

const TEX_SPECIAL = /[\\{}$&#^_%~]/g
const tex = (text: string) => text.replace(TEX_SPECIAL, (c) => (c === '\\' ? '\\textbackslash{}' : c === '~' ? '\\textasciitilde{}' : c === '^' ? '\\textasciicircum{}' : `\\${c}`))

/** A one-way change's briefing as a pending section of the epic's document: the person accepts or drops it. */
export async function proposeBriefing(n: Neighbours, document: Document, project: string, epic: string, title: string, briefing: string): Promise<Said> {
  const body = briefing
    .split(/\n{2,}/)
    .map((para) => tex(para.replace(/^#+\s*/gm, '').trim()))
    .filter(Boolean)
    .join('\n\n')
  return n.call(document.module, document.descriptor.tools.propose, {
    project,
    epic,
    find: '\\end{document}',
    replace: `\\section*{Decision briefing: ${tex(title)}}\n\n${body}\n\n\\end{document}`,
    why: `Build Pipeline's decision briefing for ${title}: a one-way change, for you to read before anything is posted.`,
    agent: AGENT_NAME,
  })
}
