import { describe, expect, test } from 'bun:test'
import { skillPath, skillTextIssue } from 'kehikot-module-protocol'

import { fill, skillAt, skillDeclarations, skillTemplate, skillText } from '../skills.ts'

const template = skillTemplate('factory')!
const frontMatter = (text: string) => text.split('---')[1]!

describe('the /factory skill', () => {
  test('passes skillTextIssue with the origin filled in, and names no port of its own', () => {
    const text = skillText('factory', 'http://127.0.0.1:18041')!
    expect(skillTextIssue(text, 'factory')).toBeNull()
    expect(text).toContain('http://127.0.0.1:18041/api/skill/say')
    expect(text).not.toContain('{{origin}}')
    expect(text).not.toContain('{{version}}')
    expect(template).not.toMatch(/127\.0\.0\.1:\d/)
  })

  test('only a person runs it, and it may run curl, echo and the board moves without asking — nothing wider', () => {
    const head = frontMatter(template)
    expect(head).toContain('disable-model-invocation: true')
    const allowed = /allowed-tools:\s*(.+)/.exec(head)![1]!.split(/,\s*/)
    expect(allowed).toEqual(['Bash(curl:*)', 'Bash(echo:*)', 'Bash(gh project item-add:*)', 'Bash(gh project item-edit:*)', 'Bash(glab issue update:*)'])
    expect(head).not.toMatch(/gh issue create|Bash\(gh:\*\)|Bash\(git/)
  })

  test('its one ! line cannot fail: it ends in echo', () => {
    const bang = template.split('\n').find((line) => line.startsWith('!`'))!
    expect(bang).toContain('--retry-connrefused')
    expect(bang).toMatch(/\|\| echo "\[no answer from \{\{origin\}\}\]"`$/)
    expect(bang).toContain('${CLAUDE_SESSION_ID}')
  })

  test('the version follows the text and the origin, and the manifest declares the version served', () => {
    const a = fill(template, 'http://127.0.0.1:8040')
    const b = fill(template, 'http://127.0.0.1:8041')
    expect(a.version).not.toBe(b.version)
    expect(a.text).toContain(`[skill ${a.version}]`)
    expect(skillDeclarations('http://127.0.0.1:8040')[0]).toMatchObject({ name: 'factory', version: a.version })
  })

  test('is served at the protocol\'s path', () => {
    expect(skillAt(skillPath('factory'))?.name).toBe('factory')
    expect(skillAt('/kehikot/skills/other.md')).toBeNull()
  })
})
