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
