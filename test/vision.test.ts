import { describe, expect, test } from 'bun:test'
import { plansUnion, planOfJourney } from 'kehikot-module-protocol'

import { epicOf, namesChange, visionOf, visionText, type HostAsk } from '../rev/vision.ts'

const target = { forge: 'github' as const, repo: 'me/app', number: 7 }
const origin = { kind: 'github' as const, repo: 'me/app' }
const ROOT = '/projects/app'

/**
 * A 2.21.0 host, stood in: each epic's material (`epic.get`), its steps as a module provides them
 * (`steps.list`) and its parts (`parts.get`), and every question that was asked.
 */
function host(epics: Record<string, { material: Record<string, unknown>; steps?: Record<string, unknown>; parts?: { id: string; heading: string; refs: string[] }[] }>) {
  const asked: { method: string; params: Record<string, unknown>; project: string }[] = []
  const ask: HostAsk = async (method, params, project) => {
    asked.push({ method, params, project })
    const slug = String(params.epic ?? '')
    const one = epics[slug]
    const answer = (data: unknown) => ({ ok: true as const, data: data as never })
    if (method === 'epics.list') return answer({ epics: Object.entries(epics).map(([epic, { material }]) => ({ slug: epic, title: material.title })) })
    if (!one) return { ok: false, why: 'There is no epic here under that name.', reason: 'failed' }
    if (method === 'epic.get') return answer(one.material)
    if (method === 'steps.list') return answer(plansUnion(one.steps ? [{ module: 'kehikot.journeys', plan: planOfJourney(one.steps)! }] : []))
    if (method === 'parts.get') return answer({ parts: (one.parts ?? []).map((part) => ({ ...part, picked: false })) })
    return { ok: false, why: `not answered here: ${method}` }
  }
  return { ask, asked }
}

describe('the vision a change is judged against', () => {
  test('a ref names the change by any spelling, and an issue never does', () => {
    expect(namesChange('gh#7', target, origin)).toBe(true)
    expect(namesChange('gh:me/app#7', target, null)).toBe(true)
    expect(namesChange('gh:them/app#7', target, origin)).toBe(false)
    expect(namesChange('#7', target, origin)).toBe(false)
  })

  test('the epic that holds the change, with its steps provider’s goal and the shaping its material says', async () => {
    const { ask, asked } = host({
      greetings: {
        material: { slug: 'greetings', title: 'Greetings that land', lede: 'People feel greeted.', appetite: 'Two weeks', noGos: ['No sound.'] },
        steps: { title: 'Greetings', goal: 'Everyone is greeted.', steps: [{ title: 's', refs: ['gh#7'], part: 'hello' }] },
        parts: [{ id: 'hello', heading: 'Saying hello', refs: ['gh#7'] }],
      },
      other: { material: { slug: 'other', title: 'Other' }, steps: { title: 'Other', steps: [{ title: 's', refs: ['gh#8'] }] } },
    })
    expect(await epicOf(ROOT, target, origin, ask)).toBe('greetings')
    const vision = (await visionOf(ROOT, 'greetings', ask))!
    expect(vision).toMatchObject({ title: 'Greetings that land', lede: 'People feel greeted.', goal: 'Everyone is greeted.', appetite: 'Two weeks', noGos: ['No sound.'], parts: ['Saying hello'] })
    expect(vision.measure).toBeUndefined()
    expect(visionText(vision)).toContain('No-gos:')
    /* Every question is one a module's server may ask, about the project, and nothing else is read. */
    expect([...new Set(asked.map((one) => one.method))].sort()).toEqual(['epic.get', 'epics.list', 'parts.get', 'steps.list'])
    expect(asked.every((one) => one.project === ROOT)).toBe(true)
  })

  test('a change named only as a related ref of a step, or in a part, is still that epic’s', async () => {
    const { ask } = host({
      a: { material: { slug: 'a', title: 'A' }, steps: { title: 'A', steps: [{ title: 's', refs: ['gh#1', 'gh#7'], roles: { 'gh#7': 'related' } }] } },
    })
    expect(await epicOf(ROOT, target, origin, ask)).toBe('a')
    const { ask: byPart } = host({ b: { material: { slug: 'b', title: 'B' }, parts: [{ id: 'p', heading: 'P', refs: ['gh:me/app#7'] }] } })
    expect(await epicOf(ROOT, target, origin, byPart)).toBe('b')
  })

  test('a change in no epic says so', async () => {
    const { ask } = host({})
    expect(await epicOf(ROOT, target, origin, ask)).toBeNull()
    expect(await visionOf(ROOT, 'nothing', ask)).toBeNull()
    expect(visionText(null)).toContain('in no epic')
  })
})
