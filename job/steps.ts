import { buildPrompt, counterPrompt, judgePrompt, planPrompt, reviewPrompt, specPrompt, type Where } from './prompts.ts'
import { describeStage } from './flow.ts'
import type { Angle, Job } from './shape.ts'

/**
 * What the conversation running `/factory` is told to do next, as plain text it follows: which
 * subagents to start (all at once when there are several), each with its whole prompt, and the one
 * command that reports back. The answer to that report is the next step, until one says "Stop."
 *
 * Every answer begins with `SAID`, so the skill can tell this module's answer from anything else on
 * the port.
 */

export const SAID = 'Factory:'
export const STOP = 'Stop.'

export interface Agent {
  /** Who it is, for the person watching: "reviewer (security)". */
  label: string
  prompt: string
}

export interface Step {
  stage: Job['stage']
  round: number
  agents: Agent[]
}

/** The step a running job is at: the agents it needs. `only` limits a review or counter step to some angles. */
export function stepFor(job: Job, where: Where, only: readonly string[] | null = null, contested: readonly string[] = []): Step | null {
  const pick = (angles: readonly Angle[]) => (only ? angles.filter((one) => only.includes(one.id)) : angles)
  switch (job.stage) {
    case 'spec':
      return { stage: 'spec', round: 0, agents: [{ label: 'spec writer', prompt: specPrompt(job, where) }] }
    case 'plan':
      return { stage: 'plan', round: 0, agents: [{ label: 'planner', prompt: planPrompt(job, where) }] }
    case 'build':
      return { stage: 'build', round: job.round, agents: [{ label: `builder (round ${job.round})`, prompt: buildPrompt(job, where) }] }
    case 'review':
      return {
        stage: 'review',
        round: job.round,
        agents: pick(job.angles).map((angle) => ({ label: `reviewer (${angle.id})`, prompt: reviewPrompt(job, where, angle) })),
      }
    case 'counter':
      return {
        stage: 'counter',
        round: job.round,
        agents: pick(job.angles.filter((one) => contested.includes(one.id))).map((angle) => ({
          label: `counter-arguer (${angle.id})`,
          prompt: counterPrompt(job, where, angle),
        })),
      }
    case 'judge':
      return { stage: 'judge', round: job.round, agents: [{ label: `judge (round ${job.round})`, prompt: judgePrompt(job, where, contested) }] }
    default:
      return null
  }
}

/** The command that reports a step done, or failed with `failed`. Plain curl, nothing a shell has to expand. */
export function reportCommand(origin: string, input: { project: string; job: string; step: string; round: number; session: string }, failed = false): string {
  const pairs: [string, string][] = [
    ['project', input.project],
    ['job', input.job],
    ['step', input.step],
    ['round', String(input.round)],
    ['session', input.session],
  ]
  if (failed) pairs.push(['failed', 'WHAT WENT WRONG'])
  const data = pairs.map(([key, value]) => `--data-urlencode "${key}=${value.replace(/["\\$`]/g, '')}"`).join(' ')
  return `curl -s -m 120 -X POST -G ${data} -w '\\n[curl exit %{exitcode}; HTTP %{http_code}]\\n' '${origin}/api/skill/done'`
}

/** A step as the text the conversation follows. `fix` is a sentence about what to put right first. */
export function instruct(job: Job, step: Step, ctx: { origin: string; project: string; session: string; fix?: string | null }): string {
  const many = step.agents.length > 1
  const ids = { project: ctx.project, job: job.id, step: step.stage, round: step.round, session: ctx.session }
  const out = [
    `${SAID} job ${job.id} — "${job.title}" — is at ${describeStage(job)}.`,
    ...(ctx.fix
      ? ['', `First: ${ctx.fix} If that subagent is in fact still running, do not start another: wait until it finishes, then run the REPORT again.`]
      : []),
    '',
    many
      ? `STEP: start these ${step.agents.length} subagents AT ONCE — one message with ${step.agents.length} Agent tool calls, so they run in parallel, each with `
        + 'subagent_type "general-purpose" and run_in_background false. Give each the prompt between its markers, word for word. Wait until every one has finished.'
      : 'STEP: start this subagent with the Agent tool, subagent_type "general-purpose" and run_in_background false. Give it the prompt between the markers, word for word, and wait until it has finished.',
    '',
  ]
  step.agents.forEach((agent, i) => {
    out.push(`--- subagent ${i + 1} of ${step.agents.length}: ${agent.label} ---`, agent.prompt, `--- end of subagent ${i + 1} ---`, '')
  })
  out.push(
    'Do not do their work yourself and do not edit the files they write.',
    '',
    `REPORT: when ${many ? 'all have' : 'it has'} finished, run this one command with the Bash tool, exactly as written:`,
    '',
    reportCommand(ctx.origin, ids),
    '',
    `If ${many ? 'a subagent' : 'the subagent'} could not do its job at all, run this instead, with WHAT WENT WRONG replaced by one line of plain words (no quotes, no $):`,
    '',
    reportCommand(ctx.origin, ids, true),
    '',
    'The answer is the next STEP, or ends with "Stop." — then tell the person that answer in a few lines and stop.',
  )
  return out.join('\n')
}

/** A final answer: what happened, for the person, and the word that ends the loop. */
export function stopped(lines: string[]): string {
  return [`${SAID} ${lines[0] ?? ''}`, ...lines.slice(1), '', STOP].join('\n')
}
