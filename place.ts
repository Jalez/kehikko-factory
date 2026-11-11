import { askTheHost, type HostAsk } from './rev/vision.ts'
import type { JobPlace } from './job/shape.ts'

/**
 * Where a job was started: the place the conversation is filed under, asked of the host by this
 * module's server (protocol 2.85.0, `sessions.placeOf` under `sessions:place`), which answers from the
 * records it already reads. No other module's file is read. A conversation filed under no place — or
 * no host, or a host too old to answer — is unplaced: never guessed from what is on screen.
 */

const SLUG = /^[a-z0-9-]{1,80}$/
const KEY = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/

export async function placeOfSession(root: string, session: string, ask: HostAsk = askTheHost): Promise<JobPlace | null> {
  if (!session) return null
  let asked: Awaited<ReturnType<HostAsk>>
  try {
    asked = await ask('sessions.placeOf', { session }, root)
  } catch {
    return null
  }
  if (!asked.ok) return null
  const said = (asked.data as { place?: { epic?: unknown; parts?: unknown; kehikko?: unknown } | null }).place
  if (!said || typeof said.epic !== 'string' || !SLUG.test(said.epic)) return null
  const place: JobPlace = { epic: said.epic }
  if (Array.isArray(said.parts)) {
    const parts = said.parts.filter((one): one is string => typeof one === 'string' && SLUG.test(one))
    if (parts.length) place.parts = parts
  }
  if (typeof said.kehikko === 'string' && KEY.test(said.kehikko)) place.kehikko = said.kehikko
  return place
}
