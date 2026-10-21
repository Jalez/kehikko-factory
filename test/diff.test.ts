import { describe, expect, test } from 'bun:test'

import { linesAt, parseUnified, totals } from '../review/diff.ts'
import { DIFF } from './fixtures.ts'

describe('reading a diff', () => {
  const files = parseUnified(DIFF)

  test('files, sides and numbers', () => {
    expect(files.map((one) => [one.path, one.from])).toEqual([
      ['greet.js', null],
      ['new.js', 'old.js'],
    ])
    expect(linesAt(files, { path: 'greet.js', side: 'new', line: 2 })).toMatchObject({ ok: true, text: 'export const greet = (name) => `HELLO, ${name}`' })
    expect(linesAt(files, { path: 'greet.js', side: 'old', line: 2 })).toMatchObject({ ok: true, text: 'export const greet = (name) => `Hello, ${name}`' })
    expect(linesAt(files, { path: 'greet.js', side: 'new', line: 3, startLine: 2 })).toMatchObject({ ok: true })
  })

  test('a range across hunks, a line not in the diff, and a missing file are refused', () => {
    expect(linesAt(files, { path: 'greet.js', side: 'new', line: 12, startLine: 2 })).toMatchObject({ ok: false })
    expect(linesAt(files, { path: 'greet.js', side: 'new', line: 7 })).toMatchObject({ ok: false, why: expect.stringContaining('not in this diff') })
    expect(linesAt(files, { path: 'nope.js', side: 'new', line: 1 })).toMatchObject({ ok: false })
  })

  test('a renamed file is found by either name, and totals count lines', () => {
    expect(linesAt(files, { path: 'old.js', side: 'old', line: 1 })).toMatchObject({ ok: true, text: 'x' })
    expect(totals(files)).toEqual({ files: 2, added: 4, removed: 3 })
  })
})
