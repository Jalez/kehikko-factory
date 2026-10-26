import { readTrackerRef, type ServerMethod } from 'kehikot-module-protocol'
import { askHost, type AskedHost } from 'kehikot-module-protocol/serve'

import { ID } from '../manifest.ts'
import type { Remote } from '../tracker.ts'
import type { Target } from './forge.ts'

/**
 * The vision a change is judged against: the epic that holds its ref — its title, lede, callout,
 * parts — and the goal and how we'll know from whichever module keeps its steps, with the appetite,
 * the rabbit holes and the no-gos when the epic's material says them. Asked of the host by this
 * module's server (protocol 2.21.0, `askHost`): `epics.list` and `epic.get` (`epics:read`),
 * `steps.list` (`steps:read`) and `parts.get` (`parts:read`), the answers this module's page would
 * get. No file of the host's or of another module's is read, so it works with no page open.
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

/** One question to the host about one project: `askHost`, or a stand-in in the tests. */
export type HostAsk = <M extends ServerMethod>(method: M, params: Record<string, unknown>, project: string) => Promise<AskedHost<M>>

/** The real one: this module asks, about the project it names. */
export const askTheHost: HostAsk = (method, params, project) => askHost(method, params, { module: ID, project })

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [])

/** What the host says of one epic: its material (`epic.get`), its steps (`steps.list`) and its parts (`parts.get`), each null when not answered. */
interface Said {
  epic: Record<string, unknown> | null
  steps: { refs?: unknown; related?: unknown }[]
  providers: { goal?: string; measure?: string }[]
  parts: { heading: string; refs: string[] }[]
}

async function said(ask: HostAsk, root: string, slug: string): Promise<Said> {
  const [epic, steps, parts] = await Promise.all([ask('epic.get', { epic: slug }, root), ask('steps.list', { epic: slug }, root), ask('parts.get', { epic: slug }, root)])
  return {
    epic: epic.ok && epic.data && typeof epic.data === 'object' ? epic.data : null,
    steps: steps.ok ? (steps.data.steps ?? []) : [],
    providers: steps.ok ? (steps.data.providers ?? []) : [],
    parts: parts.ok ? parts.data.parts : [],
  }
}

/** Every ref an epic names: its umbrella, its steps' (delivering and related), its parts' and the groups its material lists. */
function refsOf(one: Said): string[] {
  const out: string[] = []
  if (typeof one.epic?.umbrella === 'string') out.push(one.epic.umbrella)
  for (const step of one.steps) out.push(...strings(step.refs), ...strings(step.related))
  for (const part of one.parts) out.push(...part.refs)
  for (const key of ['steps', 'groups']) {
    for (const entry of Array.isArray(one.epic?.[key]) ? (one.epic[key] as Record<string, unknown>[]) : []) out.push(...strings(entry?.refs))
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

/** The slug of the epic that holds the change's ref, or null: the project's epics, in the host's order, asked one by one. */
export async function epicOf(root: string, target: Target, origin: Remote | null, ask: HostAsk = askTheHost): Promise<string | null> {
  const listed = await ask('epics.list', {}, root)
  if (!listed.ok) return null
  for (const { slug } of listed.data.epics) {
    if (refsOf(await said(ask, root, slug)).some((ref) => namesChange(ref, target, origin))) return slug
  }
  return null
}

const text = (value: unknown, max = 2000): string => (typeof value === 'string' ? value.slice(0, max) : '')

/** The vision of one epic, or null when the host has no such epic (or no host answered). */
export async function visionOf(root: string, slug: string, ask: HostAsk = askTheHost): Promise<Vision | null> {
  const one = await said(ask, root, slug)
  const epic = one.epic
  if (!epic) return null
  const pick = (key: string) => text(epic[key])
  const parts = strings(one.parts.map((part) => part.heading).filter(Boolean))
  const vision: Vision = { epic: slug, title: pick('title') || slug, lede: pick('lede'), callout: pick('callout'), parts: [...new Set(parts)].slice(0, 40) }
  /* The goal and how we'll know: the first steps provider's that says them, else the epic's own words. */
  const goal = one.providers.find((provider) => provider.goal)?.goal ?? text(epic.goal)
  const measure = one.providers.find((provider) => provider.measure)?.measure ?? text(epic.measure)
  if (goal) vision.goal = text(goal)
  if (measure) vision.measure = text(measure)
  if (text(epic.appetite)) vision.appetite = text(epic.appetite)
  for (const key of ['rabbitHoles', 'noGos'] as const) if (strings(epic[key]).length) vision[key] = strings(epic[key]).slice(0, 20)
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
