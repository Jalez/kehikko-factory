import type { TrackerRow } from 'kehikot-module-protocol'

import { MAX_ROUNDS, type Run } from './shape.ts'

/**
 * When to review a change again, per author. Teams and people say "ready for another look"
 * differently, so the person gives Factory a plain sentence per author, and Factory keeps it beside
 * the form it parsed it into:
 *
 *   "when they re-request review"                                  → re-request
 *   "2 hours after the last push, if there are new commits"        → after-push { hours: 2 }
 *   "… and every point answered"                                   → after-push { answered: true }
 *   "when they comment 'ready'"                                    → comment { word: 'ready' }
 *   "when the label ready-for-review is added"                     → label { label }
 *   "only when I ask"                                              → manual
 *
 * Clauses joined by "or" are any-of. Signals are read from the host's tracker reading (protocol
 * 2.7.0: `myRoles`, `lastPushAt`, `discussions`, `labels`), and comments from the forge only when a
 * rule asks for them. A change is reviewed at most `MAX_ROUNDS` times, so re-reviews cannot loop.
 */

export type Signal =
  | { kind: 're-request' }
  | { kind: 'after-push'; hours: number; answered: boolean }
  | { kind: 'comment'; word: string }
  | { kind: 'label'; label: string }
  | { kind: 'manual' }

export interface Rule {
  any: Signal[]
}

export type ParsedRule = { ok: true; rule: Rule } | { ok: false; why: string }

const EXAMPLES =
  'Try: "when they re-request review", "2 hours after the last push with new commits", "when they comment ready", '
  + '"when the label ready-for-review is added", or "only when I ask" — joined with "or".'

function clause(text: string): Signal | null {
  const said = text.trim().toLowerCase()
  if (!said) return null
  if (/only when i ask|\bmanual|\bnever\b|ask me/.test(said)) return { kind: 'manual' }
  const label = /label\s+[`"'“]?([^`"'”\s]+)/.exec(text)
  if (label) return { kind: 'label', label: label[1]! }
  const comment = /comments?\s+(?:with\s+)?[`"'“‘]?([^`"'”’\s,.;]+)/i.exec(text)
  if (comment && !/push/.test(said)) return { kind: 'comment', word: comment[1]!.toLowerCase() }
  if (/re-?request/.test(said)) return { kind: 're-request' }
  if (/push/.test(said)) {
    const time = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/.exec(said)
    const hours = time ? (/^m/.test(time[2]!) ? Number(time[1]) / 60 : Number(time[1])) : 0
    const answered = /(every|all|each)\s+(point|comment|discussion|thread)s?\s+(is\s+|are\s+)?(answered|resolved)/.test(said)
    return { kind: 'after-push', hours, answered }
  }
  return null
}

export function parseRule(sentence: string): ParsedRule {
  const text = sentence.trim().replace(/^when\s+/i, '')
  if (!text) return { ok: false, why: `Say when they are ready for another look. ${EXAMPLES}` }
  const parts = text.split(/,?\s+or\s+|;/i)
  const any: Signal[] = []
  for (const part of parts) {
    const signal = clause(part)
    if (!signal) return { ok: false, why: `Factory could not read "${part.trim().slice(0, 80)}" as a signal. ${EXAMPLES}` }
    any.push(signal)
  }
  if (any.some((one) => one.kind === 'manual') && any.length > 1) return { ok: false, why: '"Only when I ask" cannot be joined with another signal.' }
  return { ok: true, rule: { any } }
}

export function ruleSaid(rule: Rule): string {
  return rule.any
    .map((one) => {
      switch (one.kind) {
        case 're-request':
          return 'they re-request your review'
        case 'after-push':
          return `${one.hours ? `${one.hours} hour${one.hours === 1 ? '' : 's'} after` : 'after'} a push with new commits${one.answered ? ', every point answered' : ''}`
        case 'comment':
          return `they comment "${one.word}"`
        case 'label':
          return `the label "${one.label}" is on it`
        case 'manual':
          return 'only when you ask'
      }
    })
    .join(', or ')
}

/** What a re-review is judged from: the last run of the change, and the host's row for it. */
export interface Due {
  due: boolean
  /** Which signal, in words, or why not. */
  why: string
}

export const needsComments = (rule: Rule): boolean => rule.any.some((one) => one.kind === 'comment')

/** Is the change ready for another look, by this rule? `comments` only when the rule needs them. */
export function due(rule: Rule, row: TrackerRow, last: Pick<Run, 'stage' | 'sent' | 'pinned' | 'round' | 'updatedAt' | 'change' | 'waiting'>, now: number, comments: readonly { author: string; body: string; at: string }[] = []): Due {
  if (row.state !== 'open') return { due: false, why: `It is ${row.state}.` }
  const finished = last.stage === 'sent' || (last.stage === 'waiting' && last.waiting?.why === 'drafted')
  if (!finished) return { due: false, why: 'The last review is not finished.' }
  if (last.round >= MAX_ROUNDS) return { due: false, why: `It has been reviewed ${MAX_ROUNDS} times, the most Factory does by itself.` }
  const pinnedAt = Date.parse(last.pinned?.at ?? last.updatedAt)
  const pushed = row.lastPushAt ? Date.parse(row.lastPushAt) : NaN
  const newCommits = Number.isFinite(pushed) && pushed > pinnedAt
  for (const signal of rule.any) {
    switch (signal.kind) {
      case 'manual':
        return { due: false, why: 'Only when you ask.' }
      case 're-request':
        if (last.sent && row.myRoles?.includes('reviewer-asked')) return { due: true, why: 'They re-requested your review.' }
        break
      case 'after-push': {
        if (!newCommits) break
        if (now - pushed < signal.hours * 3_600_000) break
        if (signal.answered && (row.discussions?.unresolved ?? 0) > 0) break
        return { due: true, why: `New commits ${signal.hours ? `${signal.hours} h ago` : 'since the last review'}${signal.answered ? ', every point answered' : ''}.` }
      }
      case 'comment': {
        const author = last.change.author?.login
        const said = comments.find((one) => (!author || one.author === author) && Date.parse(one.at) > pinnedAt && new RegExp(`\\b${signal.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(one.body))
        if (said) return { due: true, why: `They commented "${signal.word}".` }
        break
      }
      case 'label':
        if (row.labels.some((one) => one.toLowerCase() === signal.label.toLowerCase()) && (newCommits || Date.parse(row.updatedAt ?? '') > Date.parse(last.updatedAt))) return { due: true, why: `The label "${signal.label}" is on it.` }
        break
    }
  }
  return { due: false, why: 'No signal yet.' }
}
