import { describe, expect, test } from 'bun:test'
import { isKehikkoBound, moduleSkillsSchema, skillPath, skillTextIssue } from 'kehikot-module-protocol'

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

describe('the /review-factory skill', () => {
  const review = skillTemplate('review-factory')!

  test('is kehikko-bound: it needs Review on the kehikko; /factory needs nothing', () => {
    const [factory, review] = skillDeclarations('http://127.0.0.1:8040')
    expect(review).toMatchObject({ name: 'review-factory', needs: ['kehikot.review'] })
    expect(isKehikkoBound(review!)).toBe(true)
    expect('needs' in factory!).toBe(false)
    expect(isKehikkoBound(factory!)).toBe(false)
    expect(moduleSkillsSchema.safeParse(skillDeclarations('http://127.0.0.1:8040')).success).toBe(true)
  })

  test('is declared beside /factory, and passes skillTextIssue with the origin filled in', () => {
    expect(skillDeclarations('http://127.0.0.1:8040').map((one) => one.name)).toEqual(['factory', 'review-factory'])
    const text = skillText('review-factory', 'http://127.0.0.1:18041')!
    expect(skillTextIssue(text, 'review-factory')).toBeNull()
    expect(text).toContain('http://127.0.0.1:18041/api/review/say')
    expect(text).not.toContain('{{origin}}')
    expect(review).not.toMatch(/127\.0\.0\.1:\d/)
    expect(skillAt(skillPath('review-factory'))?.name).toBe('review-factory')
  })

  test('only a person runs it, and it may run curl and echo without asking — nothing wider', () => {
    const head = frontMatter(review)
    expect(head).toContain('disable-model-invocation: true')
    expect(/allowed-tools:\s*(.+)/.exec(head)![1]!.split(/,\s*/)).toEqual(['Bash(curl:*)', 'Bash(echo:*)'])
    expect(head).not.toMatch(/Bash\(gh|Bash\(glab|Bash\(git|mcp__/)
  })

  test('its one ! line cannot fail, and the conductor is told it posts nothing', () => {
    const bang = review.split('\n').find((line) => line.startsWith('!`'))!
    expect(bang).toContain('--retry-connrefused')
    expect(bang).toMatch(/\|\| echo "\[no answer from \{\{origin\}\}\]"`$/)
    expect(review).toContain('Never post, approve, comment on, merge or close the change')
  })
})
