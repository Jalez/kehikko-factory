import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { decisionRefusal } from '@/board/header'
import { anglesOpen, describeStage } from '../../job/flow'
import type { Api, BoardJob } from '@/wire/api'

/**
 * One job opened: where it is, what it is waiting for, its angles (editable until the reviews
 * start), and its files, each read as text — never rendered as markup.
 */
export function JobView({
  job,
  projectPath,
  api,
  onBack,
  onApprove,
  onSendBack,
  onSaid,
}: {
  job: BoardJob
  projectPath: string
  api: Api
  onBack(): void
  onApprove(): void
  onSendBack(): void
  onSaid(said: string): void
}) {
  const [file, setFile] = useState<string | null>(null)
  const [textOf, setTextOf] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const shown = file && job.files.includes(file) ? file : (job.files[job.files.length - 1] ?? null)
  const version = `${job.updatedAt}:${job.files.length}:${job.lately?.at ?? ''}`

  useEffect(() => {
    let live = true
    if (!shown) {
      setTextOf(null)
      return
    }
    api
      .file(projectPath, job.id, shown)
      .then((text) => live && setTextOf(text ?? 'Not written yet.'))
      .catch((error: unknown) => live && setTextOf(error instanceof Error ? error.message : String(error)))
    return () => {
      live = false
    }
  }, [api, projectPath, job.id, shown, version])

  const refused = decisionRefusal(job)
  const settled = job.stage === 'merged' || job.stage === 'failed'

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="job-view">
      <div className="flex shrink-0 flex-col gap-1 border-b px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="sm" variant="ghost" className="h-6 shrink-0 px-1.5 text-xs" onClick={onBack} aria-label="Back to the board">
            ← Board
          </Button>
          <span className="min-w-0 flex-1 truncate text-xs font-medium" title={job.title}>
            {job.title}
          </span>
        </div>
        <p className="text-[0.7rem] text-[var(--muted-foreground)]" data-testid="stage">
          {describeStage(job)}
          {job.lately?.line ? ` — ${job.lately.line}` : ''}
        </p>
        <p className="text-[0.7rem] text-[var(--muted-foreground)]" data-testid="issue">
          {job.ref
            ? `Issue ${job.ref}${job.column ? `, in “${job.column}”` : ''}${job.moveFailed ? ` (moving it to “${job.moveFailed}” failed)` : ''}`
            : `No issue: type /factory issue ${job.id} new to open one, or keep it on this board only.`}
        </p>
        {job.waiting ? <p className="text-xs" data-testid="waiting">{job.waiting.said}</p> : null}
        {job.failed ? <p className="text-xs text-[var(--destructive)]">{job.failed}</p> : null}
        {job.merge?.left ? <p className="text-xs text-[var(--muted-foreground)]">{job.merge.left}</p> : null}
        {job.required.length ? (
          <div className="text-xs">
            <p className="font-medium">{job.stage === 'build' ? 'The builder is working on:' : 'Still required:'}</p>
            <ul className="list-disc pl-4">
              {job.required.map((one, i) => (
                <li key={i}>
                  <span className="text-[var(--muted-foreground)]">{one.angle}:</span> {one.point}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!refused ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              data-testid="approve"
              onClick={() => {
                if (!armed) return setArmed(true)
                setArmed(false)
                onApprove()
              }}
              onBlur={() => setArmed(false)}
            >
              {armed ? 'Press again to merge' : 'Approve and merge…'}
            </Button>
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" data-testid="send-back" onClick={onSendBack}>
              Send back with a note…
            </Button>
          </div>
        ) : null}
        {settled ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => api.act(projectPath, { act: 'archive', job: job.id }).then(onSaid, (e: unknown) => onSaid(e instanceof Error ? e.message : String(e)))}
            >
              Clear from the board
            </Button>
          </div>
        ) : null}
        <Angles job={job} projectPath={projectPath} api={api} onSaid={onSaid} />
      </div>
      {job.files.length ? (
        <div role="tablist" aria-label="The job’s files" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1">
          {job.files.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={name === shown}
              onClick={() => setFile(name)}
              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.65rem] ${name === shown ? 'bg-[var(--accent)] font-medium' : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)]'}`}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-5" data-testid="file-text">
        {shown ? (textOf ?? 'Reading…') : 'Nothing is written for this job yet.'}
      </pre>
    </div>
  )
}

/** The review angles, which the person may change until the first review starts. */
function Angles({ job, projectPath, api, onSaid }: { job: BoardJob; projectPath: string; api: Api; onSaid(said: string): void }) {
  const [adding, setAdding] = useState('')
  if (!anglesOpen(job)) return null
  const send = (angles: { id: string; brief?: string }[]) =>
    api.act(projectPath, { act: 'angles', job: job.id, angles }).then(onSaid, (e: unknown) => onSaid(e instanceof Error ? e.message : String(e)))
  const current = job.angles.map((one) => ({ id: one.id, brief: one.brief }))
  return (
    <div className="flex flex-col gap-1 pt-1 text-xs" data-testid="angles">
      <span className="text-[var(--muted-foreground)]">
        Review angles{job.stage === 'spec' || job.stage === 'plan' ? ' (the planner chooses; yours win)' : ''} — change them before the review starts:
      </span>
      <div className="flex flex-wrap gap-1">
        {job.angles.map((angle) => (
          <span key={angle.id} className="flex items-center gap-1 rounded border px-1.5 py-0.5" title={angle.brief}>
            {angle.id}
            <button type="button" aria-label={`remove the ${angle.id} angle`} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]" onClick={() => send(current.filter((one) => one.id !== angle.id))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          const id = adding.trim().toLowerCase()
          if (!id) return
          setAdding('')
          void send([...current, { id }])
        }}
      >
        <Input value={adding} onChange={(event) => setAdding(event.target.value)} placeholder="add an angle: security, tests, ux-copy…" className="h-6 text-xs" aria-label="add an angle" />
        <Button type="submit" size="sm" variant="outline" className="h-6 px-2 text-xs">
          Add
        </Button>
      </form>
    </div>
  )
}
