# Factory — a software factory on your kehikko

Type one sentence. Get a reviewed, judged change on its own branch, and the last word on whether
it lands.

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

## Getting it

Install Factory from Kehikot's module list, then install the `/factory` skill from the Skills window.

Everything Factory keeps is in your project under `.kehikot/factory/`; the code it builds sits in
`../<project>-factory/<job>/` until it is merged.

---

Inspired by ZazenCodes' software factory.
