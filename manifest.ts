import { MANIFEST_KIND, PROTOCOL, WORK_STATUS, manifestSchema, type Manifest } from 'kehikot-module-protocol'
import pkg from './package.json'
import { SETTINGS } from './settings.ts'
/* This module's introduction (protocol 2.57.0): slides the host shows in its introduction dialog. Also
   read as a file from the repository, so a person can watch it before the module runs or is installed. */
import intro from './intro.json'

/** "How to use" (protocol 2.52.0). Each string one line of plain text. */
export const HELP = {
  summary: 'A software factory on your kehikko: a line of agents builds each change and a judge rules on it, and /review-factory drafts reviews of pull and merge requests into your draft review.',
  sections: [
    {
      title: 'What it shows',
      points: [
        'Jobs: the epic’s jobs as cards across Spec, Plan, Build, Review, Judge, Waiting for you, Merged and Failed, each with its round, review angles, issue and what its conversation is doing now.',
        'Reviews: every /review-factory run across Queued, Gathering, Planning, Reviewing, Challenging, Judging, Waiting for you and Sent, with checklist progress on each card.',
        'Choose the board in the header’s Board switch. The boards narrow with the parts picked in the bar; All epics shows the whole project, each card labelled with its epic.',
        'Press a card to read its files: the spec, the plan, every review, counter-argument and ruling, and the decision. A review card opens How this review was made.',
      ],
    },
    {
      title: 'How to use it',
      points: [
        'Start a job by typing /factory and what you want in a Claude Code conversation on this kehikko. /factory next builds what is next.',
        'A job waiting for you, or one that failed, lands in the Inbox. Approve and merge it, or Send back with a note, from the header or with /factory approve and /factory rework.',
        'Review a pull or merge request with /review-factory, on a kehikko that also has a module that keeps your draft reviews. The comments are drafted there; you send them from there.',
        'Settings in the header, or the gear on the container, holds the switches: let the judge merge, post two-way reviews by myself, re-review by myself, reviewers may run tests, and the door rules.',
        'Map Factory’s stages onto your own GitHub or GitLab board in the board’s settings, and jobs move your issues as they change stage.',
      ],
    },
    {
      title: 'What agents can do',
      points: [
        'Read only: jobs lists a project’s jobs and their stages, job reads one job’s files, reviews and review read the reviews and their records.',
        'An agent cannot start, approve, merge or send back a job, and cannot start, steer or send a review.',
      ],
    },
    {
      title: 'Rules',
      points: [
        'Every job ends with you unless you turn on Let the judge merge approved jobs by itself for the project. It is off by default.',
        'A change that conflicts with main is never merged: the job is handed back to you.',
        'The builder works in its own worktree and branch beside your project, never in your checkout. Jobs are kept under the project’s .kehikot/factory folder.',
        'Every setting is yours alone: an agent asking to change one is refused.',
      ],
    },
  ],
}

export const ID = 'kehikot.factory'
/** The `work.status` route: a job's stage by its issue (doors.ts answers it). */
export const JOBS_ROUTE = '/api/jobs'
/** The module's version: package.json's, the one place it is written. A release is tagged with it. */
export const VERSION: string = pkg.version

/**
 * Where this module would like to answer. Said once, here, and read by `vite.config.ts`,
 * `register.ts` and `skills.ts`. 8040: the next free place on the ten-apart grid above the official
 * list (Editor holds 8030).
 */
export const PREFERRED_PORT = 8040

/**
 * What this app says about itself.
 *
 * ## A software factory on a kehikko
 *
 * A person types `/factory <feature>` in a Claude Code conversation. The skill it offers
 * (`declares.skills`, served by this module) asks this module for one step at a time: a spec
 * writer, a planner who chooses the review angles THIS change needs, a builder in its own git
 * worktree, a reviewer per angle, a counter-arguer for every review that asks for changes, and a
 * judge who rules each point required, optional or rejected. Only required points go back to the
 * builder, at most twice; the judge's last ruling decides between a merge and the person.
 *
 * ## What it will not do
 *
 * - Merge without the person, unless they turned on "Let the judge merge approved jobs by itself"
 *   for the project. Off by default.
 * - Merge a conflicting change: it aborts, leaves main as it was, and hands the job to the person.
 * - Let an agent approve, merge or start a job: its MCP door only reads, its header's approve is a
 *   confirmed run that agents cannot press, and a job starts only from `/factory` typed by a person.
 * - Write in the project's tree: jobs live under `.kehikot/factory/`, code in a worktree beside the
 *   project.
 *
 * ## The project's own board
 *
 * The person maps Factory's stages onto their board's columns (a GitHub Project's Status, a GitLab
 * board's lists), choosing from what the host read (`tracker.columns`, hence `trackers:read`). As a
 * job's stage changes, the conversation running `/factory` moves its issue with the person's CLI.
 *
 * ## `/review-factory`
 *
 * The second skill. A person types it on a pull or merge request; the conversation conducts a panel
 * (a planner choosing two angles, two reviewers, one adversary over every point, a judge, a diagram
 * drawer only when asked) while this module gathers, validates every point mechanically, and drafts
 * the result into the provider of `review.drafts` and the checklist answers into the provider of
 * `checklist.holder` — found by service (`services:read`, rev/neighbours.ts), never by id. It shows
 * each run on a Reviews board (a View switch). It posts nothing itself, except a two-way change with
 * no UI/UX when the person turned "Post two-way reviews by myself" on, through the drafts provider's
 * `send`, which takes it only from a module server that proves who it is.
 *
 * `view:navigate`: "Open the change" on a review waiting for the person asks the host to show the
 * change's ref (`view.goto`), so the module keeping the draft, beside it, opens it.
 *
 * ## `services`: `work.status` (protocol 2.83.0)
 *
 * Factory provides the stage of its jobs by issue: `GET /api/jobs?ref=&projectPath=` answers `{ jobs }`
 * (doors.ts), so a module showing an issue can say "Factory: <stage>" without naming Factory.
 *
 * ## `reacts: ['parts']`
 *
 * A job started from a conversation placed on parts of an epic belongs to those parts, and the
 * board narrows to the parts picked.
 *
 * ## `declares.settings`
 *
 * The judge-merge switch, the review switches and the door rules, in the host's Settings and behind
 * a gear on the container (protocol 2.15.0), read and written here at `/api/kehikot/settings`, in
 * the same `.kehikot/factory/settings.json`. Every one is the person's: an agent is refused.
 *
 * ## Two scopes: the open epic, or the whole project
 *
 * Two modes (protocol 2.29.0): `epic` by default, and `project`, which the person picks per
 * container in the host's settings window — or gets on "All epics". At `project`
 * (`context.scope: 'project'`) the Jobs and Reviews boards show the whole project — every epic's
 * items and those started on no epic — each card labelled with its epic, or "no epic". The header's
 * View switches only between the boards: its old "All jobs" was this same choice, and is gone so
 * there is one setting, not two. `declares.scopes` says the same to a host before 2.29.0.
 */
export const DECLARED: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  protocol: PROTOCOL,
  id: ID,
  name: 'Factory',
  /* The icon a host draws beside the name: a key of the protocol's module icons, never a path
     or URL; the same key Kehikot's official list gives it. */
  icon: 'lucide:factory',
  version: VERSION,
  dataVersion: 1,
  summary: 'A software factory on your kehikko: builds judged by a panel of agents, and /review-factory for accurate, transparent reviews of pull and merge requests.',
  tags: ['agents', 'review', 'code'],
  guidance:
    'Factory runs features through a pipeline of agents (spec, plan, build, review, counter-argument, judge) when the person '
    + 'types /factory in a Claude Code conversation. Its MCP door only reads: `jobs` lists a project\'s jobs and their stages, '
    + '`job` reads one job\'s files (spec, plan, reviews, counter-arguments, judgements, decision). You cannot start, approve, '
    + 'merge or send back a job: those are the person\'s, typed or pressed. Never merge a factory/<job> branch yourself. '
    + 'It also runs /review-factory, a review panel for pull and merge requests (planner, two reviewers, an adversary, a judge) that drafts '
    + 'into the person\'s draft review: `reviews` lists a project\'s reviews, `review` reads one and its record ("How this review was made"). You cannot start, '
    + 'steer or send a review.',
  /* "How to use" (protocol 2.52.0), and the introduction (protocol 2.57.0). */
  help: HELP,
  intro,
  entry: '/app',
  /* What its content belongs to (protocol 2.29.0): one mode per scope, the default first. */
  modes: [
    { id: 'board', label: 'Factory', scope: 'epic', scopeSays: 'the open epic’s jobs and reviews' },
    { id: 'all', label: 'All epics', scope: 'project', scopeSays: 'every epic’s jobs and reviews in this project, each card labelled with its epic' },
  ],
  mcp: {
    url: '/mcp',
    transport: 'http',
    about: 'The jobs of the software factory in a project, and each job\'s files; the /review-factory reviews and their records. Read-only.',
  },
  extensions: { emits: [], consumes: [] },
  reacts: ['parts'],
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    /* `epics:read`, `steps:read` and `parts:read` (protocol 2.21.0): a review weighs a change
       against its epic's vision, which this server asks the host for (`rev/vision.ts`) rather than
       reading the host's files or another module's.
       `state:keep` (2.51.0): the board shown and the job or review open on it, kept per container.
       `services:read` (2.81.0): who provides the draft review, the checklists, the epic's document and
       diagrams that /review-factory writes into (`services.find`, rev/neighbours.ts). */
    uses: ['activity:report', 'trackers:read', 'view:navigate', 'epics:read', 'steps:read', 'parts:read', 'state:keep', 'services:read'],
    storage: true,
    prompt: false,
    /* "All epics" (protocol 2.9.0), for a host before the `project` mode above (2.29.0). */
    scopes: ['epic', 'project'],
    /* The person's switches and rules, shown and changed in the host's Settings too (protocol 2.15.0). See `settings.ts`. */
    settings: SETTINGS,
  },
  health: '/healthz',
  /* The stage of its jobs, by issue, for any module that shows an issue (protocol 2.83.0). The route is doors.ts'. */
  services: { [WORK_STATUS]: { name: 'Factory', jobs: JOBS_ROUTE } },
})
