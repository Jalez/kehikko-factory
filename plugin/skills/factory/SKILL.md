---
name: factory
description: Run Kehikot's software factory on this project. A spec, review angles chosen for the change, a build in its own git worktree, reviewers, counter-arguments and a judge. Only a person runs it, by typing /factory.
argument-hint: "<feature> [--angles a,b] [--issue ref] | next | approve <job> | rework <job> <note> | issue <job> new | status"
disable-model-invocation: true
allowed-tools: Bash(curl:*), Bash(echo:*), Bash(gh project item-add:*), Bash(gh project item-edit:*), Bash(glab issue update:*)
---

The person typed `/factory $ARGUMENTS`. Kehikot's Factory module at {{origin}} was asked, with this conversation's id and folder. Its answer, then curl's own report in brackets:

!`curl -s -m 60 --retry 4 --retry-connrefused --retry-delay 1 --retry-max-time 12 -w '\n[curl exit %{exitcode}: %{errormsg}; HTTP %{http_code}]\n' -X POST -G --data-urlencode "session=${CLAUDE_SESSION_ID}" --data-urlencode "say=$ARGUMENTS" --data-urlencode "cwd=$PWD" {{origin}}/api/skill/say || echo "[no answer from {{origin}}]"`

You are the conductor of this factory. The module keeps every job's state and hands you one step at a time; you start the subagents it names and report back. You never write a job's files or its state yourself.

How to run it:

1. If the answer above begins with "Factory:" and the report says HTTP 200, follow the answer:
   - If it ends with "Stop.", tell the person what it says, in a few lines, and stop.
   - If it has a STEP, do exactly what the STEP says: start the subagents it lists with the Agent tool (subagent_type "general-purpose", run_in_background false: the report needs their work done), each with the prompt between its markers, word for word. When it lists several, start them all in ONE message so they run at the same time. Wait until all have finished; never report a step while one of its subagents is still running.
   - If it has a MOVE section, run those commands first, as it says: they move the job's issue on the project's own board.
   - If it has a NOTE for the person, keep it and tell them when the run stops.
   - Then run its REPORT command with the Bash tool, exactly as written (or the failure command, when a subagent could not do its job). The answer is the next STEP, or ends with "Stop.". Go on like this until an answer says "Stop.".
   - Between steps, tell the person in one line what is happening ("Review, round 1: 3 reviewers started."). Nothing more: they can follow the job in the Factory board.
2. If the answer does not begin with "Factory:", the module is restarting, is not running, is older than this skill, or moved to another port. Run this one command with the Bash tool, once, exactly as written: it asks the address the module registered. If its answer begins with "Factory:" and says HTTP 200, go on as in 1.

   ```sh
   curl -s -m 60 -w '\n[curl exit %{exitcode}: %{errormsg}; HTTP %{http_code}; %{url_effective}]\n' -X POST -G --data-urlencode "session=${CLAUDE_SESSION_ID}" --data-urlencode "say=$ARGUMENTS" --data-urlencode "cwd=$PWD" "$(sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(http:\/\/127\.0\.0\.1:[0-9]*\)".*/\1/p' "$HOME/Library/Application Support/Kehikot/modules/kehikot.factory.json")/api/skill/say"
   ```

3. If that did not give an answer either, tell the person ONE line and stop: "Kehikot: couldn't reach the Factory module at {{origin}} (curl exit N, HTTP CODE). Is Factory running in Kehikot? Try /factory again in a moment; if it keeps failing, update Factory from Kehikot's Updates menu. [skill {{version}}]" — with curl's numbers from the first report.

Rules that hold throughout:

- Only the person starts, approves, merges or sends back a job, by typing /factory. Never run a /factory command, an approve or a merge on your own, and never call the module with other words than the commands it gave you.
- Run gh and glab only as the module's answers write them: to move an issue on the board, or to open the issue the person asked for.
- Never merge, push, or switch branches in the project yourself. The module merges, and only when the person (or the switch they turned on in the board) says so.
- If a subagent asks you a question, answer from the spec and the plan; if they do not say, tell it to assume and write the assumption down.
