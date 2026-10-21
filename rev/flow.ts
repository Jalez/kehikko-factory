import type { PanelResult } from '../review/panel.ts'
import { RUN_RUNNING, RUN_VERSION, type Budget, type Change, type ReviewStage, type Run, type RunAngle, type RunChecklist, type RunPoint, type RunWaitingWhy } from './shape.ts'

/**
 * How a review run moves. Pure: an event and the run as it is, in; the run as it becomes, or a
 * sentence saying why not, out. `review-factory.ts` gathers, reads what the agents wrote, validates,
 * drafts, and calls this; nothing else changes a run's stage.
 *
 *   queued → gathering → planning ──(proposed checklist: waits here for the person)──┐
 *                          └──────────────→ reviewing ←──── checklist accepted ──────┘
 *   reviewing → challenging → judging        (no point survived: straight to judging)
 *   judging → diagrams → waiting | sent      (diagrams only when asked for and possible)
 *   judging → waiting | sent
 *   anything running → waiting (moved on, stopped)
 */

export type RunEvent =
  | { kind: 'claim'; session: string }
  | { kind: 'gathering' }
  | {
      kind: 'gathered'
      pinned: NonNullable<Run['pinned']>
      checkout: NonNullable<Run['checkout']>
      budget: Budget
      change: Change
      vision: NonNullable<Run['vision']>
      checklists: RunChecklist[]
    }
  | { kind: 'planned'; plan: NonNullable<Run['plan']>; proposed: string[] | null; general: Run['general'] }
  | { kind: 'checklist'; checklists: RunChecklist[]; angles: RunAngle[] }
  | {
      kind: 'reviewed'
      points: RunPoint[]
      rejected: Run['rejected']
      skipped: string[]
      answers: Run['answers']
      reviewersClose: boolean[]
      notes: string[]
    }
  | { kind: 'challenged'; challenges: Run['challenges']; adversaryCloses: boolean }
  | { kind: 'judged'; result: PanelResult; visionFit: string; summary: string; close: { why: string; instead: string } | null; diagrams: NonNullable<Run['judged']>['diagrams']; drawable: boolean }
  | { kind: 'diagrammed'; diagrams: Run['diagrams']; notes: string[] }
  | { kind: 'drafted'; drafted: NonNullable<Run['drafted']>; notes: string[]; sent: boolean }
  | { kind: 'sent'; by: 'factory' | 'person' }
  | { kind: 'moved-on'; head: string }
  | { kind: 'stop'; why: string }
  | { kind: 'spent'; step: string; tokens: number; cached: number }
  | { kind: 'step-at'; at: string }
  | { kind: 'tried'; step: string }
  | { kind: 'angles'; angles: RunAngle[] }
  | { kind: 'budget'; budget: Budget }
  | { kind: 'note'; note: string }
  | { kind: 'archive' }

export type RunMoved = { ok: true; run: Run } | { ok: false; why: string }

export function newRun(input: { id: string; change: Change; session: string | null; place: Run['place']; now: string; round?: number; previous?: string | null; listed?: Run['listed']; background?: boolean }): Run {
  return {
    version: RUN_VERSION,
    id: input.id,
    createdAt: input.now,
    updatedAt: input.now,
    stage: 'queued',
    session: input.session,
    background: input.background ?? false,
    place: input.place,
    change: input.change,
    round: input.round ?? 1,
    previous: input.previous ?? null,
    listed: input.listed ?? [],
    pinned: null,
    checkout: null,
    budget: null,
    spend: [],
    stepAt: null,
    vision: null,
    checklists: [],
    proposed: null,
    plan: null,
    points: [],
    rejected: [],
    skipped: [],
    answers: [],
    closeVotes: { reviewers: [], adversary: false },
    challenges: [],
    judged: null,
    general: [],
    diagrams: [],
    drafted: null,
    sent: null,
    waiting: null,
    notes: [],
    tries: {},
    archived: false,
    history: [{ at: input.now, stage: 'queued', said: input.round && input.round > 1 ? `Queued for re-review, round ${input.round}.` : 'Queued.' }],
  }
}

export const runIsRunning = (run: Pick<Run, 'stage' | 'waiting'>): boolean => RUN_RUNNING.includes(run.stage) && run.waiting === null

/** Can the angles still be changed? Until the reviewers start. */
export const runAnglesOpen = (run: Pick<Run, 'stage'>): boolean => run.stage === 'queued' || run.stage === 'gathering' || run.stage === 'planning'

function to(run: Run, now: string, stage: ReviewStage, said: string, patch: Partial<Run> = {}): Run {
  return { ...run, ...patch, stage, updatedAt: now, history: [...run.history, { at: now, stage, said }].slice(-200) }
}

const waitFor = (run: Run, now: string, why: RunWaitingWhy, said: string, patch: Partial<Run> = {}, stage: ReviewStage = 'waiting'): Run =>
  to(run, now, stage, said, { ...patch, waiting: { why, said }, session: null })

const wrong = (run: Run, wanted: string) => ({ ok: false, why: `The review ${run.id} is ${describeRun(run)}, not ${wanted}.` }) as const

export function advanceRun(run: Run, event: RunEvent, now: string): RunMoved {
  const done = (next: Run): RunMoved => ({ ok: true, run: next })
  switch (event.kind) {
    case 'archive':
      if (run.stage !== 'waiting' && run.stage !== 'sent') return { ok: false, why: 'Only a review that is waiting for you or sent can be cleared from the board.' }
      return done({ ...run, archived: true, updatedAt: now })
    case 'note':
      return done({ ...run, notes: [...run.notes, event.note.slice(0, 600)].slice(-60), updatedAt: now })
    case 'spent':
      return done({ ...run, spend: [...run.spend.filter((one) => one.step !== event.step), { step: event.step, tokens: event.tokens, cached: event.cached }].slice(-40), updatedAt: now })
    case 'step-at':
      return done({ ...run, stepAt: event.at })
    case 'tried':
      return done({ ...run, tries: { ...run.tries, [event.step]: (run.tries[event.step] ?? 0) + 1 } })
    case 'budget':
      if (run.stage === 'waiting' && run.waiting?.why !== 'checklist') return { ok: false, why: 'This review has finished; its budget no longer matters.' }
      if (run.stage === 'sent') return { ok: false, why: 'This review was sent.' }
      return done({ ...run, budget: event.budget, updatedAt: now })
    case 'angles':
      if (!runAnglesOpen(run)) return { ok: false, why: 'The reviewers have started; the angles of this review are settled.' }
      if (event.angles.length !== 2) return { ok: false, why: 'A review has exactly two angles.' }
      return done({ ...run, plan: run.plan ? { ...run.plan, angles: event.angles } : run.plan, updatedAt: now, notes: [...run.notes, `You set the angles: ${event.angles.map((one) => one.id).join(', ')}.`] })
    case 'stop':
      if (run.stage === 'sent' || (run.stage === 'waiting' && run.waiting?.why !== 'question')) return { ok: false, why: `The review ${run.id} is ${describeRun(run)}; there is nothing to stop.` }
      return done(waitFor(run, now, 'stopped', `Stopped: ${event.why}`))
    case 'moved-on':
      if (run.stage === 'sent' || run.stage === 'waiting') return wrong(run, 'running')
      return done(waitFor(run, now, 'moved-on', `The change moved on to ${event.head.slice(0, 10)} after this review pinned ${run.pinned?.head.slice(0, 10) ?? 'its head'}. Nothing was drafted; re-run to review the new commits. The record is kept.`))
    case 'claim':
      if (run.stage === 'sent' || (run.stage === 'waiting' && run.waiting?.why !== 'checklist')) return wrong(run, 'queued or running')
      return done({ ...run, session: event.session, updatedAt: now })
    case 'gathering':
      if (run.stage !== 'queued') return wrong(run, 'queued')
      return done(to(run, now, 'gathering', 'Gathering the change, its epic and its checklists.'))
    case 'gathered':
      if (run.stage !== 'gathering') return wrong(run, 'gathering')
      return done(
        to(run, now, 'planning', `Gathered: ${event.budget.files} file${event.budget.files === 1 ? '' : 's'}, ${event.budget.lines} lines at ${event.pinned.head.slice(0, 10)}.`, {
          pinned: event.pinned,
          checkout: event.checkout,
          budget: run.budget ?? event.budget,
          change: event.change,
          vision: event.vision,
          checklists: event.checklists,
        }),
      )
    case 'planned': {
      if (run.stage !== 'planning') return wrong(run, 'planning')
      /* Angles the person set while the planner worked are theirs, and win. */
      const angles = run.plan?.angles.some((one) => one.by === 'person') ? run.plan.angles : event.plan.angles
      const plan = { ...event.plan, angles }
      const said = `Planned: ${angles.map((one) => one.id).join(' and ')}; ${plan.door.kind}${plan.uiux.touches ? ', touches what people see' : ''}.`
      if (event.proposed && !run.checklists.length) {
        return done(waitFor(run, now, 'checklist', `${said} The change has no checklist; the planner proposed ${event.proposed.length} items for you to accept or edit.`, { plan, proposed: event.proposed, general: event.general }, 'planning'))
      }
      return done(to(run, now, 'reviewing', said, { plan, general: event.general, proposed: null }))
    }
    case 'checklist':
      if (run.stage !== 'planning' || run.waiting?.why !== 'checklist' || !run.plan) return { ok: false, why: 'No proposed checklist is waiting for you on this review.' }
      return done(to(run, now, 'reviewing', 'You accepted the checklist; it is held against the change in Checklist.', { checklists: event.checklists, proposed: null, waiting: null, plan: { ...run.plan, angles: event.angles } }))
    case 'reviewed': {
      if (run.stage !== 'reviewing') return wrong(run, 'reviewing')
      const patch = {
        points: event.points,
        rejected: [...run.rejected, ...event.rejected],
        skipped: event.skipped,
        answers: event.answers,
        closeVotes: { ...run.closeVotes, reviewers: event.reviewersClose },
        notes: [...run.notes, ...event.notes].slice(-60),
      }
      const n = event.points.length
      if (!n) return done(to(run, now, 'judging', 'No point survived the rules; the judge rules on the checklist answers.', patch))
      return done(to(run, now, 'challenging', `${n} point${n === 1 ? '' : 's'} passed the rules${event.rejected.length ? `, ${event.rejected.length} did not` : ''}.`, patch))
    }
    case 'challenged':
      if (run.stage !== 'challenging') return wrong(run, 'being challenged')
      return done(
        to(run, now, 'judging', `${event.challenges.filter((one) => one.concede).length} conceded, ${event.challenges.filter((one) => !one.concede).length} challenged.`, {
          challenges: event.challenges,
          closeVotes: { ...run.closeVotes, adversary: event.adversaryCloses },
        }),
      )
    case 'judged': {
      if (run.stage !== 'judging') return wrong(run, 'being judged')
      const judged = {
        rulings: event.result.rulings,
        verdict: event.result.verdict,
        visionFit: event.visionFit,
        summary: event.summary,
        pathToSuccess: event.result.pathToSuccess,
        close: event.result.verdict === 'close' ? event.close : null,
        diagrams: event.diagrams,
        notes: event.result.notes,
      }
      const notes = [...run.notes, ...event.result.notes].slice(-60)
      const required = judged.rulings.filter((one) => one.ruling === 'required').length
      const said = `Judged: ${judged.verdict}${required ? `, ${required} required` : ''}.`
      if (event.diagrams.length && event.drawable) return done(to(run, now, 'diagrams', `${said} A diagram was asked for.`, { judged, notes }))
      return done({ ...run, judged, notes, updatedAt: now, history: [...run.history, { at: now, stage: 'judging' as const, said }].slice(-200) })
    }
    case 'diagrammed':
      if (run.stage !== 'diagrams') return wrong(run, 'drawing')
      return done({ ...run, diagrams: event.diagrams, notes: [...run.notes, ...event.notes].slice(-60), updatedAt: now })
    case 'drafted': {
      if (run.stage !== 'judging' && run.stage !== 'diagrams') return wrong(run, 'judged')
      const patch = { drafted: event.drafted, notes: [...run.notes, ...event.notes].slice(-60), checkout: run.checkout ? { ...run.checkout, present: false } : null }
      if (event.sent) return done(to(run, now, 'sent', 'Posted by Factory, as the project\'s switch allows for a two-way change.', { ...patch, sent: { at: now, by: 'factory' }, session: null, waiting: null }))
      return done(waitFor(run, now, 'drafted', `The draft is in Review: ${event.drafted.comments} comment${event.drafted.comments === 1 ? '' : 's'}, a proposed verdict and summary. Read it there and send it yourself.`, patch))
    }
    case 'sent':
      if (run.stage !== 'waiting' || run.waiting?.why !== 'drafted') return wrong(run, 'drafted')
      return done(to(run, now, 'sent', run.sent ? 'Sent.' : 'You sent it from Review.', { sent: { at: now, by: event.by }, waiting: null }))
  }
}

/** A run's stage in words, for a person. */
export function describeRun(run: Pick<Run, 'stage' | 'waiting' | 'round'>): string {
  const round = run.round > 1 ? ` (re-review ${run.round})` : ''
  if (run.waiting?.why === 'checklist') return `planning, waiting for you to accept the proposed checklist${round}`
  switch (run.stage) {
    case 'queued':
      return `queued${round}`
    case 'gathering':
      return `gathering${round}`
    case 'planning':
      return `planning${round}`
    case 'reviewing':
      return `reviewing${round}`
    case 'challenging':
      return `challenging the points${round}`
    case 'judging':
      return `being judged${round}`
    case 'diagrams':
      return `drawing diagrams${round}`
    case 'waiting':
      return `waiting for you${round}`
    case 'sent':
      return `sent${round}`
  }
}
