import { KEHIKOT_DIR, settingsDeclarationSchema, type SettingField } from 'kehikot-module-protocol'

import { DOORS, doorRuleSchema, type DoorRule } from './rev/shape.ts'
import { parseRule } from './rev/rerev.ts'
import type { Settings } from './job/shape.ts'

/**
 * Factory's settings as a host shows them (protocol 2.15.0, `declares.settings`): the same
 * `.kehikot/factory/settings.json` the board's own controls write, in the same format. Every one is
 * the person's (`personOnly`): each lets Factory act without them — merge, post a review to the
 * forge, start a background session, run the project's tests — or decides when it does. The
 * board's stage mapping is a structure, not a field: it stays on the board's own Settings.
 *
 * Pure: the fields, and how each key reads and writes the file's shape. The door is in `doors.ts`.
 */

export const SETTINGS_FILE = `${KEHIKOT_DIR}/factory/settings.json`

export const SETTINGS: SettingField[] = settingsDeclarationSchema.parse([
  {
    key: 'judgeMerges',
    label: 'Let the judge merge approved jobs by itself',
    description: 'An approved job is merged into main without waiting for you. Off: approved jobs wait for you.',
    type: 'boolean',
    default: false,
    personOnly: true,
  },
  {
    key: 'postTwoWay',
    label: 'Post two-way reviews by myself',
    description: 'A two-way change with no UI or UX is posted to the pull or merge request without you, through Review.',
    type: 'boolean',
    default: false,
    personOnly: true,
  },
  {
    key: 'reReviewByItself',
    label: 'Re-review by myself',
    description: 'When a change is ready for another review, it runs in a background session without asking you.',
    type: 'boolean',
    default: false,
    personOnly: true,
  },
  {
    key: 'runTests',
    label: "Reviewers may run this project's tests",
    description: "Only the project's own test command, in the review's checkout.",
    type: 'boolean',
    default: false,
    personOnly: true,
  },
  {
    key: 'defaultRule',
    label: 'Ready for another review',
    description: 'The signal that an author is ready for another review, unless you set one for them.',
    type: 'string',
    default: 'when they re-request review, or 2 hours after the last push with new commits and every point answered',
    personOnly: true,
  },
  {
    key: 'doorRules',
    label: 'Door rules',
    description: 'One rule a line: "path migrations/ → one-way" or "label two-way → two-way". A one-way rule always wins.',
    type: 'list',
    default: [],
    personOnly: true,
  },
])

/** A door rule as one line. */
export function ruleLine(rule: DoorRule): string {
  return rule.kind === 'path' ? `path ${rule.glob} → ${rule.door}` : `label ${rule.label} → ${rule.door}`
}

/** One line as a door rule, or why not. Takes `→` or `->`. */
export function lineRule(line: string): { ok: true; rule: DoorRule } | { ok: false; why: string } {
  const m = /^\s*(path|label)\s+(.+?)\s*(?:→|->)\s*(one-way|two-way)\s*$/i.exec(line)
  const why = `"${line.slice(0, 80)}" is not a door rule: write "path <glob> → one-way" or "label <name> → ${DOORS[1]}".`
  if (!m) return { ok: false, why }
  const kind = m[1]!.toLowerCase() as 'path' | 'label'
  const door = m[3]!.toLowerCase() as DoorRule['door']
  const parsed = doorRuleSchema.safeParse(kind === 'path' ? { kind, glob: m[2], door } : { kind, label: m[2], door })
  return parsed.success ? { ok: true, rule: parsed.data } : { ok: false, why }
}

/** Every key's value, out of the settings as kept. */
export function valuesOf(settings: Settings): Record<string, unknown> {
  return {
    judgeMerges: settings.judgeMerges,
    postTwoWay: settings.review.postTwoWay,
    reReviewByItself: settings.review.reReviewByItself,
    runTests: settings.review.runTests,
    defaultRule: settings.review.defaultRule,
    doorRules: settings.review.doorRules.map(ruleLine),
  }
}

/** The settings with one key changed (already of its type), or why it cannot be. Everything else is kept as it was. */
export function withValue(settings: Settings, key: string, value: unknown): { ok: true; settings: Settings } | { ok: false; why: string } {
  const review = settings.review
  switch (key) {
    case 'judgeMerges':
      return { ok: true, settings: { ...settings, judgeMerges: value === true } }
    case 'postTwoWay':
    case 'reReviewByItself':
    case 'runTests':
      return { ok: true, settings: { ...settings, review: { ...review, [key]: value === true } } }
    case 'defaultRule': {
      const sentence = String(value).trim()
      if (!sentence || sentence.length > 300) return { ok: false, why: 'Say the signal in one sentence, at most 300 characters.' }
      const parsed = parseRule(sentence)
      if (!parsed.ok) return { ok: false, why: parsed.why }
      return { ok: true, settings: { ...settings, review: { ...review, defaultRule: sentence } } }
    }
    case 'doorRules': {
      const lines = (value as string[]).map((line) => line.trim()).filter(Boolean)
      if (lines.length > 50) return { ok: false, why: 'At most 50 door rules.' }
      const rules: DoorRule[] = []
      for (const line of lines) {
        const read = lineRule(line)
        if (!read.ok) return read
        rules.push(read.rule)
      }
      return { ok: true, settings: { ...settings, review: { ...review, doorRules: rules } } }
    }
    default:
      return { ok: false, why: `Factory has no setting called "${key.slice(0, 64)}".` }
  }
}
