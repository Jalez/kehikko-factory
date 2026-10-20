import { join } from 'node:path'

import * as review from '../review/prompts.ts'
import { LAST_AUTOMATIC_ROUND, type Angle, type Job } from './shape.ts'

/**
 * What each agent of the factory is told. The spec writer and the builder are Factory's own; the
 * planner of angles, the reviewers, the counter-arguers and the judge are the shared review
 * machinery (`review/prompts.ts`), given this job's files through `subjectOf`. One function per role, each a whole prompt a fresh subagent can act on with nothing else — where the files are,
 * what to read, what to write, and the few lines whose shape the module reads back (`parse.ts`).
 *
 * The roles: a spec writer, a planner who chooses the review angles, a builder, one reviewer per
 * angle, one counter-arguer per review that asks for changes, and a judge who rules on every point
 * and has the last word.
 */

export interface Where {
  /** The project's folder (its main checkout). */
  root: string
  /** The job's folder under `.kehikot/factory/jobs/`. */
  dir: string
}

const file = (where: Where, name: string) => join(where.dir, name)

const SCREEN =
  'Looking at the running app: if this conversation has a Kehikot Browser module connected (its MCP tools, which open and read pages '
  + 'in the person\'s Kehikot), you may use them to look at what you need to see. If no such tools are connected, do not install a '
  + 'browser or any other tool for it: skip the screen check and say in your file that you skipped it and why.'

const ONLY_YOURS =
  'Write only the file this prompt names. Never edit, move or delete any other file under .kehikot/, and never write job.json: the Factory '
  + 'module keeps the job\'s state.'

export function specPrompt(job: Job, where: Where): string {
  return [
    `You are the spec writer of a software factory. The person asked for this feature, in their words:`,
    '',
    quote(job.feature),
    '',
    `The project is the git repository at ${where.root}. Read whatever of it you need to understand where the feature fits: `
      + 'its README, the code the feature touches, its tests. Do not change any file in the project.',
    '',
    `Write ${file(where, 'spec.md')}, a short spec a builder can work from and a reviewer can check against:`,
    '',
    '- `# <a title of a few words>` on the first line.',
    '- `## Goal`: what the person gets, in two or three sentences.',
    '- `## Must`: a numbered list of what the finished change must do, each one something a reviewer can check by reading the code or running it.',
    '- `## Not in this change`: what is deliberately left out.',
    '- `## Assumptions`: where the request was open, what you assumed and why. Do not stop to ask: assume, and say so here.',
    '',
    'Keep it to what was asked. A spec that grows the feature makes every later step longer.',
    '',
    ONLY_YOURS,
  ].join('\n')
}

export function planPrompt(job: Job, where: Where): string {
  return review.anglesPrompt(subjectOf(job, where), job.anglesAsked, `The project: ${where.root} (read only; do not change it).`)
}

/** A job's review, as the shared machinery in review/ sees it: where the spec, the notes, the change and each file are. */
export function subjectOf(job: Job, where: Where): review.Subject {
  const git = job.git
  return {
    spec: file(where, 'spec.md'),
    notes: file(where, 'build.md'),
    change: git ? `\`git -C ${git.worktree} diff ${git.base}...${git.branch}\`` : 'the branch, once it is built',
    round: job.round,
    lastRound: LAST_AUTOMATIC_ROUND,
    files: {
      plan: file(where, 'plan.md'),
      review: (angle) => file(where, `round-${job.round}/review-${angle}.md`),
      counter: (angle) => file(where, `round-${job.round}/counter-${angle}.md`),
      judgement: file(where, `round-${job.round}/judgement.md`),
      ...(job.round > 1 ? { previousJudgement: file(where, `round-${job.round - 1}/judgement.md`) } : {}),
    },
    only: ONLY_YOURS,
    screen: SCREEN,
    after: 'You do not merge; the Factory does, or hands it to the person.',
  }
}

export function buildPrompt(job: Job, where: Where): string {
  const git = job.git!
  const again = job.round > 1
  const required = review.requiredList(job.required)
  return [
    `You are the builder of a software factory${again ? `, back for round ${job.round}` : ''}.`,
    '',
    `Work ONLY in the worktree ${git.worktree}, which is on the branch ${git.branch} (made from ${git.main}). Never touch the project's `
      + `main checkout at ${where.root}, never switch branches, and never merge or push: merging is decided after review.`,
    '',
    `Read the spec (${file(where, 'spec.md')}) and the plan (${file(where, 'plan.md')}).`,
    ...(again
      ? [
          '',
          `Your earlier work is already on the branch; ${file(where, 'build.md')} says what it was.`,
          ...(required.length
            ? [
                `The judge read the reviews of round ${job.round - 1} and ruled these points REQUIRED. Address each one, and nothing the judge `
                  + `did not require (the reasons are in ${file(where, `round-${job.round - 1}/judgement.md`)}):`,
                ...required,
              ]
            : []),
          ...(job.note ? ['', 'The person sent the job back with this note. It comes first:', quote(job.note)] : []),
        ]
      : []),
    '',
    'Make the change, following the project\'s own conventions. Run its tests (and its type check or linter, if it has one) in the '
      + 'worktree and fix what you broke. Commit your work on the branch with clear messages; leave nothing uncommitted.',
    '',
    SCREEN,
    '',
    `Then ${again ? 'add' : 'write'} a section \`## Round ${job.round}\` ${again ? 'at the end of' : 'in'} ${file(where, 'build.md')}: what you changed and `
      + `where, how you tested it (the commands and what they said), the commits, and anything in the spec${again ? ' or the required points' : ''} you `
      + 'did not do, with why. A reviewer reads this before the diff.',
    '',
    `Write only build.md under .kehikot/, never job.json. If you cannot build it at all, say why in build.md and stop.`,
  ].join('\n')
}

export function reviewPrompt(job: Job, where: Where, angle: Angle): string {
  return review.reviewerPrompt(subjectOf(job, where), angle)
}

export function counterPrompt(job: Job, where: Where, angle: Angle): string {
  return review.counterPrompt(subjectOf(job, where), angle)
}

export function judgePrompt(job: Job, where: Where, contested: readonly string[]): string {
  return review.judgePrompt(subjectOf(job, where), job.angles, contested)
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}
