import type { Run } from '../../rev/shape.ts'

/**
 * The Reviews board: one card per change under review, and the columns are the steps (contract
 * C5). Diagrams is drawn only while a run is in it: a judge asks for one rarely, and only when Flows
 * is on the kehikko. It touches nothing else: not the build board, not Factory's stage mapping,
 * and never the change's column on the project's own board.
 */
export const REVIEW_COLUMNS = [
  { id: 'queued', label: 'Queued' },
  { id: 'gathering', label: 'Gathering' },
  { id: 'planning', label: 'Planning' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'challenging', label: 'Challenging' },
  { id: 'judging', label: 'Judging' },
  { id: 'diagrams', label: 'Diagrams' },
  { id: 'waiting', label: 'Waiting for you' },
  { id: 'sent', label: 'Sent' },
] as const satisfies readonly { id: Run['stage']; label: string }[]

export function shownColumns(runs: readonly Pick<Run, 'stage'>[]) {
  return REVIEW_COLUMNS.filter((column) => column.id !== 'diagrams' || runs.some((run) => run.stage === 'diagrams'))
}

const ANSWERED = { pass: 'passed', fail: 'failed', 'n/a': 'na' } as const

export interface ItemNow {
  checklist: string
  id: string
  text: string
  state: 'passed' | 'failed' | 'na' | null
  note: string | null
  /** Who said it: the person, another agent, or a reviewer of this run. */
  by: string | null
  byPerson: boolean
}

/** Every checklist item as it stands for this run: what was set before (the person's first), else the panel's answer. */
export function itemsNow(run: Pick<Run, 'checklists' | 'answers'>): ItemNow[] {
  return run.checklists.flatMap((list) =>
    list.items.map((item) => {
      const answer = run.answers.find((one) => one.checklist === list.id && one.item === item.id)
      if (item.state && (item.byPerson || !answer)) return { checklist: list.id, id: item.id, text: item.text, state: item.state, note: item.note ?? null, by: item.by ?? null, byPerson: item.byPerson }
      if (answer) return { checklist: list.id, id: item.id, text: item.text, state: ANSWERED[answer.state], note: answer.note, by: `${answer.by} reviewer`, byPerson: false }
      return { checklist: list.id, id: item.id, text: item.text, state: null, note: null, by: null, byPerson: false }
    }),
  )
}

/** "7 of 12 checked · 1 failed", or null when the change has no checklist. */
export function checklistProgress(run: Pick<Run, 'checklists' | 'answers'>): string | null {
  const items = itemsNow(run)
  if (!items.length) return null
  const checked = items.filter((one) => one.state !== null).length
  const failed = items.filter((one) => one.state === 'failed').length
  return `${checked} of ${items.length} checked${failed ? ` · ${failed} failed` : ''}`
}

/** What a card says under its title. */
export function runLine(run: Pick<Run, 'stage' | 'waiting' | 'round' | 'judged' | 'background' | 'id'>): string {
  const round = run.round > 1 ? ` · re-review ${run.round}` : ''
  if (run.waiting?.why === 'checklist') return `your checklist${round}`
  if (run.waiting?.why === 'moved-on') return `the change moved on${round}`
  if (run.waiting?.why === 'stopped') return `stopped${round}`
  if (run.stage === 'waiting') return `${run.judged?.verdict === 'approve' ? 'approves' : run.judged?.verdict === 'close' ? 'close it' : run.judged?.verdict === 'comment' ? 'comments' : 'changes requested'}: read it in Review${round}`
  if (run.stage === 'queued') return run.background ? `starting by itself${round}` : `type /review-factory resume ${run.id}`
  if (run.stage === 'sent') return `sent${round}`
  return `${run.stage}${round}`
}

export const verdictWords: Record<string, string> = {
  approve: 'Approve: nothing blocks it',
  comment: 'Comment: optional points only',
  'request-changes': 'Request changes',
  close: 'Close this change',
}
