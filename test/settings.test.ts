import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { settingsDeclarationSchema } from 'kehikot-module-protocol'

import { MANIFEST, TICKET, answer, setHostResolve, setNeeds } from '../doors.ts'
import { DEFAULT_SETTINGS, settingsSchema } from '../job/shape.ts'
import { SETTINGS, lineRule, ruleLine, valuesOf, withValue } from '../settings.ts'
import { readSettings, writeSettings } from '../store.ts'
import { scratchRepo, testNeeds, write } from './repo.ts'

/**
 * Factory's settings at its door for the host (protocol 2.15.0): every setting declared, every one
 * the person's; a read and a change round trip through the same `.kehikot/factory/settings.json`
 * in the same format the board writes; an agent refused; a person's pass asked only of the
 * origins the host started this module with.
 */

let repo: ReturnType<typeof scratchRepo>
beforeAll(() => {
  repo = scratchRepo()
  setNeeds(() => testNeeds([repo.root]))
  setHostResolve(async (folder) => (folder === repo.root ? { ok: true, path: folder } : { ok: false, reason: 'not-project', why: `${folder} is not a project open in Kehikot.` }))
})
afterAll(() => {
  setNeeds(null)
  setHostResolve(null)
  repo.done()
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  writeSettings(repo.root, DEFAULT_SETTINGS)
})

const file = () => join(repo.root, '.kehikot', 'factory', 'settings.json')
const PASS = 'p'.repeat(32)

async function get() {
  const reply = await answer('GET', '/api/kehikot/settings', new URLSearchParams({ project: repo.root }), null, null)
  return reply!.body as { values: Record<string, unknown>; file?: string; problem?: string }
}
async function set(body: Record<string, unknown>, ticket: string | null = null) {
  const reply = await answer('POST', '/api/kehikot/settings', new URLSearchParams(), { project: repo.root, ...body }, ticket)
  return reply!.body as { outcome: string; why: string; values?: Record<string, unknown> }
}

/** The host, as a module's server meets it: answers a pass question at whatever origin was asked, and records it. */
function host(person: boolean) {
  const asked: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked.push(String(input))
    return Response.json({ ok: true, person })
  }) as unknown as typeof fetch
  return asked
}

describe('the declaration', () => {
  test('is in the manifest, parses, and every setting is the person’s', () => {
    expect(MANIFEST.declares.settings).toEqual(SETTINGS)
    expect(settingsDeclarationSchema.parse(SETTINGS)).toEqual(SETTINGS)
    expect(SETTINGS.map((one) => one.key)).toEqual(['judgeMerges', 'postTwoWay', 'reReviewByItself', 'runTests', 'defaultRule', 'doorRules'])
    expect(SETTINGS.every((one) => one.personOnly && one.scope === 'project')).toBe(true)
  })

  test('each default is the file’s default', () => {
    expect(Object.fromEntries(SETTINGS.map((one) => [one.key, one.default]))).toEqual(valuesOf(DEFAULT_SETTINGS))
  })
})

describe('read and change, round trip', () => {
  test('get reads what the board wrote, and names the file', async () => {
    writeSettings(repo.root, { ...DEFAULT_SETTINGS, judgeMerges: true, review: { ...DEFAULT_SETTINGS.review, runTests: true, doorRules: [{ kind: 'path', glob: 'migrations/', door: 'one-way' }] } })
    const read = await get()
    expect(read.file).toBe('.kehikot/factory/settings.json')
    expect(read.values).toMatchObject({ judgeMerges: true, runTests: true, postTwoWay: false, doorRules: ['path migrations/ → one-way'] })
  })

  test("the page's ticket is the person: saved, in the format the board writes, the board mapping kept", async () => {
    const board = { kind: 'github' as const, repo: 'acme/app', board: 'Roadmap', columns: { spec: 'Todo' }, confirmed: true }
    writeSettings(repo.root, { ...DEFAULT_SETTINGS, board })
    expect((await set({ key: 'judgeMerges', value: true }, TICKET)).outcome).toBe('saved')
    expect((await set({ key: 'doorRules', value: ['path migrations/ → one-way', 'label two-way -> two-way'] }, TICKET)).outcome).toBe('saved')
    const text = readFileSync(file(), 'utf8')
    const kept = settingsSchema.parse(JSON.parse(text))
    expect(text).toBe(`${JSON.stringify(kept, null, 2)}\n`)
    expect(kept.judgeMerges).toBe(true)
    expect(kept.board).toEqual(board)
    expect(kept.review.doorRules).toEqual([
      { kind: 'path', glob: 'migrations/', door: 'one-way' },
      { kind: 'label', label: 'two-way', door: 'two-way' },
    ])
    expect(readSettings(repo.root).judgeMerges).toBe(true)
  })

  test('a value Factory cannot keep is refused, and nothing is written', async () => {
    const before = readFileSync(file(), 'utf8')
    expect((await set({ key: 'doorRules', value: ['anything goes'] }, TICKET)).why).toContain('not a door rule')
    expect((await set({ key: 'defaultRule', value: 'whenever' }, TICKET)).why).toContain('could not read')
    expect((await set({ key: 'judgeMerges', value: 'yes' }, TICKET)).outcome).toBe('refused')
    expect(readFileSync(file(), 'utf8')).toBe(before)
  })

  test('a file that does not read is not overwritten with the defaults', async () => {
    write(file(), '{ not json')
    expect((await get()).problem).toContain('not readable JSON')
    expect((await set({ key: 'judgeMerges', value: true }, TICKET)).outcome).toBe('refused')
    expect(readFileSync(file(), 'utf8')).toBe('{ not json')
  })
})

describe('who may change them', () => {
  test('an agent is refused every one, and the file stays as it was', async () => {
    const asked = host(true)
    const before = readFileSync(file(), 'utf8')
    for (const one of SETTINGS) {
      const said = await set({ key: one.key, value: one.default })
      expect(said.outcome).toBe('refused')
      expect(said.why).toContain('An agent cannot change it')
    }
    /* Saying "person" without a pass asks nobody and changes nothing. */
    expect((await set({ key: 'judgeMerges', value: true, by: 'person' })).outcome).toBe('refused')
    expect(asked).toEqual([])
    expect(readFileSync(file(), 'utf8')).toBe(before)
  })

  test("a person's pass is asked only of the host's own origins, never of an address the request names", async () => {
    const asked = host(true)
    const said = await set({ key: 'judgeMerges', value: true, by: 'person', pass: PASS, host: 'http://evil.example', origin: 'http://127.0.0.1:6666' })
    expect(said.outcome).toBe('saved')
    expect(asked.length).toBe(1)
    expect(asked[0]!.startsWith(`${process.env.KEHIKOT_ORIGINS}/host/settings-pass?`)).toBe(true)
    expect(asked[0]).toContain(`pass=${PASS}`)
    expect(asked[0]).toContain('module=kehikot.factory')
    expect(asked[0]).toContain('key=judgeMerges')
    expect(asked[0]).toContain(`project=${encodeURIComponent(repo.root)}`)
  })

  test('a pass the host does not vouch for is refused', async () => {
    host(false)
    expect((await set({ key: 'judgeMerges', value: true, by: 'person', pass: PASS })).outcome).toBe('refused')
    expect(readSettings(repo.root).judgeMerges).toBe(false)
  })
})

describe('the pure rules', () => {
  test('a door rule line round trips', () => {
    for (const rule of [{ kind: 'path' as const, glob: 'db/**', door: 'one-way' as const }, { kind: 'label' as const, label: 'docs', door: 'two-way' as const }]) {
      expect(lineRule(ruleLine(rule))).toEqual({ ok: true, rule })
    }
    expect(withValue(DEFAULT_SETTINGS, 'nope', 1)).toEqual({ ok: false, why: expect.stringContaining('no setting') })
  })
})
