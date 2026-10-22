# Factory — a software factory on your kehikko

Type one sentence. Get a reviewed, judged change on its own branch, and the last word on whether
it lands. Or point it at a pull or merge request and get a review people actually read: right about
the code, right about the lines, short, and honest about how it was made.

```
/factory Let people pick a dark theme --angles accessibility,ux-copy
```

Factory turns that into a job and walks it down a line of agents, each with one job to do:

1. **A spec writer** reads your project and writes what "done" means: the goal, what it must do,
   what is left out, and what it assumed where you left it open.
2. **A planner** chooses who should review *this* change. A copy fix does not need a data-migration
   reviewer; a schema change badly does. It picks the angles that matter — security, data
   migration, accessibility, performance, API compatibility, tests, UX copy, or others — and writes
   each reviewer a brief. You can add or remove angles on the board until the reviews start, or name
   them yourself with `--angles`.
3. **A builder** works in its own git worktree, on its own branch (`factory/<job>`), beside your
   project — never in your checkout. It runs your tests and commits.
4. **Reviewers**, one per angle, read the change in parallel, each from its own point of view.
5. **A counter-arguer** answers every review that asks for changes with the strongest honest case
   against it: the change is not needed, or the builder's choice was right.
6. **A judge** reads both sides and rules on every point: *required*, *optional* or *rejected*. Only
   the required points go back to the builder — at most twice. Then the judge has the last word:
   ready to merge, or one for you to weigh.

By default **every job ends with you.** Approve and merge it from the board (or
`/factory approve <job>`), or send it back with a note. If you trust the line, one switch per
project — *Let the judge merge approved jobs by itself* — lets the judge merge. A merge goes to your
main branch with a merge commit; if main moved and it conflicts, nothing is merged and the job is
handed back to you. Once a merge is confirmed, the job's worktree and branch are cleaned away.

## The board

A Factory container on your kehikko shows the epic's jobs as cards moving across **Spec → Plan →
Build → Review → Judge → Waiting for you → Merged** (and Failed). Each card shows its round, its
review angles, its issue, and a live line of what the conversation running it is doing right now.
Press a card to read its files: the spec, the plan, every review, every counter-argument, every
judgement, and the decision. The board follows the files as the agents write them.

Jobs belong where you started them: a conversation placed on an epic's parts puts its jobs there,
and the board narrows with the parts you pick. View › All jobs shows the whole project.
With **All epics** chosen in the host's epic picker, both the Jobs and the Reviews board show the
whole project — every epic's items, and those started on no epic — each card labelled with its epic
(or "no epic").

A job waiting for you lands in Kehikot's Inbox at its place, and so does one that failed.

## Your own board, too

Map Factory's stages onto your project's kanban — a GitHub Project's Status, or a GitLab board's
lists — in the board's settings. Factory offers a guess from the column names; nothing moves until
you confirm it, and any stage can map to *no column*. From then on, as a job changes stage, the
conversation running it moves the job's issue with your own `gh` or `glab`. A job without an issue
can get one (`/factory issue <job> new`) or stay on the Factory board.

## Commands

| Typed in Claude Code | What happens |
| --- | --- |
| `/factory <feature> [--angles a,b] [--issue ref]` | start a job |
| `/factory next` | build what is next: a job you sent back, your queue on the board, or a part of your epic with no job yet |
| `/factory approve <job>` | merge a job that is waiting for you |
| `/factory rework <job> <note>` | send it back to the builder with your note, and build it now |
| `/factory issue <job> new\|<ref>\|none` | open, link or drop the job's issue |
| `/factory status` | the project's jobs |

Agents read jobs through Factory's MCP door (`jobs`, `job`), and other modules read a job's live
stage by its issue (`GET /api/jobs?ref=…&projectPath=…`). No agent can start, approve or merge a
job: those are yours.

## Reviews: `/review-factory`

```
/review-factory https://github.com/you/app/pull/42
```

Or select the change on the canvas and type just `/review-factory`. It is offered only in a
conversation on a kehikko that has both Review and Factory on it (it drafts into Review), and says
which is missing if you type it elsewhere. It reviews pull and merge requests only — to review your own work first, open
a draft.

A panel works on it, and Factory checks every step:

1. **Gather.** The change at one pinned head, checked out in a worktree of its own (your project is
   never switched), its description and commits, the epic it belongs to — its lede, its parts, and
   from Journeys its goal, appetite, rabbit holes and no-gos — and the checklists held against it.
   A budget sized to the change, which you can change before and during the run.
2. **Plan.** Two angles chosen for *this* change, each with the practices that apply and their
   sources. The checklist is split between the two reviewers. No checklist? The planner proposes
   one, and the review waits for you to accept or edit it; it is then made in Checklist and held
   against the change. The planner also says whether the change is **one-way** (hard to undo) or
   **two-way**, with reasons — your project's rules first ("anything under `migrations/` is
   one-way"), and when in doubt, one-way — and whether it touches what people see.
3. **Review.** Two reviewers at once. Every point is anchored to the lines that show it, quotes
   them, gives at least one source, says what is wrong, why it matters and what to do in under 600
   characters, and has a severity. Every checklist item gets passed, failed or not applicable, with
   how they know.
4. **Validate** (Factory, no agent). A point whose anchor is not in the diff, whose quote is not
   what those lines say, with no source, or too long is refused, with the reason, before anyone
   argues about it. Duplicates become one point listing every place.
5. **Challenge.** One adversary concedes each point or makes the strongest honest case against it.
6. **Judge.** Every point ruled required, optional (three at most) or rejected, with a reason. The
   fit with the epic in one sentence, the verdict, a summary that fits on a screen, and — whenever
   it does not approve — **"To get this approved:"**, exactly the required points. When nothing
   blocks, it says so. Closing a change takes the whole panel agreeing.
7. **Draft** (Factory, no agent). The kept points become draft comments in Review, with their
   evidence, the challenge and the ruling; the summary and verdict are proposed beside yours, never
   over them; the checklist answers are set in Checklist as Factory's — never over a tick you set.
   A diagram the judge asks for is drawn in Flows, in the change's epic. A one-way change also gets
   a **decision briefing** — the decisions, the alternatives, what cannot be undone, and what to try
   yourself — in the record, and as a suggested section of the epic's paper when it has one.

Nothing is posted until you send it from Review. The one exception is yours to turn on: *Post
two-way reviews by myself* sends a two-way change that touches nothing people see. A one-way change
and anything with UI/UX always wait for you, and a UI/UX change without before and after pictures
gets a required point naming the screens.

A re-review judges only what changed since the last one and whether the listed points were met —
no moving goalposts. When to look again is per author, in your words ("when they re-request
review", "2 hours after the last push, every point answered", "when they comment ready"); the first
time Factory meets an author it asks you, with a recommended answer, in the Inbox and on the card.
With *Re-review by myself* on, a re-review runs in a background Claude Code session, at most three
rounds per change.

**The Reviews board** (View › Reviews) shows every review across Queued → Gathering → Planning →
Reviewing → Challenging → Judging → (Diagrams) → Waiting for you → Sent, live, with checklist
progress on each card ("7 of 12 checked · 1 failed"). A card opens **How this review was made**:
the packet, every agent's output, every refusal and why, the rulings, the checklist answers, the
budget and what was spent. Reviewers read by default; *Reviewers may run this project's tests* lets
them run only your own test command, in the review's checkout. All three switches are off until you
turn them on.

| Typed in Claude Code | What happens |
| --- | --- |
| `/review-factory [<change>]` | review it (the selected change when none is named) |
| `/review-factory checklist <review> accept\|edit <item>; …` | accept the proposed checklist, or yours instead |
| `/review-factory angles <review> a,b` | the two angles, before the reviewers start |
| `/review-factory budget <review> points=N files=N tokens=N` | change the budget |
| `/review-factory resume <review>` / `stop <review>` / `status` | carry one on, stop one, list them |

Agents read reviews through Factory's door (`reviews`, `review`); other modules read a change's
reviews and their records at `GET /api/reviews?change=<url>&projectPath=…`. No agent can start,
steer or send a review.

## Getting it

Install Factory from Kehikot's module list, then install the `/factory` skill from the Skills
window. `/review-factory` is not installed for every conversation: a conversation started from a
kehikko with Review and Factory on it has it.

Everything Factory keeps is in your project under `.kehikot/factory/` (reviews under
`.kehikot/factory/reviews/<id>/`); the code it builds sits in `../<project>-factory/<job>/` until it
is merged, and a review's checkout in `../<project>-factory/review-<id>/` until the review is done.
Author rules you say are for all projects are kept in Kehikot's machine folder.

---

Inspired by ZazenCodes' software factory.
