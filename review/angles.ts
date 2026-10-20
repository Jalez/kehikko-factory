import { z } from 'zod'

/**
 * Review angles: the points of view a change is reviewed from, chosen per change by a planner (or
 * by the person). Part of the angle → reviewer → counter-arguer → judge machinery in `review/`,
 * which knows nothing of Factory's jobs, git or storage, so another module (Review) can use it.
 */

/** An angle's id: kebab-case, so it is also a file name (`review-<angle>.md`). */
export const ANGLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const MAX_ANGLES = 6
export const MIN_ANGLES = 1
export const MAX_ANGLE_ID = 32
export const MAX_BRIEF = 400

export const angleSchema = z.object({
  id: z.string().regex(ANGLE_ID).max(MAX_ANGLE_ID),
  brief: z.string().min(1).max(MAX_BRIEF),
  /** Who chose it: the planner reading the spec, or the person. */
  by: z.enum(['planner', 'person']),
})
export type Angle = z.infer<typeof angleSchema>

/** A point the judge ruled on, as it goes back to whoever makes the change. */
export const pointSchema = z.object({ angle: z.string().max(MAX_ANGLE_ID), point: z.string().min(1).max(1000) })
export type Point = z.infer<typeof pointSchema>

/** Angles a person can add without writing a brief; a planner may use others. */
export const KNOWN_ANGLES: Readonly<Record<string, string>> = {
  security: 'Look for ways the change lets someone read, write or run what they should not: input handling, secrets, permissions, injection.',
  'data-migration': 'Check that data written before the change is still read correctly after it, and that nothing is lost or silently rewritten.',
  accessibility: 'Check the change can be used by keyboard and screen reader: names, focus order, contrast, and nothing said by colour alone.',
  performance: 'Look for work the change does more often or over more data than it needs to, and for anything that blocks while it waits.',
  'api-compat': 'Check that callers written against the old interface, file format or wire still work, or are refused clearly.',
  tests: 'Check the change is tested where it can break: the behaviour asked for, its edges, and the failure paths.',
  'ux-copy': 'Read every word the change shows a person: is it true, short, specific, and does it say what to do next?',
  correctness: 'Read the change against the spec: does it do what was asked, in every case the spec names, and nothing it did not ask for?',
}

/** An angle the person named, with a brief: theirs, the one it had, a known one, or a plain one. */
export function angleFor(id: string, brief?: string, had?: Angle): Angle {
  const said = (brief?.trim() || had?.brief || KNOWN_ANGLES[id] || `Look at the change from the ${id.replace(/-/g, ' ')} angle.`).slice(0, MAX_BRIEF)
  return { id, brief: said, by: 'person' }
}
