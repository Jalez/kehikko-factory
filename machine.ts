import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The one machine-level place Build Pipeline keeps something, spelled once:
 *
 *  - `factory/author-rules.json` — re-review rules a person said are "for all projects". Written
 *    only from the person's press. `KEHIKOT_FACTORY_DIR` overrides the folder.
 *
 * Under Kehikot's machine folder (`~/Library/Application Support/Kehikot` on macOS,
 * `$XDG_DATA_HOME/kehikot` elsewhere), the same root the registry is in.
 */

export function machineDir(env: Record<string, string | undefined> = process.env): string {
  const home = env.HOME || homedir()
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Kehikot')
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'kehikot')
}

export const factoryMachineDir = (env: Record<string, string | undefined> = process.env): string => env.KEHIKOT_FACTORY_DIR || join(machineDir(env), 'factory')
