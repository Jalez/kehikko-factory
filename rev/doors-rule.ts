import type { DoorRule } from './shape.ts'

/**
 * One-way or two-way, by the project's own rules first ("anything under `migrations/` is one-way",
 * "label `two-way` means two-way"), kept in Factory's settings by the person. Applied before the
 * planner's own judgement, handed to it, and never weakened by it: when a rule or the planner says
 * one-way, it is one-way. When in doubt, one-way.
 */

/** A glob as people write them: `*` within a folder, `**` across folders, a trailing `/` for everything under. */
export function globMatches(glob: string, path: string): boolean {
  const pattern = glob.trim().replace(/^\.?\//, '')
  if (!pattern) return false
  if (pattern.endsWith('/')) return path.startsWith(pattern) || path.includes(`/${pattern}`)
  const re = pattern
    .split('**')
    .map((part) => part.split('*').map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*')
  return new RegExp(`^(?:.*/)?${re}$`).test(path)
}

export const ruleSaid = (rule: DoorRule): string =>
  rule.kind === 'path' ? `anything matching \`${rule.glob}\` is ${rule.door}` : `the label "${rule.label}" means ${rule.door}`

export interface ByRules {
  door: 'one-way' | 'two-way' | null
  /** The rules that matched, in words. */
  said: string[]
}

export function doorByRules(rules: readonly DoorRule[], paths: readonly string[], labels: readonly string[]): ByRules {
  const hits = rules.filter((rule) => (rule.kind === 'path' ? paths.some((path) => globMatches(rule.glob, path)) : labels.some((label) => label.toLowerCase() === rule.label.toLowerCase())))
  if (!hits.length) return { door: null, said: [] }
  const door = hits.some((rule) => rule.door === 'one-way') ? 'one-way' : 'two-way'
  return { door, said: hits.map(ruleSaid) }
}

/** The door that stands: a rule's, made stricter by the planner's one-way, never looser. */
export function settleDoor(byRules: ByRules, planner: { kind: 'one-way' | 'two-way'; reasons: string[] }): { kind: 'one-way' | 'two-way'; reasons: string[]; rule: string | null } {
  if (byRules.door === null) return { ...planner, rule: null }
  const rule = `The project's rule: ${byRules.said.join('; ')}.`
  if (byRules.door === 'one-way' || planner.kind === 'one-way') return { kind: 'one-way', reasons: [rule, ...planner.reasons], rule }
  return { kind: 'two-way', reasons: [rule, ...planner.reasons], rule }
}

const IMAGE = /!\[[^\]]*\]\((https?:[^)\s]+)[^)]*\)|<img\b[^>]*\bsrc=["']?(https?:[^"'\s>]+)/gi

/** Whether a description and its comments carry before and after pictures: two images or more, with "before" and "after" said near them. */
export function hasBeforeAfter(texts: readonly string[]): boolean {
  let images = 0
  let before = false
  let after = false
  for (const text of texts) {
    for (const m of text.matchAll(IMAGE)) {
      images++
      const near = text.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200).toLowerCase()
      if (/\bbefore\b/.test(near)) before = true
      if (/\bafter\b/.test(near)) after = true
    }
  }
  return images >= 2 && before && after
}
