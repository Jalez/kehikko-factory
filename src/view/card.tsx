import { Badge } from '@/components/ui/badge'
import { placeLabel, stageLine } from '@/board/columns'
import type { BoardJob } from '@/wire/api'

/** One job on the board. A button: pressing it opens the job's files. With `showPlace`, it says its epic ("no epic" for one started elsewhere). */
export function Card({ job, selected, showPlace, onOpen }: { job: BoardJob; selected: boolean; showPlace: boolean; onOpen(): void }) {
  const waiting = job.stage === 'waiting'
  const failed = job.stage === 'failed'
  return (
    <button
      type="button"
      data-testid={`card-${job.id}`}
      aria-pressed={selected}
      onClick={onOpen}
      className={[
        'flex w-full min-w-0 flex-col gap-1 rounded-md border bg-[var(--card)] p-2 text-left text-xs outline-none',
        'hover:bg-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        selected ? 'ring-2 ring-[var(--ring)]' : '',
        waiting ? 'border-[var(--attention)]' : failed ? 'border-[var(--destructive)]' : '',
      ].join(' ')}
    >
      <span className="line-clamp-2 font-medium">{job.title}</span>
      <span className="flex flex-wrap items-center gap-1 text-[0.7rem] text-[var(--muted-foreground)]">
        {waiting ? <span className="font-medium text-[var(--attention)]">needs you ·</span> : null}
        {failed ? <span className="font-medium text-[var(--destructive)]">failed ·</span> : null}
        <span>{stageLine(job)}</span>
      </span>
      {job.angles.length ? (
        <span className="flex flex-wrap gap-1">
          {job.angles.map((angle) => (
            <Badge key={angle.id} variant="outline" className="px-1 py-0 text-[0.6rem] font-normal">
              {angle.id}
            </Badge>
          ))}
        </span>
      ) : null}
      {job.lately?.line ? (
        <span className="truncate text-[0.65rem] text-[var(--muted-foreground)]" title={job.lately.line} data-testid="lately">
          {job.lately.line}
        </span>
      ) : null}
      {showPlace ? (
        <span className="truncate text-[0.65rem] text-[var(--muted-foreground)]" data-testid="place">
          {placeLabel(job.place)}
        </span>
      ) : null}
      <span className="truncate font-mono text-[0.6rem] text-[var(--muted-foreground)]">
        {job.id}
        {job.ref ? ` · ${job.ref}${job.column ? ` · ${job.column}` : ''}` : ''}
      </span>
    </button>
  )
}
