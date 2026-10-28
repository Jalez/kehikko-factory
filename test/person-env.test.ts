import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { realSpawner } from '../rev/background.ts'

describe('a re-review session this module starts', () => {
  test('runs the person’s bun, not the one the host put first on this module’s PATH', async () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'factory-person-env-')))
    try {
      /* The host's shim and Bun's own node shim, each a `bun` that is this module's runtime. */
      const hostShim = join(scratch, 'kehikot-bun-1')
      const bunNode = join(scratch, 'bun-node-502-x')
      for (const dir of [hostShim, bunNode]) {
        mkdirSync(dir)
        symlinkSync(process.execPath, join(dir, 'bun'))
      }
      symlinkSync(process.execPath, join(bunNode, 'node'))
      /* The person's: a `bun` that says so, and a stand-in `claude` that writes down what it sees. */
      const person = join(scratch, 'person')
      mkdirSync(person)
      writeFileSync(join(person, 'bun'), '#!/bin/sh\necho person-bun\n')
      const seen = join(scratch, 'seen')
      writeFileSync(join(person, 'claude'), `#!/bin/sh\n{ command -v bun; bun --version; echo "\${BUN_BE_BUN-unset}"; } > "${seen}.part"\nmv "${seen}.part" "${seen}"\n`)
      chmodSync(join(person, 'bun'), 0o755)
      chmodSync(join(person, 'claude'), 0o755)
      const env = {
        PATH: [bunNode, hostShim, person, '/usr/bin', '/bin'].join(delimiter),
        KEHIKOT_HOST_PATH: hostShim,
        BUN_BE_BUN: '1',
      }
      const started = await realSpawner('claude', ['--bg'], scratch, env)
      expect(started.ok).toBe(true)
      for (let tries = 0; tries < 50 && !existsSync(seen); tries += 1) await new Promise((done) => setTimeout(done, 50))
      expect(readFileSync(seen, 'utf8')).toBe(`${join(person, 'bun')}\nperson-bun\nunset\n`)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
