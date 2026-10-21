import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { newRun } from '../rev/flow.ts'
import { listRuns, readRecord, readRun, recordFiles, writeRecord, writeRun } from '../rev/store.ts'
import { readSettings } from '../store.ts'
import { scratchRepo } from './repo.ts'
import { CHANGE } from './fixtures.ts'

let repo: ReturnType<typeof scratchRepo>
afterEach(() => repo?.done())

const run = (id = 'app-7-a1b2') => newRun({ id, change: CHANGE, session: 's', place: null, now: '2026-10-21T12:00:00.000Z' })

describe('where a review is kept', () => {
  test('a run and its record live under .kehikot/factory/reviews/<id>/', () => {
    repo = scratchRepo()
    expect(writeRun(repo.root, run()).ok).toBe(true)
    expect(readRun(repo.root, 'app-7-a1b2')).toMatchObject({ ok: true, value: { id: 'app-7-a1b2', stage: 'queued' } })
    writeRecord(repo.root, 'app-7-a1b2', 'judgement.md', '# J')
    writeRecord(repo.root, 'app-7-a1b2', 'packet.md', '# P')
    writeRecord(repo.root, 'app-7-a1b2', 'review-tests.md', '# R')
    expect(recordFiles(repo.root, 'app-7-a1b2')).toEqual(['packet.md', 'review-tests.md', 'judgement.md'])
    expect(listRuns(repo.root).map((one) => one.id)).toEqual(['app-7-a1b2'])
  })

  test('a name that is not one of the record\'s is refused, and so is a folder that leaves the project', () => {
    repo = scratchRepo()
    writeRun(repo.root, run())
    expect(writeRecord(repo.root, 'app-7-a1b2', '../../escape.md', 'x').ok).toBe(false)
    expect(readRecord(repo.root, 'app-7-a1b2', 'run.json').ok).toBe(false)
    expect(readRun(repo.root, '../x').ok).toBe(false)
    const outside = mkdtempSync(join(tmpdir(), 'factory-outside-'))
    mkdirSync(join(outside, 'app-8-c3d4'))
    writeFileSync(join(outside, 'app-8-c3d4', 'run.json'), JSON.stringify(run('app-8-c3d4')))
    symlinkSync(join(outside, 'app-8-c3d4'), join(repo.root, '.kehikot', 'factory', 'reviews', 'app-8-c3d4'))
    expect(readRun(repo.root, 'app-8-c3d4').ok).toBe(false)
    expect(listRuns(repo.root).map((one) => one.id)).toEqual(['app-7-a1b2'])
  })

  test('an older settings file reads with the review switches off', () => {
    repo = scratchRepo()
    mkdirSync(join(repo.root, '.kehikot', 'factory'), { recursive: true })
    writeFileSync(join(repo.root, '.kehikot', 'factory', 'settings.json'), JSON.stringify({ judgeMerges: true, board: null }))
    const settings = readSettings(repo.root)
    expect(settings.judgeMerges).toBe(true)
    expect(settings.review).toMatchObject({ postTwoWay: false, reReviewByItself: false, runTests: false, doorRules: [] })
  })
})
