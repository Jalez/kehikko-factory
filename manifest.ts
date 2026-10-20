import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'kehikot-module-protocol'

export const ID = 'kehikot.factory'
export const VERSION = '0.1.0'

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
 * ## `reacts: ['parts']`
 *
 * A job started from a conversation placed on parts of an epic belongs to those parts, and the
 * board narrows to the parts picked.
 */
export const DECLARED: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  protocol: PROTOCOL,
  id: ID,
  name: 'Factory',
  version: VERSION,
  dataVersion: 1,
  summary: 'A software factory on your kehikko: spec, chosen review angles, a build in its own worktree, counter-arguments and a judge.',
  tags: ['agents', 'review', 'code'],
  guidance:
    'Factory runs features through a pipeline of agents (spec, plan, build, review, counter-argument, judge) when the person '
    + 'types /factory in a Claude Code conversation. Its MCP door only reads: `jobs` lists a project\'s jobs and their stages, '
    + '`job` reads one job\'s files (spec, plan, reviews, counter-arguments, judgements, decision). You cannot start, approve, '
    + 'merge or send back a job: those are the person\'s, typed or pressed. Never merge a factory/<job> branch yourself.',
  entry: '/app',
  modes: [{ id: 'board', label: 'Factory', scope: 'epic' }],
  mcp: {
    url: '/mcp',
    transport: 'http',
    about: 'The jobs of the software factory in a project, and each job\'s files. Read-only.',
  },
  extensions: { emits: [], consumes: [] },
  reacts: ['parts'],
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['activity:report', 'trackers:read'],
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})
