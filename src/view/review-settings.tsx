import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DoorRule, ReviewSettings } from '../../rev/shape.ts'
import type { Api } from '@/wire/api'

/**
 * What the person keeps for /review-factory in this project. Every switch is off until they turn it
 * on; nothing here is reachable from an agent's door.
 */
export function ReviewSettingsView({ settings, projectPath, api, onSaid }: { settings: ReviewSettings; projectPath: string; api: Api; onSaid(said: string): void }) {
  const [glob, setGlob] = useState('')
  const [door, setDoor] = useState<'one-way' | 'two-way'>('one-way')
  const [rule, setRule] = useState(settings.defaultRule)
  const save = (next: Partial<ReviewSettings>) => api.reviewAct(projectPath, { act: 'review-settings', settings: next }).then(onSaid, (e: unknown) => onSaid(e instanceof Error ? e.message : String(e)))
  const rules = settings.doorRules
  const said = (one: DoorRule) => (one.kind === 'path' ? `anything matching ${one.glob}` : `the label "${one.label}"`)
  const switches: { key: 'postTwoWay' | 'reReviewByItself' | 'runTests'; label: string; detail: string }[] = [
    { key: 'postTwoWay', label: 'Post two-way reviews by myself', detail: 'A two-way change that touches nothing people see is posted without you. One-way and UI/UX changes always wait for you.' },
    { key: 'reReviewByItself', label: 'Re-review by myself', detail: 'When an author signals they are ready, a re-review runs in a background Claude Code session. At most three rounds per change.' },
    { key: 'runTests', label: 'Reviewers may run this project\'s tests', detail: 'Only the test command your AGENTS.md or CLAUDE.md names, in the review\'s own checkout. Nothing else is run.' },
  ]
  return (
    <div className="flex flex-col gap-3 p-2 text-xs" data-testid="review-settings">
      {switches.map((one) => (
        <label key={one.key} className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={settings[one.key]} data-testid={`switch-${one.key}`} onChange={(event) => void save({ [one.key]: event.target.checked })} />
          <span>
            {one.label}
            <span className="block text-[var(--muted-foreground)]">{one.detail}</span>
          </span>
        </label>
      ))}
      <div className="flex flex-col gap-1">
        <span className="font-medium">One-way or two-way, by this project's rules</span>
        <span className="text-[var(--muted-foreground)]">Applied before the planner's own judgement. When anything says one-way, it is one-way.</span>
        {rules.length ? (
          <ul className="flex flex-col gap-1">
            {rules.map((one, i) => (
              <li key={i} className="flex items-center gap-1 rounded border px-1.5 py-1">
                <span className="min-w-0 flex-1">
                  {said(one)} is {one.door}
                </span>
                <button type="button" aria-label="remove the rule" className="px-1" onClick={() => void save({ doorRules: rules.filter((_, at) => at !== i) })}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            const text = glob.trim()
            if (!text) return
            setGlob('')
            const next: DoorRule = text.startsWith('label:') ? { kind: 'label', label: text.slice(6).trim(), door } : { kind: 'path', glob: text, door }
            void save({ doorRules: [...rules, next] })
          }}
        >
          <Input value={glob} onChange={(event) => setGlob(event.target.value)} placeholder="migrations/  or  label:two-way" className="h-6 text-xs" aria-label="a path or a label" />
          <select value={door} onChange={(event) => setDoor(event.target.value as 'one-way' | 'two-way')} className="h-6 rounded border bg-transparent px-1 text-xs" aria-label="which way">
            <option value="one-way">one-way</option>
            <option value="two-way">two-way</option>
          </select>
          <Button type="submit" size="sm" variant="outline" className="h-6 px-2 text-xs">
            Add
          </Button>
        </form>
      </div>
      <form
        className="flex flex-col gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          if (rule.trim()) void save({ defaultRule: rule.trim() })
        }}
      >
        <span className="font-medium">When to review again, by default</span>
        <span className="text-[var(--muted-foreground)]">The answer Factory recommends the first time it meets an author.</span>
        <div className="flex gap-1">
          <Input value={rule} onChange={(event) => setRule(event.target.value)} className="h-6 text-xs" aria-label="the default re-review rule" />
          <Button type="submit" size="sm" variant="outline" className="h-6 px-2 text-xs">
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}
