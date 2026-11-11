import { CHECKLIST_HOLDER, DIAGRAM_WRITER, DOCUMENT_PROPOSALS, REVIEW_DRAFTS, type Service } from 'kehikot-module-protocol'

import type { Neighbours, Provider } from '../rev/neighbours.ts'

/*
 * The providers of the services /review-factory uses, standing in. Tests may name real modules and
 * their tools: these are what today's providers declare, and Factory reads them only from here.
 */
export const DRAFTS: Provider<typeof REVIEW_DRAFTS> = {
  module: 'kehikot.review',
  name: 'Review',
  placed: true,
  descriptor: { name: 'Review', tools: { comment: 'add_comment', propose: 'propose_review', drop: 'drop_run_comments' }, send: '/api/factory/send' },
}
export const HOLDER: Provider<typeof CHECKLIST_HOLDER> = {
  module: 'kehikot.checklist',
  name: 'Checklist',
  placed: true,
  descriptor: { name: 'Checklist', tools: { list: 'checklists', create: 'create_checklist', add: 'add_checklist_item', hold: 'hold_checklist', check: 'check_item' } },
}
export const DOCUMENT: Provider<typeof DOCUMENT_PROPOSALS> = {
  module: 'kehikot.paper',
  name: 'Paper',
  placed: true,
  descriptor: { name: 'Paper', root: '.kehikot/paper/{epic}', main: 'main.tex', tools: { sections: 'list_sections', source: 'read_source', propose: 'propose_edit', proposals: 'list_proposals' } },
}
export const WRITER: Provider<typeof DIAGRAM_WRITER> = {
  module: 'kehikot.flows',
  name: 'Flows',
  placed: true,
  descriptor: { name: 'Flows', tool: 'write_flow', kinds: ['sequence', 'graph'] },
}
export const REVIEW = DRAFTS.module
export const CHECKLIST = HOLDER.module

/** Checklist's print, as C1 has it. */
export const LIST = [
  '"What a change owes" (c1) held against gh#7 — 2/3 ticked',
  'passed 1 · failed 1 · n/a 0 · unchecked 1',
  '1. [x] i1 — Has a test  (Jaakko: greet.test.js)',
  '2. [!] i2 — Docs updated  (Factory review, over MCP: README untouched)',
  '3. [ ] i3 — No new dependency  [evidence: the tracker\'s files]',
  '',
  'Also held against: gh#9 (0 ticked)',
].join('\n')

export interface StandInOptions {
  /** The providers there are, by service; every one by default. Null: nothing provides it. */
  providers?: Partial<Record<Service, Provider<Service> | null>>
  /** The modules placed on the kehikko asked about; every provider by default. */
  on?: readonly string[]
}

export function standIn(over: Partial<Record<string, (args: Record<string, unknown>) => { ok: boolean; text: string }>> = {}, options: StandInOptions = {}) {
  const calls: { id: string; tool: string; args: Record<string, unknown> }[] = []
  const finds: { service: string; project: string; kehikko?: string }[] = []
  const sends: { module: string; path: string; body: unknown }[] = []
  const all: Partial<Record<Service, Provider<Service> | null>> = { [REVIEW_DRAFTS]: DRAFTS, [CHECKLIST_HOLDER]: HOLDER, [DOCUMENT_PROPOSALS]: DOCUMENT, [DIAGRAM_WRITER]: WRITER, ...options.providers }
  const n: Neighbours = {
    find: async (service, where) => {
      finds.push({ service, ...where })
      const one = all[service]
      if (!one) return null
      const placed = where.kehikko ? (options.on ? options.on.includes(one.module) : true) : null
      return { ...one, placed } as never
    },
    call: async (id, tool, args) => {
      calls.push({ id, tool, args })
      const custom = over[`${id}:${tool}`]
      if (custom) return custom(args)
      if (tool === 'checklists' && !args.checklist) return { ok: true, text: 'Checklists in /p:\n  c1 — "What a change owes" (3 items, started by Jaakko; held against gh#7, gh#9)\n  c2 — "Other" (1 item, started by Jaakko; held against gh#3)\n\nTicks live per …' }
      if (tool === 'checklists') return { ok: true, text: LIST }
      if (tool === 'create_checklist') return { ok: true, text: 'Started.\n\n"Proposed for gh#7" (c9) — 0 items, no target named, so nothing below is ticked or unticked' }
      return { ok: true, text: 'Done.' }
    },
    send: async (module, path, body) => {
      sends.push({ module, path, body })
      return { status: 200, text: '{"ok":true}' }
    },
  }
  return { n, calls, finds, sends }
}
