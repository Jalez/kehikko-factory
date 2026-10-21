import { KNOWN_ANGLES, MAX_ANGLES, type Angle, type Point } from './angles.ts'

/**
 * The prompts of the review machinery — a planner who chooses the angles a change needs, a reviewer
 * per angle, a counter-arguer per review that asks for changes, and a judge who rules on every
 * point — written once, in this module's own words. Each takes a `Subject`: where the change and
 * its files are, said by the caller. Nothing here knows of Factory's jobs, git or storage, so
 * another module can reuse it. The lines `parse.ts` reads back are spelled out in each prompt.
 */

export interface Subject {
  /** Where to read what the change is meant to do: a file, or a sentence. */
  spec: string
  /** Where to read the notes of whoever made the change, if anywhere. */
  notes?: string
  /** How to see the change itself: a command or a place. */
  change: string
  /** The round this is, and the last one in which required points go back rather than to a person. */
  round: number
  lastRound: number
  /** Where each role writes. */
  files: {
    plan: string
    review: (angle: string) => string
    counter: (angle: string) => string
    judgement: string
    /** The judgement of the round before, from round 2 on. */
    previousJudgement?: string
  }
  /** The caller's rule about what may be written: "write only the file this prompt names…". */
  only: string
  /** The caller's word on looking at a running app, if any. */
  screen?: string
  /** What happens after the judge, in a sentence: "You do not merge; …". */
  after: string
}

const lines = (...parts: (string | false | null | undefined | string[])[]) => parts.flatMap((part) => (part === false || part == null ? [] : Array.isArray(part) ? part : [part])).join('\n')

export function anglesPrompt(subject: Subject, asked: readonly string[] | null, readOnly: string): string {
  const known = Object.entries(KNOWN_ANGLES).map(([id, brief]) => `- ${id}: ${brief}`)
  return lines(
    'You are the planner of a review. Read what the change is meant to do, then choose who will review it: the angles from which '
      + 'it can go wrong, given what THIS change touches. Not every angle matters for every change — a copy fix needs no '
      + 'data-migration reviewer, and a schema change needs one badly.',
    '',
    `What it is meant to do: ${subject.spec}. ${readOnly}`,
    '',
    asked
      ? `The person chose the angles themselves: ${asked.join(', ')}. Use exactly these, in this order, and write a brief for each that says what to look at in this change.`
      : `Choose between 2 and 4 angles (at most ${MAX_ANGLES}). Some angles that often matter, to choose from or to go beyond:`,
    asked ? [] : ['', ...known],
    '',
    `Write ${subject.files.plan}:`,
    '',
    '- `## Angles`, and under it one line per angle, exactly in this shape: `- <angle-id>: <the brief>`. The id is lowercase words '
      + 'joined by dashes (`security`, `api-compat`); the brief is one or two sentences naming what in THIS change to look at.',
    '- `## Why these`: a sentence per angle on why it matters here, and a sentence on what you left out.',
    '- `## Build notes`: anything whoever makes the change should know first — the order to work in, the risky part, the tests to run.',
    '',
    subject.only,
  )
}

export function reviewerPrompt(subject: Subject, angle: Angle): string {
  return lines(
    `You are a reviewer, and you look at a change from ONE angle: ${angle.id}.`,
    '',
    `Your brief: ${angle.brief}`,
    '',
    `Read what it is meant to do (${subject.spec})${subject.notes ? `, the notes of whoever made it (${subject.notes})` : ''}, and the change itself: `
      + `${subject.change}, and whatever around it you need. Do not change anything you review.`,
    subject.round > 1 && subject.files.previousJudgement
      ? ['', `This is round ${subject.round}. The judge's ruling on the round before is ${subject.files.previousJudgement}: check that what it required from your angle is done.`]
      : [],
    '',
    'Stay on your angle; others cover the rest. Ask for a change only for something that is wrong or missing from your angle, not '
      + 'for taste: say where (file and line), what goes wrong, and what would fix it.',
    subject.screen ? ['', subject.screen] : [],
    '',
    `Write ${subject.files.review(angle.id)}:`,
    '',
    '- A line exactly `Verdict: APPROVE` (nothing to change from your angle) or `Verdict: CHANGES`.',
    '- `## Points`: a numbered list, one point per change you ask for, each with where, what goes wrong and the fix. Empty for APPROVE.',
    '- `## Checked`: what you looked at and found sound, in a few lines.',
    '',
    subject.only,
  )
}

export function counterPrompt(subject: Subject, angle: Angle): string {
  return lines(
    `You are the counter-arguer for the ${angle.id} review. The reviewer asked for changes. Your job is to make the strongest honest `
      + 'case AGAINST each change asked: that it is not needed, that it would make things worse, or that the choice made was right. '
      + 'A judge reads both sides and decides; it needs the best case on each side, not agreement.',
    '',
    `Read the review (${subject.files.review(angle.id)}), what the change is meant to do (${subject.spec})`
      + `${subject.notes ? `, the notes of whoever made it (${subject.notes})` : ''} and the change (${subject.change}). Change nothing.`,
    '',
    'For each point of the review, argue from the code and the spec, not from manners. Where there is no honest case, say `Conceded` and '
      + 'why in a line: a counter-argument that defends a real bug helps nobody.',
    '',
    `Write ${subject.files.counter(angle.id)}: \`## Points\`, the review's numbers, each with your case or \`Conceded\`.`,
    '',
    subject.only,
  )
}

export function judgePrompt(subject: Subject, angles: readonly Angle[], contested: readonly string[]): string {
  const last = subject.round >= subject.lastRound
  return lines(
    'You are the judge of a review. Reviewers looked at a change from several angles; where one asked for changes, a counter-arguer '
      + 'made the case against. You rule on every point, and you have the last word on the change.',
    '',
    `Read what it is meant to do (${subject.spec})${subject.notes ? `, the notes of whoever made it (${subject.notes})` : ''}, the change (${subject.change}) and, for round ${subject.round}:`,
    angles.map((one) => `- ${subject.files.review(one.id)}${contested.includes(one.id) ? ` and its counter-argument ${subject.files.counter(one.id)}` : ''}`),
    '',
    'Rule on each point a reviewer asked for:',
    '- required: the change does not do what it is meant to, or has a real defect — a bug, a hole, lost data, a broken caller. It goes back.',
    '- optional: worth doing, not worth another round. It does not go back.',
    '- rejected: the counter-argument holds, or the point is taste.',
    'Weigh the counter-argument; do not split the difference. Require only what you would block the change for.',
    '',
    `This is round ${subject.round}.${last ? ' It is the last round: anything you require now goes to the person, not back.' : ` The change can be sent back until round ${subject.lastRound}.`}`,
    '',
    `Write ${subject.files.judgement}:`,
    '',
    '- `## Rulings`: one line per point, exactly in this shape: `- <required|optional|rejected> | <angle> | <the point, and your reason in a sentence>`. '
      + 'Use the angle id the point came from (or `general` for one of your own).',
    '- `## Ruling`: one word on its own line. `changes` when anything is required. Otherwise `merge` when the change is ready, or '
      + '`hand-over` when it is ready but carries something a person should weigh before it lands (an irreversible migration, a '
      + 'changed public interface, a question left open) — and say what, in a sentence below the word.',
    '',
    `${subject.after} ${subject.only}`,
  )
}

/** The required points, numbered, as whoever makes the change reads them. */
export function requiredList(required: readonly Point[]): string[] {
  return required.map((one, i) => `${i + 1}. (${one.angle}) ${one.point}`)
}

/* ------------------------------------------------------------------ *
 * The review panel: a planner, two reviewers, one adversary over every point, a judge, and a
 * diagram agent only when the judge asks for one. Same angles, same plain-language rules, a
 * structured answer each (`points.ts`).
 * ------------------------------------------------------------------ */

export interface PanelSubject {
  /** The change in a few words: "gh:owner/repo#12 — Make it shout (https://…)". */
  change: string
  /** The module's input packet: description, commits, linked issues, vision, checklists, budget. */
  packet: string
  /** The whole change's diff, as a file (the lines every point is anchored in). */
  diff: string
  /** On a re-review: the diff since the last review. */
  delta?: string
  /** A checkout of the change at the pinned head, its own worktree, to read files beyond the diff. */
  checkout: string
  head: string
  files: {
    plan: string
    review: (angle: string) => string
    points: string
    challenge: string
    judgement: string
    diagrams: string
    briefing: string
  }
  budget: { pointsPerReviewer: number; filesBeyondDiff: number }
  /** The sentence that lets reviewers run the project's own tests, or null: read only. */
  runTests: string | null
  /** 1 for a first review; 2 and 3 are re-reviews. */
  round: number
  /** On a re-review: the points listed last time ("To get this approved"). */
  listed: readonly { id: string; text: string }[]
  /** The caller's rule about what may be written. */
  only: string
}

export const PLAIN =
  'Write for a busy person who is juggling many things: short sentences, plain words, no jargon they have to look up, '
  + 'nothing said twice. A point says what is wrong, why it matters, and what to do — nothing else.'

const readOnly = (subject: PanelSubject) =>
  subject.runTests
    ? `You read the change; you change nothing. ${subject.runTests}`
    : 'You read the change; you change nothing, and you run nothing: no tests, no builds, no scripts.'

const json = (shape: string) => ['End your file with ONE fenced block, ```json … ```, exactly in this shape (the module reads it; the rest of the file is for the person):', '', '```json', shape, '```']

export function panelPlannerPrompt(
  subject: PanelSubject,
  input: { doorRule: string | null; items: readonly { checklist: string; item: string; text: string }[]; asked: readonly string[] | null },
): string {
  const known = Object.entries(KNOWN_ANGLES).map(([id, brief]) => `- ${id}: ${brief}`)
  return lines(
    `You plan the review of a change: ${subject.change}.`,
    '',
    `Read the packet (${subject.packet}) — the description, the commits, the epic it belongs to and its checklists — and the diff (${subject.diff}). `
      + `The change is checked out at ${subject.head} in ${subject.checkout}, if you need a file beyond the diff. ${readOnly(subject)}`,
    '',
    input.asked
      ? `1. The person chose the two angles: ${input.asked.join(', ')}. Write a brief for each.`
      : '1. Choose TWO angles from which THIS change can go wrong (some that often matter are below; you may go beyond them).',
    input.asked ? [] : known,
    '   For each, a one-paragraph brief naming the best practices that apply to THIS change, each with a source (a link, or a file of the project).',
    input.items.length
      ? [`2. Split these checklist items between the two angles, each item to exactly one (the angle best placed to check it):`, ...input.items.map((one) => `   - ${one.checklist}/${one.item}: ${one.text}`)]
      : [
          `2. The change has no checklist. Propose one: at most 15 items, each ONE fact a reviewer can check by reading the change (not "code is good"). `
            + 'The person accepts or edits it before the review goes on.',
        ],
    '3. Say whether the change is ONE-WAY (hard or impossible to undo: a database migration, deleting data, a public API or file format, auth and permissions, '
      + 'deploy and infrastructure, a dependency or licence, anything shipped to users that cannot be recalled) or TWO-WAY (cheap to undo), with your reasons. '
      + 'When in doubt it is one-way.',
    input.doorRule ? `   The project's own rule already decides: ${input.doorRule} Apply it; say so in your reasons.` : [],
    '4. Say whether it touches what people see (UI/UX), and which screens.',
    '',
    `Write ${subject.files.plan}: a few lines for the person on why these angles, then`,
    ...json(
      '{ "angles": [ { "id": "correctness", "brief": "…", "practices": [ { "name": "…", "source": "https://… or path" } ], "items": [ "<checklist>/<item>" ] }, { …the second… } ],\n'
        + '  "door": { "kind": "one-way" | "two-way", "reasons": [ "…" ] },\n'
        + '  "uiux": { "touches": true | false, "reason": "…", "screens": [ "…" ] }'
        + (input.items.length ? ' }' : ',\n  "proposedChecklist": [ "one checkable fact", "…" ] }'),
    ),
    '',
    PLAIN,
    subject.only,
  )
}

export function panelReviewerPrompt(
  subject: PanelSubject,
  angle: { id: string; brief: string; practices: readonly { name: string; source: string }[] },
  items: readonly { checklist: string; item: string; text: string }[],
): string {
  const again = subject.round > 1
  return lines(
    `You review a change from ONE angle: ${angle.id}. The change: ${subject.change}.`,
    '',
    `Your brief: ${angle.brief}`,
    angle.practices.length ? ['Practices that apply here:', ...angle.practices.map((one) => `- ${one.name} (${one.source})`)] : [],
    '',
    `Read the packet (${subject.packet}) — what the change is for, and the epic it should fit — and the diff (${subject.diff}). `
      + `The change is checked out at ${subject.head} in ${subject.checkout}; read at most ${subject.budget.filesBeyondDiff} files beyond the diff. ${readOnly(subject)}`,
    again && subject.delta
      ? [
          '',
          `This is re-review round ${subject.round}. Judge ONLY what changed since the last review (${subject.delta}) and whether these listed points are now met:`,
          ...subject.listed.map((one) => `- ${one.id}: ${one.text}`),
          'A listed point that is still not met is a point again, with `"listed": "<its id>"`. A NEW point must be about lines in the new diff. Do not move the goalposts.',
        ]
      : [],
    '',
    `Stay on your angle; the other reviewer covers the rest. Raise a point only for something wrong or missing, never for taste. At most ${subject.budget.pointsPerReviewer} points, the most important first.`,
    'Every point:',
    '- is ANCHORED to the lines that show the problem: the path as the diff prints it, the side ("new" for added or unchanged lines, "old" for removed ones), '
      + 'the line number (and startLine for a range, inside one hunk), from the diff file above. Copy those lines exactly into "quote".',
    '- is PROVEN: at least one source in "evidence" — a line (path:line), a test or a reproduction, the project\'s own doc or code, or a named practice with a link. '
      + 'A claim about code elsewhere needs a source from there, not just these lines.',
    '- is SHORT: claim (at most two sentences), why it matters, and what to do — together under 600 characters.',
    '- has a severity: "blocking" (a bug, lost data, a hole, a broken caller), "risk" (likely to go wrong), "nice" (would be better).',
    items.length
      ? ['', 'Answer each of these checklist items, to the letter: pass, fail or n/a, with a note on how you know (the line, the test, the file). Skip none:', ...items.map((one) => `- ${one.checklist}/${one.item}: ${one.text}`)]
      : [],
    '',
    'Only if the change should be closed rather than fixed (it duplicates another, or goes against where the epic is going), say so in "close" with why and what to do instead.',
    '',
    `Write ${subject.files.review(angle.id)}: what you checked and found sound, in a few lines, then`,
    ...json(
      '{ "verdict": "APPROVE" | "CHANGES",\n'
        + '  "points": [ { "path": "src/a.ts", "side": "new", "line": 42, "startLine": 40, "quote": "…the lines…", "claim": "…", "why": "…", "suggestion": "…",\n'
        + '                "severity": "blocking" | "risk" | "nice", "evidence": [ { "kind": "line" | "test" | "doc" | "practice", "ref": "…", "quote": "…" } ], "checklist": [ "<checklist>/<item>" ] } ],\n'
        + '  "answers": [ { "checklist": "…", "item": "…", "state": "pass" | "fail" | "n/a", "note": "how I know" } ] }',
    ),
    '',
    PLAIN,
    subject.only,
  )
}

export function adversaryPrompt(subject: PanelSubject, input: { closeAsked: boolean }): string {
  return lines(
    `You are the adversary of a review of ${subject.change}. Two reviewers made the points in ${subject.files.points}, each with an id.`,
    '',
    `Read them, the packet (${subject.packet}), the diff (${subject.diff}) and, where you need it, the checkout at ${subject.head} in ${subject.checkout}. ${readOnly(subject)}`,
    '',
    'For EACH point, either concede it in a line, or make the strongest HONEST case against it, with evidence: the lines do not show it, the claim is wrong, '
      + 'it is not worth what it costs, or it goes against the direction of the epic. A case that defends a real bug helps nobody: concede those.',
    'One round only. You do not rule; a judge reads both sides.',
    input.closeAsked ? 'A reviewer asked to close the change. Say whether you agree, in "close".' : [],
    '',
    `Write ${subject.files.challenge}, then`,
    ...json('{ "challenges": [ { "point": "p1", "concede": true | false, "case": "…", "evidence": [ { "kind": "line" | "test" | "doc" | "practice", "ref": "…" } ] } ]' + (input.closeAsked ? ', "close": true | false }' : ' }')),
    '',
    PLAIN,
    subject.only,
  )
}

export function panelJudgePrompt(subject: PanelSubject, input: { vision: boolean; oneWay: boolean; challenged: boolean; closeAsked: boolean }): string {
  return lines(
    `You are the judge of a review of ${subject.change}. Your ruling is final.`,
    '',
    `Read the packet (${subject.packet})${input.vision ? ', with the epic this change belongs to' : ' (this change is in no epic, so there is no vision to weigh it against; say so)'}, `
      + `the points (${subject.files.points})${input.challenged ? `, the adversary's case against them (${subject.files.challenge})` : ''}, the checklist answers in the reviews, and the diff (${subject.diff}). ${readOnly(subject)}`,
    '',
    'The priority is a bug-free but STEADY release of real improvements that fit the existing vision. Not perfection, and not every nice-to-have.',
    'Rule each point by its id:',
    '- required: it blocks a bug-free release (a bug, lost data, a hole, a broken caller, a failed checklist item that matters).',
    '- optional: worth doing, not worth blocking. At most THREE; prefer the ones that serve the epic.',
    '- rejected: the adversary\'s case holds, the lines do not show it, or it is taste. Each ruling with a one-line reason.',
    subject.round > 1 ? `This is re-review round ${subject.round}: require only listed points still not met, and new problems in new code. Never a new demand on code that did not change.` : [],
    '',
    'Then: the vision fit in ONE sentence; the verdict — "approve" when nothing is required (say so plainly), "comment" for optional points only, '
      + '"request-changes" when anything is required; and a summary that fits on one screen. Do not list the required points in the summary: the module adds "To get this approved:" from your rulings.',
    input.closeAsked
      ? '"close" only if you agree with the reviewer(s) who asked to close it AND the adversary agreed; say why and what to do instead in "close". It stands only when everyone agrees.'
      : 'Do not ask to close the change: no reviewer did.',
    'If a point about structure or interaction would be clearer drawn, request a diagram in one line: the point, "sequence" (call order) or "graph" (what depends on what), what it is now and what is proposed. At most one or two; none is usual.',
    input.oneWay
      ? [
          '',
          `This change is ONE-WAY: hard to undo. Also write ${subject.files.briefing}, a decision briefing for the person, who must understand it before anything is posted: `
            + 'every important decision the change makes, the alternatives and why this one; the risks and what cannot be undone; and what they should check in the '
            + 'functionality themselves. Not every line. Plain markdown, at most two screens.',
        ]
      : [],
    '',
    `Write ${subject.files.judgement}, then`,
    ...json(
      '{ "rulings": [ { "point": "p1", "ruling": "required" | "optional" | "rejected", "reason": "…" } ],\n'
        + '  "verdict": "approve" | "comment" | "request-changes"' + (input.closeAsked ? ' | "close"' : '') + ', "visionFit": "…", "summary": "…",\n'
        + (input.closeAsked ? '  "close": { "why": "…", "instead": "…" },\n' : '')
        + '  "diagrams": [ { "point": "p1", "kind": "sequence" | "graph", "now": "…", "proposed": "…" } ] }',
    ),
    '',
    PLAIN,
    subject.only,
  )
}

export function diagramPrompt(
  subject: PanelSubject,
  input: { project: string; epic: string; requests: readonly { point: string; kind: 'sequence' | 'graph'; now: string; proposed: string }[]; runId: string },
): string {
  return lines(
    `You draw what the judge of a review of ${subject.change} asked for, with the Flows module's \`write_flow\` tool (project ${input.project}, epic ${input.epic}).`,
    '',
    `Read the points (${subject.files.points}), the judgement (${subject.files.judgement}) and the code you need in ${subject.checkout}. ${readOnly(subject)}`,
    '',
    'For each request, write TWO flows of the same kind: "now" and "proposed", with ids `review-<point>-now` and `review-<point>-proposed` (prefix them with '
      + `\`${input.runId}-\`), kind "sequence" for call order or "graph" for what depends on what, a few stages each that walk a person through it.`,
    ...input.requests.map((one) => `- ${one.point} (${one.kind}): now — ${one.now}; proposed — ${one.proposed}`),
    'If the Flows tools are not connected in this conversation, do not install anything: write that in the file below and stop.',
    '',
    `Write ${subject.files.diagrams}: one line per flow you wrote, exactly \`- <point>: <flow id>\`, or why you could not.`,
    '',
    subject.only,
  )
}
