import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { factoryMachineDir } from '../machine.ts'
import type { Result } from '../store.ts'
import { parseRule, type Rule } from './rerev.ts'
import { readJsonFile, writeJsonFile } from './store.ts'

/**
 * Per-author re-review rules: this project's (`.kehikot/factory/review-authors.json`), over the
 * ones the person said are for all projects (`author-rules.json` in Factory's machine folder). Each
 * keeps the sentence the person gave and its parsed form. Written only from the person's press or
 * typed command; an agent's door cannot reach them.
 *
 * The first time a change from an author with no rule needs a re-review, Factory asks:
 * `review-questions.json` holds the question, the page puts it in the Inbox and on the card, with
 * the project's default rule as the one-press answer.
 */

export interface AuthorRule {
  author: string
  sentence: string
  rule: Rule
  allProjects: boolean
  at: string
}

interface RulesFile {
  version: 1
  rules: Record<string, AuthorRule>
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/
const MACHINE_FILE = 'author-rules.json'

const empty = (): RulesFile => ({ version: 1, rules: {} })

function readMachine(): RulesFile {
  const path = join(factoryMachineDir(), MACHINE_FILE)
  try {
    if (!existsSync(path)) return empty()
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as RulesFile
    return parsed && typeof parsed.rules === 'object' ? parsed : empty()
  } catch {
    return empty()
  }
}

function writeMachine(file: RulesFile): void {
  const dir = factoryMachineDir()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, MACHINE_FILE)
  writeFileSync(`${path}.${process.pid}.tmp`, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  renameSync(`${path}.${process.pid}.tmp`, path)
}

const own = (file: RulesFile, author: string): AuthorRule | null => (Object.hasOwn(file.rules, author) ? file.rules[author]! : null)

export function ruleFor(root: string, author: string): AuthorRule | null {
  const project = readJsonFile<RulesFile>(root, 'review-authors', empty())
  return own(project, author) ?? own(readMachine(), author)
}

export function listRules(root: string): AuthorRule[] {
  const project = readJsonFile<RulesFile>(root, 'review-authors', empty())
  const machine = readMachine()
  const all = { ...machine.rules, ...project.rules }
  return Object.values(all).sort((a, b) => a.author.localeCompare(b.author))
}

export function setRule(root: string, author: string, sentence: string, allProjects: boolean, now: string): Result<AuthorRule> {
  if (!LOGIN.test(author)) return { ok: false, error: `"${author.slice(0, 60)}" is not a login.` }
  const parsed = parseRule(sentence)
  if (!parsed.ok) return { ok: false, error: parsed.why }
  const rule: AuthorRule = { author, sentence: sentence.trim().slice(0, 300), rule: parsed.rule, allProjects, at: now }
  const project = readJsonFile<RulesFile>(root, 'review-authors', empty())
  project.rules[author] = rule
  const written = writeJsonFile(root, 'review-authors', project)
  if (!written.ok) return written
  if (allProjects) {
    const machine = readMachine()
    machine.rules[author] = rule
    writeMachine(machine)
  }
  return { ok: true, value: rule }
}

export interface Question {
  author: string
  ref: string
  url: string
  run: string
  askedAt: string
}

export function readQuestions(root: string): Question[] {
  const file = readJsonFile<{ questions?: Question[] }>(root, 'review-questions', {})
  return Array.isArray(file.questions) ? file.questions.filter((one) => one && typeof one.author === 'string') : []
}

/** Ask once per author; true when this asked. */
export function ask(root: string, question: Question): boolean {
  const all = readQuestions(root)
  if (all.some((one) => one.author === question.author)) return false
  writeJsonFile(root, 'review-questions', { version: 1, questions: [...all, question] })
  return true
}

export function answered(root: string, author: string): void {
  writeJsonFile(root, 'review-questions', { version: 1, questions: readQuestions(root).filter((one) => one.author !== author) })
}

export const questionText = (author: string): string => `We haven't reviewed ${author}'s work before. What's the signal that they're ready for another review?`
