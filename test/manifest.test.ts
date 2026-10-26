import { describe, expect, test } from 'bun:test'
import { MODULE_ID, manifestSchema, moduleFolder, showsProject } from 'kehikot-module-protocol'

import { MANIFEST } from '../doors.ts'
import { ID, PREFERRED_PORT } from '../manifest.ts'

describe('the manifest', () => {
  test('is one a host accepts, as kehikot.factory, keeping its data under .kehikot/factory', () => {
    expect(manifestSchema.safeParse(MANIFEST).success).toBe(true)
    expect(MODULE_ID.test(ID)).toBe(true)
    expect(moduleFolder(ID)).toBe('factory')
  })

  test('follows the parts, reports to the Inbox, reads the boards and the epic, and offers the factory skills', () => {
    expect(MANIFEST.reacts).toEqual(['parts'])
    expect(MANIFEST.declares.uses).toEqual(['activity:report', 'trackers:read', 'view:navigate', 'epics:read', 'steps:read', 'parts:read'])
    expect(MANIFEST.declares.skills?.map((one) => one.name)).toEqual(['factory', 'review-factory'])
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('can show a whole project: "All epics" in the host (protocol 2.9.0)', () => {
    expect(MANIFEST.declares.scopes).toEqual(['epic', 'project'])
    expect(showsProject(MANIFEST)).toBe(true)
  })

  test('prefers 8040, on the ten-apart grid', () => {
    expect(PREFERRED_PORT).toBe(8040)
  })
})
