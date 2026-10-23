#!/usr/bin/env bun
import { run } from 'kehikot-module-protocol/run'
import { originFor } from 'kehikot-module-protocol/serve'

import { BUILD, MANIFEST, TICKET, answer, servingAt, stream } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'
import { ours } from './skills.ts'

/**
 * This module over its BUILT page (`bun run build`), on the same doors and the
 * same port. `run.sh` starts this when `dist/` carries a stamp of the commit
 * checked out, and Vite otherwise.
 *
 * Nothing this module says is decided here: the doors are `answer` and `stream` in
 * `doors.ts` (its skills among them, `ours`), mounted by the protocol's `run`
 * exactly as `doors()` mounts them on Vite. A build that is not this checkout's
 * is never served: `run` answers the page with a 503 saying which commit each
 * is, and the command to run.
 */
const running = await run({
  id: ID,
  prefer: PREFERRED_PORT,
  dir: import.meta.dirname,
  manifest: MANIFEST,
  answer,
  stream,
  build: BUILD,
  ticket: TICKET,
  ours,
})

/* The skills name the origin this module is really on, not the one it preferred (skills.ts). */
servingAt(originFor(running.port))
