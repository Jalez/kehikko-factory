import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { itemsNow, verdictWords } from '@/board/review-columns'
import { describeRun, runAnglesOpen } from '../../rev/flow'
import type { Api, BoardRun, ReviewQuestion } from '@/wire/api'

const STATE_WORDS = { passed: 'passed', failed: 'failed', na: 'not applicable' } as const

/**
 * One review opened: where it is, what it waits for, the verdict and "To get this approved", every
 * checklist item with its state and how it is known, the person's choices (angles, checklist,
 * budget, the first-time question about the author), and "How this review was made" — every file of
 * the record, read as text, never as markup.
 */
export function ReviewView({
  run,
  projectPath,
  api,
  question,
  recommended,
  onBack,
  onOpenChange,
  onSaid,
}: {
  run: BoardRun
  projectPath: string
  api: Api
  question: ReviewQuestion | null
  recommended: string
  onBack(): void
  onOpenChange(): void
  onSaid(said: string): void
}) {
  const [file, setFile] = useState<string | null>(null)
  const [textOf, setTextOf] = useState<string | null>(null)
  const shown = file && run.files.includes(file) ? file : (run.files.find((one) => one === 'draft.md') ?? run.files[0] ?? null)
  const version = `${run.updatedAt}:${run.files.length}`
  const said = (promise: Promise<string>) => promise.then(onSaid, (e: unknown) => onSaid(e instanceof Error ? e.message : String(e)))

  useEffect(() => {
    let live = true
    if (!shown) {
      setTextOf(null)
      return
    }
    api
      .reviewFile(projectPath, run.id, shown)
      .then((text) => live && setTextOf(text ?? 'Not written yet.'))
      .catch((error: unknown) => live && setTextOf(error instanceof Error ? error.message : String(error)))
    return () => {
      live = false
    }
  }, [api, projectPath, run.id, shown, version])

  const items = itemsNow(run)
  const judged = run.judged
  const spent = run.spend.reduce((sum, one) => sum + one.tokens, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="review-view">
      <div className="flex max-h-[60%] shrink-0 flex-col gap-1.5 overflow-auto border-b px-2 py-1.5 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="sm" variant="ghost" className="h-6 shrink-0 px-1.5 text-xs" onClick={onBack} aria-label="Back to the reviews">
            ← Reviews
          </Button>
          <span className="min-w-0 flex-1 truncate font-medium" title={run.change.title}>
            {run.change.ref} — {run.change.title}
          </span>
        </div>
        <p className="text-[0.7rem] text-[var(--muted-foreground)]" data-testid="review-stage">
          {describeRun(run)}
          {run.lately?.line ? ` — ${run.lately.line}` : ''}
        </p>
        <p className="break-all text-[0.7rem] text-[var(--muted-foreground)]">{run.change.url}</p>
        {run.waiting ? <p data-testid="review-waiting">{run.waiting.said}</p> : null}
        {run.stage === 'waiting' && run.waiting?.why === 'drafted' ? (
          <div>
            <Button size="sm" className="h-6 px-2 text-xs" data-testid="open-in-review" onClick={onOpenChange}>
              Open the change in Review
            </Button>
          </div>
        ) : null}
        {run.plan ? (
          <p data-testid="review-door">
            <span className="font-medium">{run.plan.door.kind === 'one-way' ? 'One-way' : 'Two-way'}:</span> {run.plan.door.reasons.join(' ')}
            {run.plan.uiux.touches ? ` It touches what people see (${run.plan.uiux.screens.join(', ') || run.plan.uiux.reason}); before and after pictures ${run.plan.uiux.shots ? 'are there' : 'are missing'}.` : ''}
          </p>
        ) : null}
        {judged ? (
          <div data-testid="review-verdict">
            <p className="font-medium">{verdictWords[judged.verdict] ?? judged.verdict}</p>
            {judged.visionFit ? <p className="text-[var(--muted-foreground)]">{judged.visionFit}</p> : null}
            {judged.verdict === 'close' && judged.close ? <p>Instead: {judged.close.instead}</p> : null}
            {judged.pathToSuccess.length && judged.verdict !== 'approve' ? (
              <>
                <p className="pt-1 font-medium">To get this approved:</p>
                <ol className="pl-1">
                  {judged.pathToSuccess.map((one) => (
                    <li key={one}>{one}</li>
                  ))}
                </ol>
              </>
            ) : null}
          </div>
        ) : null}
        {question ? <AuthorQuestion question={question} recommended={recommended} projectPath={projectPath} api={api} onSaid={onSaid} /> : null}
        {run.waiting?.why === 'checklist' && run.proposed ? <Proposed run={run} projectPath={projectPath} api={api} onSaid={onSaid} /> : null}
        {items.length ? (
          <div data-testid="review-checklist">
            <p className="font-medium">Checklist</p>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => (
                <li key={`${item.checklist}/${item.id}`}>
                  <span className="font-medium">{item.state ? STATE_WORDS[item.state] : 'unchecked'}</span> — {item.text}
                  {item.note ? <span className="text-[var(--muted-foreground)]"> ({item.byPerson ? 'you' : item.by}: {item.note})</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {run.notes.length ? (
          <ul className="list-disc pl-4 text-[var(--muted-foreground)]" data-testid="review-notes">
            {run.notes.slice(-8).map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        ) : null}
        {run.budget ? (
          <p className="text-[0.7rem] text-[var(--muted-foreground)]" data-testid="review-budget">
            Budget: {run.budget.pointsPerReviewer} points per reviewer, {run.budget.filesBeyondDiff} files beyond the diff, about {Math.round(run.budget.tokens / 1000)}k tokens. Spent so far: about {Math.round(spent / 1000)}k.
          </p>
        ) : null}
        <Choices run={run} projectPath={projectPath} api={api} onSaid={onSaid} said={said} />
      </div>
      {run.files.length ? (
        <div role="tablist" aria-label="How this review was made" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1">
          {run.files.map((name) => (
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
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-5" data-testid="review-file-text">
        {shown ? (textOf ?? 'Reading…') : 'Nothing is written for this review yet.'}
      </pre>
    </div>
  )
}

function Choices({ run, projectPath, api, said }: { run: BoardRun; projectPath: string; api: Api; onSaid(said: string): void; said(promise: Promise<string>): void }) {
  const [angles, setAngles] = useState('')
  const [budget, setBudget] = useState('')
  const settled = run.stage === 'sent' || (run.stage === 'waiting' && run.waiting?.why !== 'checklist')
  return (
    <div className="flex flex-col gap-1 pt-1">
      {runAnglesOpen(run) ? (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            const ids = angles.split(/[,\s]+/).filter(Boolean)
            if (ids.length !== 2) return
            setAngles('')
            said(api.reviewAct(projectPath, { act: 'review-angles', run: run.id, angles: ids.map((id) => ({ id })) }))
          }}
        >
          <Input value={angles} onChange={(event) => setAngles(event.target.value)} placeholder="two angles: security, tests" className="h-6 text-xs" aria-label="the two angles" />
          <Button type="submit" size="sm" variant="outline" className="h-6 px-2 text-xs">
            Set angles
          </Button>
        </form>
      ) : null}
      {!settled ? (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (!budget.trim()) return
            setBudget('')
            said(api.reviewAct(projectPath, { act: 'review-budget', run: run.id, budget }))
          }}
        >
          <Input value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="points=6 files=10 tokens=300k" className="h-6 text-xs" aria-label="the budget" />
          <Button type="submit" size="sm" variant="outline" className="h-6 px-2 text-xs">
            Set budget
          </Button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {!settled ? (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => said(api.reviewAct(projectPath, { act: 'review-stop', run: run.id }))}>
            Stop
          </Button>
        ) : null}
        {run.stage === 'waiting' && run.waiting?.why === 'drafted' ? (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => said(api.reviewAct(projectPath, { act: 'review-sent', run: run.id }))}>
            I sent it
          </Button>
        ) : null}
        {settled ? (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => said(api.reviewAct(projectPath, { act: 'review-archive', run: run.id }))}>
            Clear from the board
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** The planner's proposed checklist: accept it as it is, or edit it first. */
function Proposed({ run, projectPath, api, onSaid }: { run: BoardRun; projectPath: string; api: Api; onSaid(said: string): void }) {
  const [text, setText] = useState((run.proposed ?? []).join('\n'))
  const send = (items: string[] | null) => api.reviewAct(projectPath, { act: 'review-checklist', run: run.id, items }).then(onSaid, (e: unknown) => onSaid(e instanceof Error ? e.message : String(e)))
  return (
    <div className="flex flex-col gap-1" data-testid="review-proposed">
      <p className="font-medium">This change has no checklist. The planner proposes one, an item a line:</p>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={Math.min(15, (run.proposed?.length ?? 3) + 1)} className="w-full rounded border bg-transparent p-1.5 text-xs" aria-label="the proposed checklist" />
      <div className="flex gap-1.5">
        <Button size="sm" className="h-6 px-2 text-xs" data-testid="accept-checklist" onClick={() => void send(null)}>
          Accept as proposed
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => void send(text.split('\n').map((one) => one.trim()).filter(Boolean))}>
          Use my edit
        </Button>
      </div>
      <p className="text-[var(--muted-foreground)]">It is made in Checklist and held against {run.change.ref}. Then type /review-factory resume {run.id} in the conversation.</p>
    </div>
  )
}

/** "We haven't reviewed <author>'s work before…": the recommended answer in one press, or a sentence. */
export function AuthorQuestion({ question, recommended, projectPath, api, onSaid }: { question: ReviewQuestion; recommended: string; projectPath: string; api: Api; onSaid(said: string): void }) {
  const [sentence, setSentence] = useState('')
  const [all, setAll] = useState(false)
  const send = (text: string) =>
    api.reviewAct(projectPath, { act: 'author-rule', author: question.author, sentence: text, allProjects: all }).then(onSaid, (e: unknown) => onSaid(e instanceof Error ? e.message : String(e)))
  return (
    <div className="flex flex-col gap-1 rounded border border-[var(--attention)] p-1.5" data-testid="author-question">
      <p className="font-medium">{question.text}</p>
      <Button size="sm" className="h-auto min-h-6 whitespace-normal px-2 py-0.5 text-left text-xs" data-testid="accept-recommended" onClick={() => void send(recommended)}>
        Recommended: {recommended}
      </Button>
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          if (!sentence.trim()) return
          void send(sentence)
        }}
      >
        <Input value={sentence} onChange={(event) => setSentence(event.target.value)} placeholder="or in your words: when they comment ready" className="h-6 text-xs" aria-label={`the signal for ${question.author}`} />
        <Button type="submit" size="sm" variant="outline" className="h-6 px-2 text-xs">
          Save
        </Button>
      </form>
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)} /> Use for all projects
      </label>
    </div>
  )
}
