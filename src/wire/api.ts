import { answered, ask, follow, ticket } from 'kehikot-module-protocol/client'

import type { BoardMap } from '../../job/board.ts'
import type { Job, QueueItem, Settings } from '../../job/shape.ts'

/**
 * This module's own `/api`, as the page calls it. Every call carries the ticket printed into this
 * page — reads too: what is read here is a project's work. `follow` keeps the live line open and
 * reconnects when it drops.
 */

export type BoardJob = Job & { files: string[]; lately: { at: number; line: string } | null }

export interface Board {
  root: string
  jobs: BoardJob[]
  settings: Settings
  queue: QueueItem[]
}

export type Act =
  | { act: 'approve'; job: string }
  | { act: 'send-back'; job: string; note: string }
  | { act: 'angles'; job: string; angles: { id: string; brief?: string }[] }
  | { act: 'archive'; job: string }
  | { act: 'settings'; judgeMerges: boolean }
  | { act: 'queue'; items: { id?: string; text: string; epic?: string | null; parts?: string[] }[] }
  | { act: 'parts'; epic: string; parts: { id: string; heading: string }[] }
  | { act: 'board'; board: BoardMap | null }

export interface FoundBoard {
  board: string
  boardUrl?: string
  columns: string[]
}

export interface Columns {
  remote: { kind: 'github' | 'gitlab'; repo: string } | null
  found?: { ok: true; kind: 'github' | 'gitlab'; repo: string; boards: FoundBoard[] } | { ok: false; why: string }
}

export interface Api {
  board(projectPath: string): Promise<Board>
  file(projectPath: string, job: string, name: string): Promise<string | null>
  act(projectPath: string, act: Act): Promise<string>
  watch(projectPath: string, changed: () => void): () => void
  /** The project's remote, and with `cli` the boards the person's gh/glab finds. */
  columns(projectPath: string, cli: boolean): Promise<Columns>
}

export const api: Api = {
  async board(projectPath) {
    const body = answered(await ask<Board & { ok: true }>('./api/jobs', { query: { projectPath }, ticket: true }))
    return { root: body.root, jobs: body.jobs, settings: body.settings, queue: body.queue }
  },
  async file(projectPath, job, name) {
    return answered(await ask<{ text: string | null }>('./api/file', { query: { projectPath, job, name }, ticket: true })).text
  },
  async act(projectPath, act) {
    return answered(await ask<{ said: string }>('./api/act', { body: { projectPath, ...act } })).said
  },
  async columns(projectPath, cli) {
    const body = answered(await ask<Columns>('./api/columns', { query: { projectPath, ...(cli ? { look: 'cli' } : {}) }, ticket: true }))
    return { remote: body.remote, ...(body.found ? { found: body.found } : {}) }
  },
  watch(projectPath, changed) {
    return follow('./api/watch', () => changed(), { query: { projectPath, ticket: ticket() }, events: ['changed'], probe: true })
  },
}
