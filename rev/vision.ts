import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'

import { hostFile, legacyHostFile, readTrackerRef, within } from 'kehikot-module-protocol'
import { readJourney, readJourneys } from 'kehikot-module-protocol/serve'

import type { Remote } from '../tracker.ts'
import type { Target } from './forge.ts'

/**
 * The vision a change is judged against: the epic that holds its ref — its title, lede, callout,
 * parts — and, from Journeys, the goal, how we'll know, the appetite, the rabbit holes and the
 * no-gos when they are written. Read from the host's folder (`.kehikot/host/epics/`, which a module
 * may read and never writes; the pre-2.2 `.kehikot/kehikko/` as a fallback) and from Journeys' file
 * through the protocol's reader. Read only.
 */

export interface Vision {
  epic: string
  title: string
  lede: string
  callout: string
  parts: string[]
  goal?: string
  measure?: string
  appetite?: string
  rabbitHoles?: string[]
  noGos?: string[]
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/

function readEpic(root: string, file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file) || !within(realpathSync(root), realpathSync(file))) return null
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function epicSlugs(root: string): string[] {
  const out = new Set<string>()
  for (const dir of [hostFile(root, 'epics'), legacyHostFile(root, 'epics')]) {
    if (!dir || !existsSync(dir)) continue
    for (const name of readdirSync(dir)) if (name.endsWith('.json') && SLUG.test(name.slice(0, -5))) out.add(name.slice(0, -5))
  }
  for (const slug of Object.keys(((readJourneys(root) as { journeys?: Record<string, unknown> } | null)?.journeys ?? {}))) if (SLUG.test(slug)) out.add(slug)
  return [...out].sort()
}

function hostEpic(root: string, slug: string): Record<string, unknown> | null {
  return readEpic(root, hostFile(root, 'epics', `${slug}.json`)!) ?? readEpic(root, legacyHostFile(root, 'epics', `${slug}.json`)!)
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [])

/** Every ref an epic names: its umbrella, its steps', its parts' and its journey's. */
function refsOf(epic: Record<string, unknown> | null, journey: Record<string, unknown> | null): string[] {
  const out: string[] = []
  for (const source of [epic, journey]) {
    if (!source) continue
    if (typeof source.umbrella === 'string') out.push(source.umbrella)
    for (const key of ['steps', 'groups', 'parts']) {
      for (const one of Array.isArray(source[key]) ? (source[key] as Record<string, unknown>[]) : []) out.push(...strings(one?.refs))
    }
  }
  return out
}

/** Whether a ref spelling names this change. */
export function namesChange(ref: string, target: Target, origin: Remote | null): boolean {
  const read = readTrackerRef(ref.trim())
  if (!read || read.tracker !== target.forge || read.number !== target.number || read.kind === 'issue') return false
  const repo = read.repo ?? (origin && origin.kind === read.tracker ? origin.repo : null)
  return repo === target.repo
}

/** The slug of the epic that holds the change's ref, or null. */
export function epicOf(root: string, target: Target, origin: Remote | null): string | null {
  for (const slug of epicSlugs(root)) {
    const refs = refsOf(hostEpic(root, slug), readJourney(root, slug) as Record<string, unknown> | null)
    if (refs.some((ref) => namesChange(ref, target, origin))) return slug
  }
  return null
}

const text = (value: unknown, max = 2000): string => (typeof value === 'string' ? value.slice(0, max) : '')

export function visionOf(root: string, slug: string): Vision | null {
  const epic = hostEpic(root, slug)
  const journey = readJourney(root, slug) as Record<string, unknown> | null
  if (!epic && !journey) return null
  const pick = (key: string) => text(epic?.[key]) || text(journey?.[key])
  const parts = [...strings((epic?.parts as { name?: unknown }[] | undefined)?.map((one) => one?.name)), ...strings((journey?.groups as { heading?: unknown }[] | undefined)?.map((one) => one?.heading))]
  const vision: Vision = { epic: slug, title: pick('title') || slug, lede: pick('lede'), callout: pick('callout'), parts: [...new Set(parts)].slice(0, 40) }
  for (const key of ['goal', 'measure', 'appetite'] as const) if (text(journey?.[key])) vision[key] = text(journey?.[key])
  for (const key of ['rabbitHoles', 'noGos'] as const) if (strings(journey?.[key]).length) vision[key] = strings(journey?.[key]).slice(0, 20)
  return vision
}

/** The vision as the packet says it, in markdown. */
export function visionText(vision: Vision | null): string {
  if (!vision) return 'This change is in no epic, so it is reviewed without a vision to weigh it against; the review says so.'
  const out = [`**${vision.title}** (epic \`${vision.epic}\`)`, '']
  if (vision.lede) out.push(vision.lede, '')
  if (vision.callout) out.push(`> ${vision.callout}`, '')
  if (vision.parts.length) out.push(`Parts: ${vision.parts.join(' · ')}`, '')
  if (vision.goal) out.push(`Goal: ${vision.goal}`)
  if (vision.measure) out.push(`How we'll know: ${vision.measure}`)
  if (vision.appetite) out.push(`Appetite: ${vision.appetite}`)
  if (vision.rabbitHoles?.length) out.push('Rabbit holes to stay out of:', ...vision.rabbitHoles.map((one) => `- ${one}`))
  if (vision.noGos?.length) out.push('No-gos:', ...vision.noGos.map((one) => `- ${one}`))
  return out.join('\n').trim()
}
