import { describe, expect, test } from 'bun:test'
import { MODULE_ID, manifestSchema, moduleFolder } from 'kehikot-module-protocol'

import { MANIFEST } from '../doors.ts'
import { ID, PREFERRED_PORT } from '../manifest.ts'

describe('the manifest', () => {
  test('is one a host accepts, as kehikot.factory, keeping its data under .kehikot/factory', () => {
    expect(manifestSchema.safeParse(MANIFEST).success).toBe(true)
    expect(MODULE_ID.test(ID)).toBe(true)
    expect(moduleFolder(ID)).toBe('factory')
  })

  test('follows the parts, reports to the Inbox, reads the boards, and offers the factory skill', () => {
    expect(MANIFEST.reacts).toEqual(['parts'])
    expect(MANIFEST.declares.uses).toEqual(['activity:report', 'trackers:read'])
    expect(MANIFEST.declares.skills?.map((one) => one.name)).toEqual(['factory'])
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('prefers 8040, on the ten-apart grid', () => {
    expect(PREFERRED_PORT).toBe(8040)
  })
})
