import { join } from 'node:path'

import { adversaryPrompt, diagramPrompt, panelJudgePrompt, panelPlannerPrompt, panelReviewerPrompt, type PanelSubject } from '../review/prompts.ts'
import { SAID, type Agent } from '../job/steps.ts'
import { describeRun } from './flow.ts'
import type { ReviewSettings, Run } from './shape.ts'
import { runDir } from './store.ts'

/**
 * What the conversation running `/review-factory` is told to do next: the subagents of one step,
 * each with its whole prompt, and the one command that reports back — the same shape as
 * `/factory`'s steps, so the same conductor rules hold. Every answer begins with `Factory:`.
 */

export const ONLY_REVIEW =
  'Write only the file this prompt names. Never edit, move or delete any other file under .kehikot/, never write run.json (the Factory '
  + 'module keeps the review\'s state), and change nothing in the checkout or in the project.'

export function runTestsSentence(settings: ReviewSettings, checkout: string): string | null {
  return settings.runTests
    ? `You may run ONLY this project's own test command, exactly as its AGENTS.md or CLAUDE.md names it, inside the checkout at ${checkout}, and cite what it said as evidence. Nothing else is executed: no other command, no install, no build.`
    : null
}

export function subjectFor(root: string, run: Run, settings: ReviewSettings): PanelSubject {
  const dir = runDir(root, run.id)!
  const at = (name: string) => join(dir, name)
  const checkout = run.checkout?.path ?? root
  return {
    change: `${run.change.ref} — ${run.change.title || run.change.url} (${run.change.url})`,
    packet: at('packet.md'),
    diff: at('diff.patch'),
    ...(run.round > 1 && run.pinned?.previousHead ? { delta: at('delta.patch') } : {}),
    checkout,
    head: run.pinned?.head ?? 'the head',
    files: {
      plan: at('plan.md'),
      review: (angle) => at(`review-${angle}.md`),
      points: at('points.md'),
      challenge: at('challenge.md'),
      judgement: at('judgement.md'),
      diagrams: at('diagrams.md'),
      briefing: at('briefing.md'),
    },
    budget: { pointsPerReviewer: run.budget?.pointsPerReviewer ?? 6, filesBeyondDiff: run.budget?.filesBeyondDiff ?? 10 },
    runTests: runTestsSentence(settings, checkout),
    round: run.round,
    listed: run.listed,
    only: ONLY_REVIEW,
  }
}

/** Every checklist item of the run, as `<checklist>/<item>` with its words. */
export function itemsOf(run: Pick<Run, 'checklists'>): { checklist: string; item: string; text: string }[] {
  return run.checklists.flatMap((list) => list.items.map((item) => ({ checklist: list.id, item: item.id, text: item.text })))
}

export function agentsFor(root: string, run: Run, settings: ReviewSettings, input: { doorRule: string | null; project: string; only?: readonly string[] | null }): Agent[] {
  const subject = subjectFor(root, run, settings)
  const items = itemsOf(run)
  const closeAsked = run.closeVotes.reviewers.some(Boolean)
  switch (run.stage) {
    case 'planning': {
      const asked = run.plan?.angles.some((one) => one.by === 'person') ? run.plan.angles.map((one) => one.id) : null
      return [{ label: 'planner', prompt: panelPlannerPrompt(subject, { doorRule: input.doorRule, items, asked }) }]
    }
    case 'reviewing':
      return (run.plan?.angles ?? [])
        .filter((angle) => !input.only || input.only.includes(angle.id))
        .map((angle) => ({
          label: `reviewer (${angle.id})`,
          prompt: panelReviewerPrompt(subject, angle, items.filter((one) => angle.items.includes(`${one.checklist}/${one.item}`))),
        }))
    case 'challenging':
      return [{ label: 'adversary', prompt: adversaryPrompt(subject, { closeAsked }) }]
    case 'judging':
      return [
        {
          label: 'judge',
          prompt: panelJudgePrompt(subject, { vision: !!run.vision?.epic, oneWay: run.plan?.door.kind !== 'two-way', challenged: run.challenges.length > 0, closeAsked }),
        },
      ]
    case 'diagrams':
      return [{ label: 'diagram drawer', prompt: diagramPrompt(subject, { project: input.project, epic: run.vision?.epic ?? '', requests: run.judged?.diagrams ?? [], runId: run.id }) }]
    default:
      return []
  }
}

export function reviewReportCommand(origin: string, input: { project: string; run: string; step: string; session: string }, failed = false): string {
  const pairs: [string, string][] = [
    ['project', input.project],
    ['run', input.run],
    ['step', input.step],
    ['session', input.session],
  ]
  if (failed) pairs.push(['failed', 'WHAT WENT WRONG'])
  const data = pairs.map(([key, value]) => `--data-urlencode "${key}=${value.replace(/["\\$`]/g, '')}"`).join(' ')
  return `curl -s -m 300 -X POST -G ${data} -w '\\n[curl exit %{exitcode}; HTTP %{http_code}]\\n' '${origin}/api/review/done'`
}

export function instructRun(run: Run, agents: readonly Agent[], ctx: { origin: string; project: string; session: string; fix?: string | null; lead?: string[] }): string {
  const many = agents.length > 1
  const ids = { project: ctx.project, run: run.id, step: run.stage, session: ctx.session }
  const out = [
    `${SAID} review ${run.id} of ${run.change.ref} — "${run.change.title}" — is ${describeRun(run)}.`,
    ...(ctx.lead?.length ? ['', ...ctx.lead] : []),
    ...(ctx.fix ? ['', `First: ${ctx.fix} If that subagent is in fact still running, do not start another: wait until it finishes, then run the REPORT again.`] : []),
    '',
    many
      ? `STEP: start these ${agents.length} subagents AT ONCE — one message with ${agents.length} Agent tool calls, so they run in parallel, each with `
        + 'subagent_type "general-purpose" and run_in_background false. Give each the prompt between its markers, word for word. Wait until every one has finished.'
      : 'STEP: start this subagent with the Agent tool, subagent_type "general-purpose" and run_in_background false. Give it the prompt between the markers, word for word, and wait until it has finished.',
    '',
  ]
  agents.forEach((agent, i) => out.push(`--- subagent ${i + 1} of ${agents.length}: ${agent.label} ---`, agent.prompt, `--- end of subagent ${i + 1} ---`, ''))
  out.push(
    'Do not do their work yourself and do not edit the files they write.',
    '',
    `REPORT: when ${many ? 'all have' : 'it has'} finished, run this one command with the Bash tool, exactly as written:`,
    '',
    reviewReportCommand(ctx.origin, ids),
    '',
    `If ${many ? 'a subagent' : 'the subagent'} could not do its job at all, run this instead, with WHAT WENT WRONG replaced by one line of plain words (no quotes, no $):`,
    '',
    reviewReportCommand(ctx.origin, ids, true),
    '',
    'The answer is the next STEP, or ends with "Stop." — then tell the person that answer in a few lines and stop.',
  )
  return out.join('\n')
}
