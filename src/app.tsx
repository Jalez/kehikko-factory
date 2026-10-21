import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { LIMITS, activityItemsSchema, pickedParts, trackerColumnsResult, trackerReadingResult, type HeaderItem, type PressValue } from 'kehikot-module-protocol'
import { Cover, coverFor, useFocus, useHost, useServerStanding, type Host as ProtocolHost } from 'kehikot-module-protocol/client/react'

import { ID } from '../manifest.ts'

import { COLUMNS, anchorOf, columnOf, inView } from '@/board/columns'
import { headerItems, decisionRefusal, type View } from '@/board/header'
import { inboxItems } from '@/board/inbox'
import { reviewInboxItems } from '@/board/review-inbox'
import { HeaderMenus } from '@/components/header-menus'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card } from '@/view/card'
import { JobView } from '@/view/job-view'
import { QueueView } from '@/view/queue-view'
import { ReviewBoardView } from '@/view/review-board'
import { ReviewSettingsView } from '@/view/review-settings'
import { ReviewView } from '@/view/review-view'
import { api as realApi, type Api, type Board, type BoardJob, type FoundBoard, type ReviewBoard } from '@/wire/api'

type Press = { item: string; value?: PressValue }
type PressAnswer = string | true | void

/** What the screen needs from the host. A plain object, so a test can draw the board without one. */
export type Host = Pick<ProtocolHost, 'where' | 'projectPath' | 'epic' | 'parts' | 'header' | 'activity' | 'request'> &
  Partial<Pick<ProtocolHost, 'kehikko' | 'containers' | 'selection'>>

/** How often the page hands the host's rows of the changes under review to the server, for re-review signals. */
export const ROWS_EVERY_MS = 2 * 60 * 1000

export function App() {
  const press = useRef<(press: Press) => PressAnswer>(() => 'Factory is not ready yet.')
  const host = useHost(ID, { onPress: (one) => press.current(one) })
  return <Screen host={host} press={press} />
}

/**
 * The board: the project's jobs across their stages, live from the files. Pressing a card opens the
 * job; the header's Run menu approves or sends back the job that is open.
 */
export function Screen({ host, api = realApi, press }: { host: Host; api?: Api; press?: { current: (press: Press) => PressAnswer } }) {
  const { projectPath, epic, parts } = host
  const server = useServerStanding()
  const [board, setBoard] = useState<Board | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [view, setView] = useState<View>('epic')
  const [selected, setSelected] = useState<string | null>(null)
  const [side, setSide] = useState(false)
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [reviews, setReviews] = useState<ReviewBoard | null>(null)
  const [openRun, setOpenRun] = useState<string | null>(null)

  /* ---- Reading, live ---------------------------------------------------- */

  const read = useCallback(async () => {
    if (!projectPath) return
    try {
      const [jobs, runs] = await Promise.all([api.board(projectPath), api.reviews(projectPath)])
      setBoard(jobs)
      setReviews(runs)
      setTrouble(null)
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error))
    }
  }, [api, projectPath])

  useEffect(() => {
    setBoard(null)
    setReviews(null)
    setSelected(null)
    setOpenRun(null)
    if (!projectPath) return
    void read()
    return api.watch(projectPath, () => void read())
  }, [api, projectPath, read])

  /* The epic's parts, kept for /factory next (which walks the parts that have no job yet). */
  const partsKey = JSON.stringify(parts.map((part) => [part.id, part.heading]))
  useEffect(() => {
    if (!projectPath || !epic) return
    void api.act(projectPath, { act: 'parts', epic, parts: parts.map((part) => ({ id: part.id, heading: part.heading })) }).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectPath, epic, partsKey])

  /* Which kehikko this page is on, what else is on it, and what is selected: /review-factory asks. */
  const kehikkoKey = host.kehikko?.key ?? null
  const modulesKey = JSON.stringify((host.containers ?? []).map((one) => one.module))
  const selectionKey = JSON.stringify(host.selection ?? [])
  useEffect(() => {
    if (!projectPath || !kehikkoKey) return
    void api.reviewAct(projectPath, { act: 'seen', kehikko: kehikkoKey, modules: [ID, ...(JSON.parse(modulesKey) as string[])], selection: JSON.parse(selectionKey) as string[] }).catch(() => undefined)
  }, [api, projectPath, kehikkoKey, modulesKey, selectionKey])

  /* The host's rows of the changes under review (protocol 2.7.0 fields), for the re-review signals. */
  const refsKey = JSON.stringify([...new Set((reviews?.runs ?? []).filter((run) => !run.archived).map((run) => run.change.ref))].sort())
  const { request } = host
  useEffect(() => {
    const refs = JSON.parse(refsKey) as string[]
    if (!projectPath || !refs.length) return
    const hand = async () => {
      try {
        const reading = trackerReadingResult.safeParse(await request('tracker.get', { refs: refs.slice(0, LIMITS.TRACKER_ASK) }))
        if (reading.success) await api.reviewAct(projectPath, { act: 'rows', rows: reading.data.rows })
      } catch {
        /* No host, or it would not answer: nothing is due. */
      }
    }
    void hand()
    const timer = setInterval(() => void hand(), ROWS_EVERY_MS)
    return () => clearInterval(timer)
  }, [api, projectPath, request, refsKey])

  /* ---- What is shown ---------------------------------------------------- */

  const focus = useFocus({ parts, epic, projectPath })
  const jobs = board?.jobs ?? []
  const viewed = useMemo(() => inView(jobs, view === 'reviews' ? 'epic' : view, epic), [jobs, view, epic])
  const narrowed = focus.narrow(viewed, (job) => anchorOf(job, epic), { noun: 'job', keep: (job) => job.id === selected })
  const open = view === 'reviews' ? null : (jobs.find((job) => job.id === selected) ?? null)

  /* ---- The Inbox: the whole list, every time it changes ------------------ */

  const { activity } = host
  const items = useMemo(
    () => activityItemsSchema.parse([...inboxItems(jobs), ...reviewInboxItems(reviews?.runs ?? [], reviews?.questions ?? [])].slice(0, LIMITS.ACTIVITY_ITEMS)),
    [jobs, reviews],
  )
  useEffect(() => {
    if (board) activity(items)
  }, [activity, items, board])

  /* ---- Acts --------------------------------------------------------------- */

  const say = (text: string) => {
    setSaid(text)
    void read()
  }
  const approve = useCallback((): PressAnswer => {
    const refused = decisionRefusal(open)
    if (refused || !open || !projectPath) return refused ?? 'Select a job first.'
    setBusy(true)
    api
      .act(projectPath, { act: 'approve', job: open.id })
      .then(say, (e: unknown) => say(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, open, projectPath])

  const startSendBack = useCallback((): PressAnswer => {
    const refused = decisionRefusal(open)
    if (refused) return refused
    setNote('')
    setNoting(true)
    return true
  }, [open])

  const onPress = useCallback(
    ({ item, value }: Press): PressAnswer => {
      if (item === 'view') {
        if (value !== 'epic' && value !== 'all' && value !== 'reviews') return 'The view is "epic", "all" or "reviews".'
        setView(value)
        return true
      }
      if (item === 'approve') return approve()
      if (item === 'send-back') return startSendBack()
      return `Factory has nothing called "${item}" to press.`
    },
    [approve, startSendBack],
  )
  if (press) press.current = onPress

  const menus: HeaderItem[] = useMemo(() => headerItems(view, open, busy, epic), [view, open, busy, epic])
  const { header } = host
  useEffect(() => header(menus), [header, menus])

  /* The boards the host read (protocol 2.6.0); null from a host that has none or does not answer. */
  const hostBoards = useCallback(async (): Promise<FoundBoard[] | null> => {
    try {
      const answer = trackerColumnsResult.safeParse(await request('tracker.columns', {}))
      return answer.success ? answer.data.boards : null
    } catch {
      return null
    }
  }, [request])

  /* ---- Drawing ---------------------------------------------------------- */

  const cover = server === 'stale' ? 'stale' : (coverFor(host as never, { project: true }) ?? (server === 'down' && !board ? 'down' : null))
  if (cover) return <Cover state={cover} name="Factory" onRetry={() => void read()} />

  const picked = pickedParts(parts).map((part) => part.id)
  return (
    <div className="flex h-screen min-w-0 flex-col text-sm">
      <header className="flex min-h-8 shrink-0 items-center gap-2 border-b px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted-foreground)]" data-testid="summary">
          {summary(jobs, view, epic, reviews)}
        </span>
        {host.where === 'unhosted' ? <HeaderMenus items={menus} onPress={onPress} /> : null}
        <Button size="sm" variant={side ? 'secondary' : 'ghost'} className="h-6 shrink-0 px-2 text-xs" onClick={() => setSide((was) => !was)} aria-pressed={side}>
          Settings
        </Button>
      </header>
      {said ? (
        <p className="shrink-0 border-b px-2 py-1 text-xs" role="status" data-testid="said">
          {said}
          <button type="button" className="ml-2 text-[var(--muted-foreground)]" aria-label="dismiss" onClick={() => setSaid(null)}>
            ×
          </button>
        </p>
      ) : null}
      {trouble ? <p role="alert" className="shrink-0 border-b px-2 py-1 text-xs text-[var(--destructive)]">{trouble}</p> : null}
      {side && board && projectPath && view !== 'reviews' ? (
        <div className="max-h-[50%] shrink-0 overflow-auto border-b">
          <QueueView board={board} projectPath={projectPath} epic={epic} parts={picked} api={api} hostBoards={hostBoards} onSaid={say} />
        </div>
      ) : null}
      {side && reviews && projectPath && view === 'reviews' ? (
        <div className="max-h-[50%] shrink-0 overflow-auto border-b">
          <ReviewSettingsView settings={reviews.settings} projectPath={projectPath} api={api} onSaid={say} />
        </div>
      ) : null}
      {view === 'reviews' && projectPath ? (
        (() => {
          const run = reviews?.runs.find((one) => one.id === openRun) ?? null
          if (run) {
            return (
              <ReviewView
                run={run}
                projectPath={projectPath}
                api={api}
                question={reviews?.questions.find((one) => one.author === run.change.author?.login) ?? null}
                recommended={reviews?.settings.defaultRule ?? ''}
                onBack={() => setOpenRun(null)}
                onOpenChange={() => void request('view.goto', { ref: run.change.ref }).catch(() => say(`Select ${run.change.ref} on the canvas; Review shows the draft.`))}
                onSaid={say}
              />
            )
          }
          return (
            <main className="min-h-0 flex-1 overflow-auto">
              {!reviews ? <p className="p-3 text-xs text-[var(--muted-foreground)]">Reading the reviews…</p> : <ReviewBoardView runs={reviews.runs} questions={reviews.questions} selected={openRun} onOpen={setOpenRun} />}
            </main>
          )
        })()
      ) : open && projectPath ? (
        <JobView job={open} projectPath={projectPath} api={api} onBack={() => setSelected(null)} onApprove={() => approve()} onSendBack={() => startSendBack()} onSaid={say} />
      ) : (
        <main className="min-h-0 flex-1 overflow-auto">
          {!board ? (
            <p className="p-3 text-xs text-[var(--muted-foreground)]">Reading the jobs…</p>
          ) : narrowed.shown.length === 0 ? (
            <Empty empty={narrowed.empty} view={view} epic={epic} any={jobs.some((job) => !job.archived)} />
          ) : (
            <div className="flex min-h-full gap-2 p-2" data-testid="board">
              {COLUMNS.map((column) => {
                const here = narrowed.shown.filter((job) => columnOf(job.stage) === column.id)
                if (!here.length && (column.id === 'failed' || column.id === 'merged')) return null
                return (
                  <section key={column.id} aria-label={column.label} className="flex w-44 shrink-0 flex-col gap-1.5" data-testid={`column-${column.id}`}>
                    <h2 className={`px-0.5 text-[0.7rem] font-medium ${column.id === 'waiting' && here.length ? 'text-[var(--attention)]' : 'text-[var(--muted-foreground)]'}`}>
                      {column.label} {here.length ? <span className="font-normal">({here.length})</span> : null}
                    </h2>
                    {here.map((job) => (
                      <Card key={job.id} job={job} selected={job.id === selected} showPlace={view === 'all'} onOpen={() => setSelected(job.id)} />
                    ))}
                  </section>
                )
              })}
            </div>
          )}
        </main>
      )}
      <Dialog open={noting} onOpenChange={setNoting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send back with a note</DialogTitle>
            <DialogDescription>The builder reads your note first, on its next round. Type /factory next in a Claude Code conversation in this project to build it.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!open || !projectPath || !note.trim()) return
              setNoting(false)
              api.act(projectPath, { act: 'send-back', job: open.id, note }).then(say, (e: unknown) => say(e instanceof Error ? e.message : String(e)))
            }}
          >
            <textarea
              autoFocus
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={5}
              maxLength={4000}
              aria-label="your note to the builder"
              className="w-full rounded border bg-transparent p-2 text-xs"
              data-testid="note"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setNoting(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!note.trim()} data-testid="send-note">
                Send back
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function summary(jobs: readonly BoardJob[], view: View, epic: string | null, reviews: ReviewBoard | null = null): string {
  if (view === 'reviews') {
    const runs = (reviews?.runs ?? []).filter((run) => !run.archived)
    const waiting = runs.filter((run) => run.waiting !== null).length + (reviews?.questions.length ?? 0)
    return `Reviews${waiting ? ` · ${waiting} waiting for you` : ''}`
  }
  const live = jobs.filter((job) => !job.archived)
  const waiting = live.filter((job) => job.stage === 'waiting').length
  const scope = view === 'all' ? 'All jobs' : epic ? `Jobs on ${epic}` : 'No epic open'
  return `${scope}${waiting ? ` · ${waiting} waiting for you` : ''}`
}

function Empty({ empty, view, epic, any }: { empty: string; view: View; epic: string | null; any: boolean }) {
  const line =
    empty
    || (view === 'epic' && !epic
      ? 'No epic is open. Switch the view to all jobs, or open an epic.'
      : view === 'epic' && any
        ? 'No job was started on this epic. Switch the view to all jobs to see the others.'
        : 'No jobs yet. In a Claude Code conversation in this project, type /factory <feature>.')
  return (
    <div className="flex flex-col gap-1 p-3 text-xs text-[var(--muted-foreground)]" data-testid="empty">
      <p>{line}</p>
    </div>
  )
}
