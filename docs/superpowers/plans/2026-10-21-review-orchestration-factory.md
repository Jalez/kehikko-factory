# Review orchestration, Factory part (C5): `/review-factory`

> For agentic workers: superpowers:executing-plans, task by task, test first. The contracts in the
> master plan (`Jalez/kehikko-review` `docs/superpowers/plans/2026-10-21-review-orchestration.md`)
> are binding: C1 (Checklist `check_item` with `state`, the `[x] [!] [-] [ ]` print), C2 (protocol
> 2.7.0 row fields), C4 (Review `add_comment` `meta`, `propose_review`, `drop_run_comments`,
> `POST /api/factory/send` with `X-Kehikot-Factory-Key`), C5 (this). Spec: `docs/superpowers/specs/
> 2026-10-21-review-orchestration-design.md` in the same repository.

**Goal:** a person types `/review-factory [<ref>]` in a Claude Code conversation placed on a kehikko
that has Factory. Factory gathers the change, its epic's vision and its checklists, then hands the
conversation one step at a time — planner, two reviewers, one adversary, one judge, and a diagram
agent only when asked — validates the reviewers' points mechanically, drafts the result into
Review and the checklist states into Checklist, and shows every run live on a **Reviews** board.

**Architecture:** the build-job flow (`job/`, `factory.ts`) is untouched. The review panel's
generic parts go in `review/` (no Factory imports): the structured point shape and its parsers
(`review/points.ts`), a unified-diff reader (`review/diff.ts`), mechanical validation
(`review/validate.ts`), the panel's rules (`review/panel.ts`) and the panel prompts (added to
`review/prompts.ts`, built from the same angle list and the same rules of plain writing). Factory's
side is `rev/` (state, flow, store, gather, checkout, forge, neighbours, budget, door rules,
re-review rules, background sessions, steps) and `review-factory.ts` (what the skill asks, what a
report does, what the person presses). The page gains a View switch "Reviews" with its own board.

**Agreed with the orchestrator (2026-10-21):** "use for all projects" author rules are kept at
`~/Library/Application Support/Kehikot/factory/author-rules.json` (`KEHIKOT_FACTORY_DIR`
overrides; the host adds the allowlist entry). The decision briefing is always `briefing.md` in
the record, and also a pending "Decision briefing: <change>" section filed with Paper's
`propose_edit` when the change's epic already has a paper. Factory never creates a paper.

## Task 0: protocol 2.7.0

- `package.json`: `kehikot-module-protocol` → `#v2.7.0`; `bun install`; typecheck and tests pass.

## Task 1: the structured point and its parsers — `review/points.ts`

Every agent of the panel writes markdown for a person and ONE fenced ```json block the module
reads. `jsonBlock(text): unknown | null` finds the last ```json fence.

```ts
evidenceSchema = { kind: 'line'|'test'|'doc'|'practice', ref: string(1..500), quote?: string(..1000) }
panelPointSchema = { path, side: 'new'|'old' = 'new', line: int>0, startLine?: int>0, quote: string(1..4000),
  claim: string(1..400), why: string(1..400), suggestion: string(1..400), severity: 'blocking'|'risk'|'nice',
  evidence: evidence[] (min 0 here; validation refuses none), checklist: string[] = [], listed?: string,
  close?: boolean }
answerSchema = { checklist: string, item: string, state: 'pass'|'fail'|'n/a', note: string }
reviewerOutput = { verdict: 'APPROVE'|'CHANGES', points: panelPoint[], answers: answer[], close?: { why, instead } }
plannerOutput = { angles: [{ id, brief, practices: [{ name, source }] , items: string[] }] (exactly 2),
  door: { kind: 'one-way'|'two-way', reasons: string[] (≥1) }, uiux: { touches: boolean, reason: string, screens: string[] },
  proposedChecklist?: string[] (≤15) }
challengeOutput = { challenges: [{ point: string, concede: boolean, case: string, evidence: evidence[] }], close?: boolean }
judgeOutput = { rulings: [{ point, ruling: 'required'|'optional'|'rejected', reason }], verdict:
  'approve'|'comment'|'request-changes'|'close', visionFit: string, summary: string,
  close?: { why, instead }, diagrams: [{ point, kind: 'sequence'|'graph', now: string, proposed: string }] }
```
`parsePlanner(text)`, `parseReviewer(text)`, `parseChallenge(text)`, `parseJudge(text)`: `Parsed<T>`
with one sentence on what is wrong (the run gives the agent one more try, then stops).

Tests (`test/points.test.ts`): a good block parses; no block, bad JSON, a third angle, 16 proposed
items, an unknown severity each say why in one sentence; the last ```json block wins.

## Task 2: reading a diff — `review/diff.ts`

`parseUnified(text): DiffFile[]` (`{ path, from, hunks: [{ lines: [{ kind: 'add'|'del'|'ctx', old, new, text }] }] }`),
`linesAt(files, { path, side, line, startLine? }): { ok: true; text: string } | { ok: false; why }`
(one hunk, lines that exist on that side), `totals(files)` (files, added, removed).

Tests (`test/diff.test.ts`): new/old sides, a range inside one hunk, a range across hunks refused,
a line not in the diff refused, a renamed file found by either name, totals.

## Task 3: mechanical validation — `review/validate.ts`

`validatePoints(points, files, { maxChars = 600, perReviewer, delta? }): { kept, rejected: { point, why }[], over: point[] }`
- anchor not in the diff → rejected ("line N of path is not in this diff");
- quote does not match the lines (whitespace-insensitive, the quote must be contained in the
  anchored lines or the lines in the quote) → rejected;
- no evidence → rejected; only `kind: 'line'` evidence on the point's own lines while the claim is
  about behaviour elsewhere (`claim`/`why` name another path) → rejected;
- `claim + why + suggestion` over 600 characters → rejected;
- re-review (`delta` given): a new point whose anchor is not in the delta, and that is not
  `listed`, → rejected ("not new code; a re-review raises new points only about new code");
- over `perReviewer` (kept by severity, blocking first) → `over` (the record's "what I didn't get to").

`validateAnswers(answers, assigned)`: an answer with no note, or for an item not assigned to that
reviewer, is refused; an assigned item with no answer is listed as skipped (never silent).

`mergeNearDuplicates(points)`: same path and overlapping lines, or the same normalised claim
words (Jaccard ≥ 0.6) on any path → one point listing every place (`also: [{ path, line }]`),
highest severity kept, evidence joined.

Tests (`test/validate.test.ts`): each rule, merge keeps all places, the cap keeps blocking first.

## Task 4: the panel's rules — `review/panel.ts`

`rulePanel({ points, rulings, verdict, reviewers: { close?: boolean }[], challenge: { close?: boolean } , judgeClose })`:
- every surviving point gets a ruling (one the judge skipped is `optional`, then subject to the cap);
- at most 3 optional, the rest `rejected` with "over the cap of three optional points";
- any required → verdict `request-changes`; none → `approve` or `comment`, never `request-changes`;
- `close` only when both reviewers, the adversary and the judge said close; otherwise
  `request-changes` and a note saying it was not unanimous;
- `pathToSuccess`: exactly the required points, numbered, each "what to do (where)".

Tests (`test/panel.test.ts`): cap, verdict forced, close unanimous and not, path lists exactly the
required points.

## Task 5: panel prompts — `review/prompts.ts`

Add `PanelSubject` (packet file, diff command or file, checkout folder, the record's files, budget,
`runTests` sentence, round and listed points) and `panelPlannerPrompt`, `panelReviewerPrompt`,
`adversaryPrompt`, `panelJudgePrompt`, `diagramPrompt`. Shared: `PLAIN` (short, plain words, what
is wrong / why / what to do), the KNOWN_ANGLES list, the JSON shape spelled out. The build-job
prompts are unchanged (their tests still pass word for word).

Tests (`test/panel-prompts.test.ts`): each prompt names the file it writes, the JSON shape, the
caps, "read only" and the run-tests sentence only when on; a re-review prompt names the listed
points and says new points only about new code.

## Task 6: the run — `rev/shape.ts`, `rev/flow.ts`

```ts
REVIEW_STAGES = ['queued','gathering','planning','reviewing','challenging','judging','diagrams','waiting','sent']
RUN_ID = /^[a-z0-9][a-z0-9-]{0,40}-[0-9a-f]{4}$/
runSchema: { version: 1, id, createdAt, updatedAt, stage, session|null, background: boolean, place|null,
  change: { forge, host?, repo, number, url, ref, title, author: { login, name? } | null, labels },
  round: 1..3, previous: id|null, listed: { id, text }[],
  pinned: { head, base, mergeBase, at } | null, checkout: { path, present } | null,
  budget: { files, lines, pointsPerReviewer, filesBeyondDiff, tokens }, spend: { step, tokens, cached }[], stepAt: string|null,
  vision: { epic: string|null, said: string },
  checklists: { id, name, items: { id, text, state: 'passed'|'failed'|'na'|null, byPerson: boolean, by?, note? }[] }[],
  proposed: string[] | null,
  plan: { angles: { id, brief, by, items: string[] }[], door, doorRule: string|null, uiux } | null,
  points: Point[], rejected: { point: string, why }[], skipped: string[],
  answers: { checklist, item, state, note, by }[], challenges, judged, diagrams: string[],
  drafted: { at, comments, refused: { point, why }[], proposal: boolean, ticks: number, notes: string[] } | null,
  sent: { at, by: 'factory'|'person' } | null,
  waiting: { why: 'checklist'|'drafted'|'moved-on'|'stopped'|'cap', said } | null,
  notes: string[], tries: Record<step, number>, history }
```
`advanceRun(run, event, settings, now)`, pure. Events: `claim`, `gathered`, `planned`,
`checklist-accepted`, `reviewed`, `challenged`, `judged`, `diagrammed`, `drafted`, `moved-on`,
`sent`, `stop`, `angles`, `budget`. Rules: angles change only before `reviewing`; a planned run
with a proposed checklist and no checklist held stays in `planning` waiting for the person; no
points survive → `judging` (no adversary); the judge asks for a diagram and Flows is on the
kehikko and the change is in an epic → `diagrams`, else `waiting` (or `sent`).

Tests (`test/run-flow.test.ts`): every edge, the checklist wait, the skipped adversary, diagrams
only when asked and possible, angles refused after reviewing starts.

## Task 7: store and record — `rev/store.ts`

`.kehikot/factory/reviews/<id>/run.json` + record files with fixed names: `packet.md`,
`diff.patch`, `plan.md`, `review-<angle>.md`, `validation.md`, `challenge.md`, `judgement.md`,
`diagrams.md`, `briefing.md`, `draft.md`, `budget.md`. Also `reviews/seen.json` (what the page saw:
kehikko keys with the modules on them, the selection), `reviews/rows.json` (the tracker rows of
the changes under review, from the page), `reviews/questions.json` (first-time author questions),
`reviews/authors.json` (this project's author rules). `RECORD_FILE` regex; never a path from a
request. Settings gain `review: { postTwoWay: false, reReviewByItself: false, runTests: false,
doorRules: [], defaultRule }` (defaults keep old files readable).

Tests (`test/run-store.test.ts`): write/read/list, refused names, a symlinked folder refused,
old settings files read with the new defaults.

## Task 8: the change — `rev/forge.ts`, `rev/checkout.ts`

`locate(text, remote)`: a PR/MR URL, `owner/repo#N`, `group/project!N`, `gh#N`, `!N`, `#N` (in
the project's repo); an issue URL is refused ("an issue is not a change"). `readMeta(root, change, run)`
via `gh pr view N --repo R --json …` / `glab api projects/…/merge_requests/N` (injectable `Run`):
title, body, author login, base branch, head sha, labels, commits, linked issues, comments.
`checkout(root, id, change, meta)`: the change must be in the project's origin; `git fetch origin`
the head (`pull/N/head`, `merge-requests/N/head`) and base into `refs/factory-review/<id>/…`, a
detached worktree at the pinned head at `../<repo>-factory/review-<id>/`, `mergeBase`, the diff.
`removeCheckout(root, run)`: worktree and refs gone, the person's checkout untouched.

Tests (`test/checkout.test.ts`): against a scratch "origin" with `refs/pull/7/head`: the worktree is
at the head, the diff is base…head, the project's own checkout and branch are unchanged, removal
leaves nothing; a change in another repository is refused.

## Task 9: the others — `rev/neighbours.ts`

`Neighbours { present(id): Promise<boolean>; call(id, tool, args): Promise<{ ok, text }>; send(body, key): Promise<{ status, text }> }`,
real through `readNeighbour` and JSON-RPC `tools/call` on its door. On top:
`checklistsHeld(n, root, refs)` (parses `checklists` and each list's C1 print: `[x]` passed,
`[!]` failed, `[-]` n/a, `[ ]` unchecked, "over MCP" ticks are not the person's),
`createChecklist(n, root, ref, name, items)`, `setStates(n, root, ref, answers, lists)` (never an
item the person set; their disagreement is returned as notes), `draftToReview(n, root, run)`
(`drop_run_comments` for earlier runs of the change, `add_comment` with `meta`, `propose_review`),
`proposeBriefing(n, root, epic, title, text)` (Paper `propose_edit` before `\end{document}`).

Tests (`test/neighbours.test.ts`) with a stand-in: the exact tool calls and arguments; a person's
tick never touched; a refused comment recorded with Review's sentence.

## Task 10: vision — `rev/vision.ts`

`epicOf(root, change, remote)`: the host epic (`.kehikot/host/epics/*.json`, legacy folder as
fallback) whose umbrella, steps, parts or journey steps/groups name the change; `visionOf(root,
slug)`: title, lede, callout, parts, and from Journeys goal, measure, appetite, rabbitHoles,
noGos when present.

Tests (`test/vision.test.ts`): found by `gh#N` and `gh:owner/repo#N`; Journeys fields included only
when present; a change in no epic says so.

## Task 11: budget — `rev/budget.ts`

`sizeBudget(files, lines)` → small/medium/large caps (points per reviewer 4/6/8, files beyond the
diff 5/10/20, tokens 150k/300k/600k); `spentSince(session, sinceIso, dir)` sums the conductor's
transcript and its subagents' (`<session>/subagents/*.jsonl`) assistant usage (input + output +
cache creation; cache reads apart), deduplicated by message id. Over the soft budget: the next
step is not started; the run goes to the judge with what it has (or to waiting) and says what it
did not get to.

Tests (`test/budget.test.ts`): sizes, a scratch transcript summed once per message, since-filter.

## Task 12: door rules and UI/UX — `rev/doors-rule.ts`

`doorByRules(rules, paths, labels)`: `{ kind: 'path', glob, door }` and `{ kind: 'label', label, door }`;
one-way wins over two-way. Applied before the planner, given to it, and never weakened by it
(a planner's two-way under a one-way rule is one-way; in doubt one-way). `hasBeforeAfter(body,
comments)`: two or more images with "before"/"after" near them. A UI/UX change without them gets
a required general point naming the screens.

Tests (`test/door-rules.test.ts`).

## Task 13: re-review — `rev/rerev.ts`, `rev/authors.ts`, `rev/background.ts`

`parseRule(sentence)` → `{ any: Signal[] }` with signals `re-request`, `after-push { hours, answered }`,
`comment { word }`, `label { label }`, `manual`; an unreadable sentence is refused with examples.
`DEFAULT_RULE` = "when they re-request review, or 2 hours after the last push with new commits and
every point answered". `due(rule, row, last, comments, now)` from the C2 fields (`myRoles`,
`lastPushAt`, `discussions`, `labels`). `MAX_ROUNDS = 3`. Author rules: project
(`reviews/authors.json`) over machine (`author-rules.json` under `KEHIKOT_FACTORY_DIR` or
`~/Library/Application Support/Kehikot/factory/`). First time an author with no rule needs a
re-review: a question (Inbox item + on the card) with the project default as the one-press answer.
`startBackground(root, run, place)`: `claude --bg --name=<title> "/review-factory resume <id>"`,
argv only, as kehikko-orchestrator's `start.ts`; injectable spawn.

Tests (`test/rerev.test.ts`): parsing, each signal, the cap, the question asked once, background
argv; nothing starts without the switch.

## Task 14: the server — `review-factory.ts`, `rev/steps.ts`

`sayReview({ session, say, cwd })`: refuses without a placed conversation on a kehikko where the
page saw Factory, and without a PR/MR (a sentence each). Commands: `[<ref>]`, `status`, `resume
<id>`, `angles <id> a,b`, `checklist <id> accept|edit <item; item>`, `budget <id> points=N
files=N tokens=N`, `stop <id>`. `doneReview(report)`: reads the step's file, parses, retries once,
validates, advances, and answers the next STEP or Stop. Draft: head re-read (moved → waiting),
Review draft, Checklist states, Paper briefing, checkout removed, then the send when
`postTwoWay` and allowed (two-way, no UI/UX, a judge's verdict) with the key read from
`KEHIKOT_KEYS_DIR`/`review-factory.key`. `actReview(root, body)`: the page's presses (settings,
door rules, author rules, the answer to a question, accept/edit checklist, angles, budget, stop,
clear) — person only (ticketed). `pageSaw(root, seen)` and `pageRows(root, rows)` (re-review detection).

Tests (`test/review-factory.test.ts`): a whole run with stand-in agents, Review and Checklist;
refusals; the checklist wait; a malformed answer once then stop; a moved head stops at waiting
with nothing drafted; a one-way or UI/UX change never sent; a two-way one sent only with the
switch; a re-run drops only that change's earlier run comments; budget over → said.

## Task 15: the skill — `plugin/skills/review-factory/SKILL.md`, `skills.ts`

`declares.skills` gains `review-factory`, served with the origin filled in,
`disable-model-invocation: true`, `allowed-tools: Bash(curl:*), Bash(echo:*)`.
Tests (`test/skills.test.ts`): passes `skillTextIssue`, never-fail `!` line, exact allowed-tools.
Verified by hand with the real `claude` in a scratch `CLAUDE_CONFIG_DIR` and a stand-in model.

## Task 16: doors and the page

`doors.ts`: `/api/review/say`, `/api/review/done` (the skill), page routes (`/api/reviews`,
`/api/review-file`, `/api/review-act`), MCP `reviews` and `review` (read-only; Review reads the
record there). Page: View switch "Reviews"; `ReviewBoard` with the nine columns (Diagrams only when a
run is there), cards with checklist progress ("7 of 12 checked · 1 failed"), door and UI/UX marks,
the question; `ReviewView` (checklist items with state and note, the record files as text);
settings (the three switches, door rules, author rules). The page reports kehikko + containers +
selection and the tracker rows of open changes. Inbox: runs waiting, first-time questions.

Tests (`test/review-render.test.tsx`, `test/review-inbox.test.ts`).

## Task 17: README, typecheck, tests, PR.
