import type { Neighbours } from '../rev/neighbours.ts'

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

export function standIn(over: Partial<Record<string, (args: Record<string, unknown>) => { ok: boolean; text: string }>> = {}) {
  const calls: { id: string; tool: string; args: Record<string, unknown> }[] = []
  const n: Neighbours = {
    present: async () => true,
    call: async (id, tool, args) => {
      calls.push({ id, tool, args })
      const custom = over[`${id}:${tool}`]
      if (custom) return custom(args)
      if (tool === 'checklists' && !args.checklist) return { ok: true, text: 'Checklists in /p:\n  c1 — "What a change owes" (3 items, started by Jaakko; held against gh#7, gh#9)\n  c2 — "Other" (1 item, started by Jaakko; held against gh#3)\n\nTicks live per …' }
      if (tool === 'checklists') return { ok: true, text: LIST }
      if (tool === 'create_checklist') return { ok: true, text: 'Started.\n\n"Proposed for gh#7" (c9) — 0 items, no target named, so nothing below is ticked or unticked' }
      return { ok: true, text: 'Done.' }
    },
    send: async () => ({ status: 200, text: '{"ok":true}' }),
  }
  return { n, calls }
}

