import { existsSync, watch, type FSWatcher } from 'node:fs'

import { isRunning } from './job/flow.ts'
import { factoryDir, listJobs } from './store.ts'
import { transcriptOf } from './transcript.ts'

/**
 * What tells the board to read again: a change anywhere in the project's `.kehikot/factory/` (a job
 * moved, an agent wrote its file, the queue changed), or in the transcript of a conversation running
 * a job (a live line on its card). Watched by the server with `fs.watch`, and said to the page on its
 * stream as "something changed" — never what changed, so a stream carries nothing a page could not
 * read through its ticketed `/api` anyway.
 *
 * Until the folder exists (no job yet), the server looks for it every few seconds; nothing is made
 * just because a page is watching.
 */

export const SETTLE_MS = 200
export const LOOK_FOR_FOLDER_MS = 3000

export function watchProject(root: string, changed: () => void): () => void {
  let folder: FSWatcher | null = null
  const transcripts = new Map<string, FSWatcher>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let looking: ReturnType<typeof setInterval> | null = null
  let closed = false

  const followTranscripts = () => {
    const wanted = new Set<string>()
    for (const job of listJobs(root)) {
      if (!isRunning(job) || !job.session) continue
      const path = transcriptOf(job.session)
      if (path) wanted.add(path)
    }
    for (const [path, watcher] of transcripts) {
      if (wanted.has(path)) continue
      watcher.close()
      transcripts.delete(path)
    }
    for (const path of wanted) {
      if (transcripts.has(path)) continue
      try {
        transcripts.set(path, watch(path, () => settle(false)))
      } catch {
        /* Gone between the listing and the watch: the next change looks again. */
      }
    }
  }

  const settle = (jobsMayHaveMoved: boolean) => {
    if (closed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (closed) return
      if (jobsMayHaveMoved) followTranscripts()
      changed()
    }, SETTLE_MS)
  }

  const start = (): boolean => {
    const dir = factoryDir(root)
    if (!existsSync(dir)) return false
    try {
      folder = watch(dir, { recursive: true }, () => settle(true))
      folder.on('error', () => undefined)
    } catch {
      return false
    }
    followTranscripts()
    return true
  }

  if (!start()) {
    looking = setInterval(() => {
      if (start()) {
        if (looking) clearInterval(looking)
        looking = null
        settle(true)
      }
    }, LOOK_FOR_FOLDER_MS)
  }

  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    if (looking) clearInterval(looking)
    folder?.close()
    for (const watcher of transcripts.values()) watcher.close()
    transcripts.clear()
  }
}
