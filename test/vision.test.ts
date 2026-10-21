import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { epicOf, namesChange, visionOf, visionText } from '../rev/vision.ts'
import { scratchRepo, write } from './repo.ts'

let repo: ReturnType<typeof scratchRepo>
afterEach(() => repo?.done())

const target = { forge: 'github' as const, repo: 'me/app', number: 7 }
const origin = { kind: 'github' as const, repo: 'me/app' }

describe('the vision a change is judged against', () => {
  test('a ref names the change by any spelling, and an issue never does', () => {
    expect(namesChange('gh#7', target, origin)).toBe(true)
    expect(namesChange('gh:me/app#7', target, null)).toBe(true)
    expect(namesChange('gh:them/app#7', target, origin)).toBe(false)
    expect(namesChange('#7', target, origin)).toBe(false)
  })

  test('the epic that holds the change, with Journeys\' shaping when it is written', () => {
    repo = scratchRepo()
    write(join(repo.root, '.kehikot', 'host', 'epics', 'greetings.json'), JSON.stringify({ slug: 'greetings', title: 'Greetings that land', lede: 'People feel greeted.', steps: [{ title: 's', refs: ['gh#7'] }] }))
    write(join(repo.root, '.kehikot', 'host', 'epics', 'other.json'), JSON.stringify({ slug: 'other', title: 'Other', steps: [{ title: 's', refs: ['gh#8'] }] }))
    write(join(repo.root, '.kehikot', 'journeys', 'journeys.json'), JSON.stringify({ journeys: { greetings: { slug: 'greetings', title: 'Greetings that land', goal: 'Everyone is greeted.', appetite: 'Two weeks', noGos: ['No sound.'] } } }))
    expect(epicOf(repo.root, target, origin)).toBe('greetings')
    const vision = visionOf(repo.root, 'greetings')!
    expect(vision).toMatchObject({ title: 'Greetings that land', lede: 'People feel greeted.', goal: 'Everyone is greeted.', appetite: 'Two weeks', noGos: ['No sound.'] })
    expect(vision.measure).toBeUndefined()
    expect(visionText(vision)).toContain('No-gos:')
  })

  test('a change in no epic says so', () => {
    repo = scratchRepo()
    expect(epicOf(repo.root, target, origin)).toBeNull()
    expect(visionText(null)).toContain('in no epic')
  })
})
