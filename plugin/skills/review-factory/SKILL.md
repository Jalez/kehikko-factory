---
name: review-factory
description: Review a pull or merge request with Kehikot's Factory panel. Two angles chosen for the change, two reviewers, one adversary, a judge, the checklist followed to the letter, and a draft in Review that you send yourself. Only a person runs it, by typing /review-factory.
argument-hint: "[<pull or merge request>] | status | resume <review> | angles <review> a,b | checklist <review> accept|edit <items> | budget <review> points=N files=N tokens=N | stop <review>"
disable-model-invocation: true
allowed-tools: Bash(curl:*), Bash(echo:*)
---

The person typed `/review-factory $ARGUMENTS`. Kehikot's Factory module at {{origin}} was asked, with this conversation's id and folder. Its answer, then curl's own report in brackets:

!`curl -s -m 120 --retry 4 --retry-connrefused --retry-delay 1 --retry-max-time 12 -w '\n[curl exit %{exitcode}: %{errormsg}; HTTP %{http_code}]\n' -X POST -G --data-urlencode "session=${CLAUDE_SESSION_ID}" --data-urlencode "say=$ARGUMENTS" --data-urlencode "cwd=$PWD" {{origin}}/api/review/say || echo "[no answer from {{origin}}]"`

You are the conductor of this review. The module keeps the review's state, checks every point itself, and writes the draft into Review; it hands you one step at a time. You start the subagents it names and report back. You never write the review's files, its state, a comment or a checklist tick yourself, and nothing is posted to the forge by you.

How to run it:

1. If the answer above begins with "Factory:" and the report says HTTP 200, follow the answer:
   - If it ends with "Stop.", tell the person what it says, in a few lines, and stop.
   - If it has a STEP, do exactly what the STEP says: start the subagents it lists with the Agent tool (subagent_type "general-purpose", run_in_background false: the report needs their work done), each with the prompt between its markers, word for word. When it lists several, start them all in ONE message so they run at the same time. Wait until all have finished; never report a step while one of its subagents is still running.
   - Then run its REPORT command with the Bash tool, exactly as written (or the failure command, when a subagent could not do its job). The answer is the next STEP, or ends with "Stop.". Go on like this until an answer says "Stop.".
   - Between steps, tell the person in one line what is happening ("Reviewing: 2 reviewers started."). Nothing more: they can follow the review on Factory's Reviews board.
2. If the answer does not begin with "Factory:", the module is restarting, is not running, is older than this skill, or moved to another port. Run this one command with the Bash tool, once, exactly as written: it asks the address the module registered. If its answer begins with "Factory:" and says HTTP 200, go on as in 1.

   ```sh
   curl -s -m 120 -w '\n[curl exit %{exitcode}: %{errormsg}; HTTP %{http_code}; %{url_effective}]\n' -X POST -G --data-urlencode "session=${CLAUDE_SESSION_ID}" --data-urlencode "say=$ARGUMENTS" --data-urlencode "cwd=$PWD" "$(sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(http:\/\/127\.0\.0\.1:[0-9]*\)".*/\1/p' "$HOME/Library/Application Support/Kehikot/modules/kehikot.factory.json")/api/review/say"
   ```

3. If that did not give an answer either, tell the person ONE line and stop: "Kehikot: couldn't reach the Factory module at {{origin}} (curl exit N, HTTP CODE). Is Factory running in Kehikot? Try /review-factory again in a moment; if it keeps failing, update Factory from Kehikot's Updates menu. [skill {{version}}]" — with curl's numbers from the first report.

Rules that hold throughout:

- Only the person starts a review, accepts a checklist, changes the angles or the budget, and sends a review, by typing /review-factory or pressing in Kehikot. Never run a /review-factory command on your own, and never call the module with other words than the commands it gave you.
- Never post, approve, comment on, merge or close the change with gh, glab or anything else. The draft is in Review; the person sends it.
- Never switch branches or change files in the project. The module checks the change out in a worktree of its own.
- If a subagent asks you a question, answer from the packet and the plan; if they do not say, tell it to say so in its file and go on.
