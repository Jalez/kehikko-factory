import { describe, expect, test } from 'bun:test'
import { HELP_LIMITS, MODULE_FOLDERS, MODULE_ID, WORK_STATUS, foldersOwned, helpOf, manifestSchema, moduleFolder, serviceDescriptor, servicesOf, showsProject } from 'kehikot-module-protocol'

import { MANIFEST } from '../doors.ts'
import { HELP, ID, JOBS_ROUTE, PREFERRED_PORT } from '../manifest.ts'

describe('the manifest', () => {
  test('is one a host accepts, as kehikot.factory, keeping its data under .kehikot/factory', () => {
    expect(manifestSchema.safeParse(MANIFEST).success).toBe(true)
    expect(MODULE_ID.test(ID)).toBe(true)
    expect(moduleFolder(ID)).toBe('factory')
  })

  test('follows the parts, reports to the Inbox, reads the boards and the epic, and offers the factory skills', () => {
    expect(MANIFEST.reacts).toEqual(['parts'])
    expect(MANIFEST.declares.uses).toEqual(['activity:report', 'trackers:read', 'view:navigate', 'epics:read', 'steps:read', 'parts:read', 'state:keep', 'services:read', 'sessions:place'])
    expect(MANIFEST.declares.skills?.map((one) => one.name)).toEqual(['factory', 'review-factory'])
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('provides work.status: a descriptor that parses, naming the route doors.ts answers (protocol 2.83.0)', () => {
    const parsed = manifestSchema.parse(MANIFEST)
    expect(servicesOf(parsed)).toEqual([WORK_STATUS, MODULE_FOLDERS])
    expect(serviceDescriptor(WORK_STATUS, parsed.services?.[WORK_STATUS])).toEqual({ name: 'Factory', jobs: JOBS_ROUTE })
    expect(JOBS_ROUTE).toBe('/api/jobs')
  })

  test('provides module.folders for .kehikot/factory, its own folder (protocol 2.85.0)', () => {
    const owned = foldersOwned([{ module: ID, name: 'Factory', placed: null, descriptor: MANIFEST.services?.[MODULE_FOLDERS] } as never])
    expect([...owned.keys()]).toEqual(['factory'])
    expect(owned.get('factory')).toMatchObject({ module: ID, name: 'Factory', derived: false })
  })

  test('can show a whole project: "All epics" in the host (protocol 2.9.0)', () => {
    expect(MANIFEST.declares.scopes).toEqual(['epic', 'project'])
    expect(showsProject(MANIFEST)).toBe(true)
  })

  test('prefers 8040, on the ten-apart grid', () => {
    expect(PREFERRED_PORT).toBe(8040)
  })
})

describe('How to use (protocol 2.52.0)', () => {
  test('is declared, within the protocol’s bounds, and read back whole as plain one-line text', () => {
    const help = helpOf(MANIFEST)
    expect(help).toEqual(HELP)
    expect(HELP.summary.length).toBeLessThanOrEqual(HELP_LIMITS.SUMMARY)
    expect(HELP.sections.length).toBeLessThanOrEqual(HELP_LIMITS.SECTIONS)
    for (const section of HELP.sections) {
      expect(section.title.length).toBeLessThanOrEqual(HELP_LIMITS.TITLE)
      expect(section.points.length).toBeLessThanOrEqual(HELP_LIMITS.POINTS)
      for (const point of section.points) {
        expect(point.length).toBeLessThanOrEqual(HELP_LIMITS.POINT)
        expect(point).not.toMatch(/[<>]|https?:|\]\(/)
      }
    }
  })

  test('says what it shows, how to use it and what agents can do', () => {
    expect(HELP.sections.map((section) => section.title)).toEqual(expect.arrayContaining(['What it shows', 'How to use it', 'What agents can do']))
  })
})
