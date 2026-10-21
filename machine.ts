import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The two machine-level places Factory reads or keeps something, spelled once:
 *
 *  - `keys/review-factory.key` — the per-install secret Review creates (C4), which lets Factory, and
 *    only Factory, send a two-way review the person allowed it to send. Read, never written.
 *    `KEHIKOT_KEYS_DIR` overrides the folder.
 *  - `factory/author-rules.json` — re-review rules a person said are "for all projects". Written
 *    only from the person's press. `KEHIKOT_FACTORY_DIR` overrides the folder.
 *
 * Both under Kehikot's machine folder (`~/Library/Application Support/Kehikot` on macOS,
 * `$XDG_DATA_HOME/kehikot` elsewhere), the same root the registry is in.
 */

export function machineDir(env: Record<string, string | undefined> = process.env): string {
  const home = env.HOME || homedir()
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Kehikot') // kehikot-storage: allow Kehikot's machine folder (keys, Factory's cross-project author rules)
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'kehikot') // kehikot-storage: allow Kehikot's machine folder off macOS
}

export const keysDir = (env: Record<string, string | undefined> = process.env): string => env.KEHIKOT_KEYS_DIR || join(machineDir(env), 'keys')

export const factoryMachineDir = (env: Record<string, string | undefined> = process.env): string => env.KEHIKOT_FACTORY_DIR || join(machineDir(env), 'factory')

export const REVIEW_FACTORY_KEY = 'review-factory.key'

/** Review's key for Factory, or null when Review has not made one (or it is not 64 hex digits). */
export function readFactoryKey(env: Record<string, string | undefined> = process.env): string | null {
  const path = join(keysDir(env), REVIEW_FACTORY_KEY)
  try {
    if (!existsSync(path)) return null
    const key = readFileSync(path, 'utf8').trim()
    return /^[0-9a-f]{64}$/.test(key) ? key : null
  } catch {
    return null
  }
}
