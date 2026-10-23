import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { skillPath, skillTextIssue, type ModuleSkill } from 'kehikot-module-protocol'
import { originFor, preferred } from 'kehikot-module-protocol/serve'

import { PREFERRED_PORT } from './manifest.ts'
import { REVIEW } from './rev/neighbours.ts'

/**
 * The Claude Code skills this module offers (protocol 2.5.0, `declares.skills`): `/factory` and
 * `/review-factory`.
 *
 * Each is ONE file, `plugin/skills/<name>/SKILL.md`, which is a template: where it says
 * `{{origin}}` this module writes the origin it is really serving on (`serveFrom`, from the port
 * Vite ended up bound to), and where it says `{{version}}` the skill's version. The person installs
 * it from Kehikot's Skills window (and Settings keeps it in step); this module installs nothing.
 *
 * The version is the first twelve hex digits of the sha256 of the text with the origin filled in
 * and `{{version}}` still unfilled, so a changed template or a moved port makes an installed copy
 * "outdated" and the host's sync brings it level. The same scheme as the Claude module's skills.
 *
 * A skill a person installs is user-level: it cannot ship agent files. So the skill is the
 * orchestrator — the conversation it runs in starts each subagent with a prompt given inline — and
 * the prompts come from this module, one step at a time (job/steps.ts).
 *
 * `/review-factory` is kehikko-bound (protocol 2.12.0, `needs`): it drafts into Review, so it
 * makes sense only on a kehikko that has Review as well as Factory. A host never installs it
 * for every conversation; the Claude module loads it into a conversation whose kehikko has both,
 * and the skill checks again at run time (`kehikkoCheck` in review-factory.ts). `/factory` needs
 * nothing beside Factory and stays unbound.
 */

export const PLUGIN_DIR = join(import.meta.dirname, 'plugin')
export const ORIGIN_SLOT = '{{origin}}'
export const VERSION_SLOT = '{{version}}'

const OFFERED = [
  {
    name: 'factory',
    summary:
      'Type /factory <feature> to run a software factory: spec, chosen review angles, a build in its own worktree, counter-arguments and a judge.',
  },
  {
    name: 'review-factory',
    summary:
      'Type /review-factory on a pull or merge request: two chosen angles, two reviewers, an adversary and a judge, the checklist to the letter, and a draft in Review you send yourself.',
    needs: [REVIEW],
  },
] as const satisfies readonly { name: string; summary: string; needs?: readonly string[] }[]

const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

let served = originFor(preferred(PREFERRED_PORT))

/** Say the origin this process is really on (`http://127.0.0.1:<port>`). Refuses anything else. */
export function serveFrom(origin: string): void {
  if (!LOOPBACK_ORIGIN.test(origin)) throw new Error(`not a loopback origin: ${JSON.stringify(origin)}`)
  served = origin
}

export const servedOrigin = (): string => served

export function skillTemplate(name: string): string | null {
  if (!OFFERED.some((one) => one.name === name)) return null
  return readFileSync(join(PLUGIN_DIR, 'skills', name, 'SKILL.md'), 'utf8')
}

const sha12 = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** A template filled in for one origin: the text as served, and its version. */
export function fill(template: string, origin: string): { text: string; version: string } {
  const placed = template.replaceAll(ORIGIN_SLOT, origin)
  const version = sha12(placed)
  return { text: placed.replaceAll(VERSION_SLOT, version), version }
}

export function skillText(name: string, origin = served): string | null {
  const template = skillTemplate(name)
  return template === null ? null : fill(template, origin).text
}

export function skillDeclarations(origin = served): ModuleSkill[] {
  return OFFERED.map((one) => ({
    name: one.name,
    summary: one.summary,
    version: fill(skillTemplate(one.name)!, origin).version,
    ...('needs' in one ? { needs: [...one.needs] } : {}),
  }))
}

/** The skill a path asks for, or null for a path that is not one of ours (or text that would not pass). */
export function skillAt(path: string): { name: string; text: string } | null {
  for (const one of OFFERED) {
    if (skillPath(one.name) !== path) continue
    const text = skillText(one.name)
    if (text === null || skillTextIssue(text, one.name)) return null
    return { name: one.name, text }
  }
  return null
}

export const isSkillPath = (path: string): boolean => OFFERED.some((one) => skillPath(one.name) === path)

/** The doors this module answers: the protocol's three, `/api/*`, and its skills. For the dev server and the built one alike. */
export const ours = (path: string): boolean => path === '/healthz' || path === '/mcp' || path.startsWith('/api/') || isSkillPath(path)
