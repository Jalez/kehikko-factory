import { useState } from 'react'

import { BOARD_STAGES, guessColumns, type BoardMap, type BoardStage } from '../../job/board'
import { Button } from '@/components/ui/button'
import type { Api, FoundBoard } from '@/wire/api'

const STAGE_WORDS: Record<BoardStage, string> = {
  spec: 'Spec',
  plan: 'Plan',
  build: 'Build',
  review: 'Review',
  judge: 'Judge',
  waiting: 'Waiting for you',
  merged: 'Merged',
  failed: 'Failed',
}

/**
 * Where each Factory stage sits on the project's own board. The boards and columns come from the
 * host's tracker reading (`tracker.columns`), else from the person's own gh/glab; a guess is filled
 * in and shown, and nothing moves until the person saves it.
 */
export function BoardMapView({
  board,
  projectPath,
  api,
  hostBoards,
  onSaid,
}: {
  board: BoardMap | null
  projectPath: string
  api: Api
  /** Asks the host for its boards (`tracker.columns`); null when the host has none or will not say. */
  hostBoards: () => Promise<FoundBoard[] | null>
  onSaid(said: string): void
}) {
  const [found, setFound] = useState<{ kind: 'github' | 'gitlab'; repo: string; boards: FoundBoard[]; from: string } | null>(null)
  const [looking, setLooking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [draft, setDraft] = useState<BoardMap | null>(null)

  const look = async () => {
    setLooking(true)
    setTrouble(null)
    try {
      const { remote } = await api.columns(projectPath, false)
      if (!remote) {
        setTrouble('This project\'s origin is not on GitHub or GitLab, so there is no board to map to.')
        return
      }
      const fromHost = await hostBoards()
      if (fromHost?.length) {
        setFound({ kind: remote.kind, repo: remote.repo, boards: fromHost, from: 'Kehikot\'s tracker reading' })
        return
      }
      const { found: cli } = await api.columns(projectPath, true)
      if (!cli?.ok) {
        setTrouble(cli?.why ?? 'No boards were found.')
        return
      }
      setFound({ kind: cli.kind, repo: cli.repo, boards: cli.boards, from: remote.kind === 'github' ? 'gh' : 'glab' })
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error))
    } finally {
      setLooking(false)
    }
  }

  const choose = (name: string) => {
    const one = found?.boards.find((b) => b.board === name)
    if (!found || !one) return setDraft(null)
    setDraft({ kind: found.kind, repo: found.repo, board: one.board, ...(one.boardUrl ? { boardUrl: one.boardUrl } : {}), columns: guessColumns(one.columns), confirmed: false })
  }

  const send = (next: BoardMap | null) =>
    api.act(projectPath, { act: 'board', board: next }).then(
      (said) => {
        setDraft(null)
        setFound(null)
        onSaid(said)
      },
      (e: unknown) => onSaid(e instanceof Error ? e.message : String(e)),
    )

  const columnsOf = (name: string) => found?.boards.find((b) => b.board === name)?.columns ?? (board?.board === name ? [...new Set(Object.values(board.columns).filter((c): c is string => !!c))] : [])
  const editing = draft

  return (
    <div className="flex flex-col gap-1.5" data-testid="board-map">
      <span className="font-medium">The project's board</span>
      {board && !editing ? (
        <div className="flex flex-col gap-1">
          <p className="text-[var(--muted-foreground)]">
            {board.confirmed ? 'Issues move on' : 'A guess, not applied, for'} “{board.board}” ({board.repo}):
          </p>
          <ul className="grid grid-cols-[auto_1fr] gap-x-2">
            {BOARD_STAGES.map((stage) => (
              <li key={stage} className="contents">
                <span>{STAGE_WORDS[stage]}</span>
                <span className="text-[var(--muted-foreground)]">{board.columns[stage] ?? 'no column'}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setDraft(board)}>
              Change
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void send(null)}>
              Stop moving issues
            </Button>
          </div>
        </div>
      ) : null}
      {!board && !editing && !found ? (
        <p className="text-[var(--muted-foreground)]">Not mapped: jobs stay on the Factory board, and no issue is moved.</p>
      ) : null}
      {!editing ? (
        <Button size="sm" variant="outline" className="h-6 w-fit px-2 text-xs" disabled={looking} onClick={() => void look()}>
          {looking ? 'Looking…' : 'Find the project\'s boards'}
        </Button>
      ) : null}
      {trouble ? <p className="text-[var(--destructive)]">{trouble}</p> : null}
      {found && !editing ? (
        found.boards.length ? (
          <label className="flex flex-col gap-1">
            <span className="text-[var(--muted-foreground)]">Boards {found.from} found for {found.repo}:</span>
            <select className="rounded border bg-transparent p-1" defaultValue="" onChange={(event) => choose(event.target.value)} aria-label="the board to map onto">
              <option value="" disabled>
                choose a board…
              </option>
              {found.boards.map((one) => (
                <option key={one.board} value={one.board}>
                  {one.board} ({one.columns.length} columns)
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-[var(--muted-foreground)]">{found.repo} is on no board {found.from} can see.</p>
        )
      ) : null}
      {editing ? (
        <form
          className="flex flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            void send({ ...editing, confirmed: true })
          }}
        >
          <p className="text-[var(--muted-foreground)]">
            “{editing.board}”: where each stage puts the job's issue. {editing.confirmed ? '' : 'Guessed from the column names; check it.'}
          </p>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
            {BOARD_STAGES.map((stage) => (
              <label key={stage} className="contents">
                <span>{STAGE_WORDS[stage]}</span>
                <select
                  className="rounded border bg-transparent p-0.5"
                  value={editing.columns[stage] ?? ''}
                  aria-label={`the column for ${STAGE_WORDS[stage]}`}
                  onChange={(event) => setDraft({ ...editing, columns: { ...editing.columns, [stage]: event.target.value || null } })}
                >
                  <option value="">no column (do not move)</option>
                  {columnsOf(editing.board).map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="flex gap-1">
            <Button type="submit" size="sm" className="h-6 px-2 text-xs" data-testid="save-board">
              Save this mapping
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
