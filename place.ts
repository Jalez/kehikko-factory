import { existsSync, readFileSync, realpathSync } from 'node:fs'

import { moduleFile, within } from 'kehikot-module-protocol'

import type { JobPlace } from './job/shape.ts'

/**
 * Where a job was started: the place the Claude module has filed the conversation under, read from
 * its record in the project (`<project>/.kehikot/claude/places.json`). Read only — that file is the
 * Claude module's, and this module never writes it. A conversation listed under no place, or under
 * several with none of them holding it as current, is unplaced: never guessed from what is on screen.
 *
 * Still the Claude module's file and not the host's place record: protocol 2.21.0 lets a module's
 * server ask for an epic, its steps and its parts (`askHost`), but not for which place a
 * conversation is filed under. When `SERVER_METHODS` carries it, this asks instead.
 */

const CLAUDE_ID = 'kehikot.claude'

interface Recorded {
  epic?: unknown
  parts?: unknown
  kehikko?: unknown
  sessions?: unknown
  current?: unknown
}

const SLUG = /^[a-z0-9-]{1,80}$/

export function placeOfSession(root: string, session: string): JobPlace | null {
  if (!session) return null
  const file = moduleFile(root, CLAUDE_ID, 'places')
  if (!file || !existsSync(file)) return null
  let places: Record<string, Recorded>
  try {
    if (!within(root, realpathSync(file))) return null
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { places?: Record<string, Recorded> }
    places = parsed.places ?? {}
  } catch {
    return null
  }
  const holding = Object.values(places).filter((one) => Array.isArray(one.sessions) && one.sessions.includes(session))
  const chosen = holding.length === 1 ? holding[0] : holding.find((one) => one.current === session)
  if (!chosen) return null
  const place: JobPlace = {}
  if (typeof chosen.epic === 'string' && SLUG.test(chosen.epic)) place.epic = chosen.epic
  if (Array.isArray(chosen.parts)) {
    const parts = chosen.parts.filter((one): one is string => typeof one === 'string' && SLUG.test(one))
    if (parts.length) place.parts = parts
  }
  const kehikko = chosen.kehikko as { key?: unknown } | undefined
  if (kehikko && typeof kehikko.key === 'string' && /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(kehikko.key)) place.kehikko = kehikko.key
  return place.epic ? place : null
}
