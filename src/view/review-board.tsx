import { Badge } from '@/components/ui/badge'
import { checklistProgress, runLine, shownColumns } from '@/board/review-columns'
import type { BoardRun, ReviewQuestion } from '@/wire/api'

/**
 * The Reviews board: one card per review, in the column of its step, moving as steps report. A
 * card says the change, the step in a few words, the checklist's progress, whether it is one-way
 * and whether it touches what people see — in words, never by colour alone.
 */
export function ReviewBoardView({ runs, questions, selected, onOpen }: { runs: readonly BoardRun[]; questions: readonly ReviewQuestion[]; selected: string | null; onOpen(id: string): void }) {
  const live = runs.filter((run) => !run.archived)
  if (!live.length && !questions.length) {
    return (
      <p className="p-3 text-xs text-[var(--muted-foreground)]" data-testid="reviews-empty">
        No reviews yet. In a Claude Code conversation on this kehikko, select a pull or merge request and type /review-factory.
      </p>
    )
  }
  return (
    <div className="flex min-h-full gap-2 p-2" data-testid="review-board">
      {shownColumns(live).map((column) => {
        const here = live.filter((run) => run.stage === column.id)
        return (
          <section key={column.id} aria-label={column.label} className="flex w-44 shrink-0 flex-col gap-1.5" data-testid={`review-column-${column.id}`}>
            <h2 className={`px-0.5 text-[0.7rem] font-medium ${column.id === 'waiting' && here.length ? 'text-[var(--attention)]' : 'text-[var(--muted-foreground)]'}`}>
              {column.label} {here.length ? <span className="font-normal">({here.length})</span> : null}
            </h2>
            {here.map((run) => (
              <ReviewCard key={run.id} run={run} selected={run.id === selected} question={questions.find((one) => one.author === run.change.author?.login) ?? null} onOpen={() => onOpen(run.id)} />
            ))}
          </section>
        )
      })}
    </div>
  )
}

export function ReviewCard({ run, selected, question, onOpen }: { run: BoardRun; selected: boolean; question: ReviewQuestion | null; onOpen(): void }) {
  const waiting = run.stage === 'waiting' || run.waiting !== null
  const progress = checklistProgress(run)
  return (
    <button
      type="button"
      data-testid={`review-card-${run.id}`}
      aria-pressed={selected}
      onClick={onOpen}
      className={[
        'flex w-full min-w-0 flex-col gap-1 rounded-md border bg-[var(--card)] p-2 text-left text-xs outline-none',
        'hover:bg-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        selected ? 'ring-2 ring-[var(--ring)]' : '',
        waiting ? 'border-[var(--attention)]' : '',
      ].join(' ')}
    >
      <span className="line-clamp-2 font-medium">{run.change.title || run.change.ref}</span>
      <span className="flex flex-wrap items-center gap-1 text-[0.7rem] text-[var(--muted-foreground)]">
        {waiting ? <span className="font-medium text-[var(--attention)]">needs you ·</span> : null}
        <span>{runLine(run)}</span>
      </span>
      {progress ? (
        <span className="text-[0.7rem]" data-testid="checklist-progress">
          {progress}
        </span>
      ) : null}
      {run.plan ? (
        <span className="flex flex-wrap gap-1">
          <Badge variant="outline" className="px-1 py-0 text-[0.6rem] font-normal">
            {run.plan.door.kind}
          </Badge>
          {run.plan.uiux.touches ? (
            <Badge variant="outline" className="px-1 py-0 text-[0.6rem] font-normal">
              UI/UX
            </Badge>
          ) : null}
          {run.plan.angles.map((angle) => (
            <Badge key={angle.id} variant="outline" className="px-1 py-0 text-[0.6rem] font-normal">
              {angle.id}
            </Badge>
          ))}
        </span>
      ) : null}
      {question ? <span className="text-[0.7rem] text-[var(--attention)]">A question about {question.author} waits for you.</span> : null}
      {run.lately?.line ? (
        <span className="truncate text-[0.65rem] text-[var(--muted-foreground)]" title={run.lately.line}>
          {run.lately.line}
        </span>
      ) : null}
      <span className="truncate font-mono text-[0.6rem] text-[var(--muted-foreground)]">
        {run.id} · {run.change.ref}
      </span>
    </button>
  )
}
