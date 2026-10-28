import { spawn, type ChildProcess } from 'node:child_process'

import { personEnv } from 'kehikot-module-protocol/serve'

/**
 * A re-review run without the person: a background Claude Code session started in the project,
 * typing `/review-factory resume <run>` — the same skill, the same conductor, the same caps. Only
 * when the person turned on "Re-review by myself" for the project, and at most `MAX_ROUNDS` per
 * change (rev/rerev.ts).
 *
 * The rules of kehikko-orchestrator's `start.ts` hold here: the program is fixed (`claude`), the
 * arguments are fixed except the name and the prompt, each one argv element (never a shell), the
 * prompt is made here from a run id this module minted, and "started" means the kernel said so.
 * The session outlives this module; Factory never stops it.
 */

const PROGRAM = 'claude'

export interface Started {
  ok: boolean
  argv?: string[]
  pid?: number
  error?: string
}

export type Spawner = (program: string, args: string[], cwd: string) => Promise<Started>

/**
 * The session gets this process's environment as the person's (`personEnv`): without the host's own
 * `bun` first on this module's PATH and `BUN_BE_BUN`, which in a session boot the host on every
 * `bun` it calls. A background session's environment is Claude Code's daemon's, so a daemon started
 * from here gets it, and one already running keeps what it had.
 */
export const realSpawner = async (program: string, args: string[], cwd: string, env: Record<string, string | undefined> = process.env): Promise<Started> => {
  let child: ChildProcess
  try {
    child = spawn(program, args, { cwd, detached: true, stdio: 'ignore', env: personEnv(env) })
  } catch (e) {
    return { ok: false, error: `${program} could not be started: ${e instanceof Error ? e.message : String(e)}` }
  }
  const settled = await new Promise<string | null>((done) => {
    child.once('spawn', () => done(null))
    child.once('error', (e: Error) => done(`${program} could not be started in ${cwd}: ${e.message}`))
  })
  child.unref()
  return settled ? { ok: false, error: settled } : { ok: true, pid: child.pid, argv: [program, ...args] }
}

const RUN = /^[a-z0-9][a-z0-9-]{0,46}-[0-9a-f]{4}$/

export function backgroundArgs(run: { id: string; change: { ref: string; title: string }; round: number }): string[] {
  if (!RUN.test(run.id)) throw new Error('not a run id')
  const name = `Re-review ${run.round}: ${run.change.ref} ${run.change.title}`.replace(/[\r\n]+/g, ' ').slice(0, 80)
  return ['--bg', `--name=${name}`, `/review-factory resume ${run.id}`]
}

export async function startBackground(root: string, run: { id: string; change: { ref: string; title: string }; round: number }, spawner: Spawner = realSpawner): Promise<Started> {
  return spawner(PROGRAM, backgroundArgs(run), root)
}
