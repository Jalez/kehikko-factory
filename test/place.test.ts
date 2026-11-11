import { describe, expect, test } from 'bun:test'

import { placeOfSession } from '../place.ts'
import type { HostAsk } from '../rev/vision.ts'

/** A host that answers `sessions.placeOf` with `place`, and records what it was asked. */
function host(place: unknown, asked: unknown[] = []): HostAsk {
  return async (method, params, project) => {
    asked.push([method, params, project])
    return method === 'sessions.placeOf' ? { ok: true as const, data: { place } as never } : { ok: false as const, why: 'no' }
  }
}

describe('where a conversation is placed, asked of the host (sessions.placeOf)', () => {
  test('the host’s place, asked about this project and this session', async () => {
    const asked: unknown[] = []
    expect(await placeOfSession('/p', 's-1', host({ epic: 'greetings', parts: ['a', 'b'], kehikko: 'k1' }, asked))).toEqual({ epic: 'greetings', parts: ['a', 'b'], kehikko: 'k1' })
    expect(asked).toEqual([['sessions.placeOf', { session: 's-1' }, '/p']])
  })

  test('no parts and no kehikko are left out', async () => {
    expect(await placeOfSession('/p', 's-1', host({ epic: 'greetings', parts: [], kehikko: null }))).toEqual({ epic: 'greetings' })
  })

  test('unplaced: no record, no epic, no session, no host, a host too old, or a throw', async () => {
    expect(await placeOfSession('/p', 's-1', host(null))).toBeNull()
    expect(await placeOfSession('/p', 's-1', host({ epic: null, parts: [], kehikko: 'k1' }))).toBeNull()
    expect(await placeOfSession('/p', '', host({ epic: 'greetings' }))).toBeNull()
    expect(await placeOfSession('/p', 's-1', async () => ({ ok: false as const, why: 'No Kehikot host answered.' }))).toBeNull()
    expect(await placeOfSession('/p', 's-1', async () => ({ ok: false as const, why: 'too old', declined: 'host-too-old' as const, since: '2.85.0' }))).toBeNull()
    expect(await placeOfSession('/p', 's-1', async () => { throw new Error('down') })).toBeNull()
  })

  test('with no host at all (the tests ask a port nothing listens on): unplaced', async () => {
    expect(await placeOfSession('/p', 's-1')).toBeNull()
  })
})
