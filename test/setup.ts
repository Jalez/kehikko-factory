import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * Tests never reach the real machine: no host is asked about a project (the tests answer through
 * `setNeeds`/`setHostResolve`, and anything that slips past asks a port nothing listens on), no
 * registration lands in the real registry, no transcript is read from the real ~/.claude, and the
 * git the tests run commits as a stand-in person with no global config.
 */
process.env.KEHIKOT_ORIGINS = 'http://127.0.0.1:9'
process.env.KEHIKOT_MODULES_DIR = mkdtempSync(join(tmpdir(), 'factory-registry-'))
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'factory-claude-'))
process.env.GIT_CONFIG_GLOBAL = '/dev/null'
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_AUTHOR_NAME = 'Test Person'
process.env.GIT_AUTHOR_EMAIL = 'test@example.invalid'
process.env.GIT_COMMITTER_NAME = 'Test Person'
process.env.GIT_COMMITTER_EMAIL = 'test@example.invalid'

/* A document for the tests that render one; the pure tests do not care. */
GlobalRegistrator.register()
