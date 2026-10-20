import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Api, Board, FoundBoard } from '@/wire/api'
import { BoardMapView } from '@/view/board-map'

/**
 * What the person keeps for this project: the queue `/factory next` takes from, and the one switch
 * that lets the judge merge by itself (off unless they turn it on).
 */
export function QueueView({ board, projectPath, epic, parts, api, hostBoards, onSaid }: { board: Board; projectPath: string; epic: string | null; parts: string[]; api: Api; hostBoards: () => Promise<FoundBoard[] | null>; onSaid(said: string): void }) {
  const [text, setText] = useState('')
  const said = (promise: Promise<string>) => promise.then(onSaid, (e: unknown) => onSaid(e instanceof Error ? e.message : String(e)))
  const items = board.queue
  const save = (next: { id?: string; text: string; epic: string | null; parts: string[] }[]) => said(api.act(projectPath, { act: 'queue', items: next }))
  return (
    <div className="flex flex-col gap-3 p-2 text-xs" data-testid="queue-view">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={board.settings.judgeMerges}
          data-testid="judge-merges"
          onChange={(event) => said(api.act(projectPath, { act: 'settings', judgeMerges: event.target.checked }))}
        />
        <span>
          Let the judge merge approved jobs by itself
          <span className="block text-[var(--muted-foreground)]">
            Off: every approved job waits for you. On: a job the judge rules ready is merged into main in this project, unless it conflicts.
          </span>
        </span>
      </label>
      <BoardMapView board={board.settings.board} projectPath={projectPath} api={api} hostBoards={hostBoards} onSaid={onSaid} />
      <div className="flex flex-col gap-1">
        <span className="font-medium">Queue for /factory next</span>
        {items.length ? (
          <ol className="flex flex-col gap-1">
            {items.map((item, i) => (
              <li key={item.id} className="flex items-start gap-1 rounded border px-1.5 py-1">
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item.text}</span>
                <button type="button" aria-label="move up" disabled={i === 0} className="px-1 disabled:opacity-30" onClick={() => save([...items.slice(0, i - 1), item, items[i - 1]!, ...items.slice(i + 1)])}>
                  ↑
                </button>
                <button type="button" aria-label="remove" className="px-1" onClick={() => save(items.filter((one) => one.id !== item.id))}>
                  ×
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[var(--muted-foreground)]">Empty. /factory next then takes a part of your epic that has no job yet.</p>
        )}
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            const said = text.trim()
            if (!said) return
            setText('')
            void save([...items, { text: said, epic, parts }])
          }}
        >
          <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="a feature to build next…" className="h-6 text-xs" aria-label="a feature to queue" />
          <Button type="submit" size="sm" variant="outline" className="h-6 px-2 text-xs">
            Queue
          </Button>
        </form>
      </div>
    </div>
  )
}
