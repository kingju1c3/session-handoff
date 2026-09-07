---
name: session-handoff
description: "Hands a long-running mission to a fresh session BEFORE auto-compaction destroys it, and enforces that with harness hooks rather than good intentions. For Claude Code surfaces that aren't a local CLI terminal: the web (claude.ai/code), the Desktop app, and any Claude Code Remote-bridged environment — spawning via native create_session/get_session tool calls instead of macOS osascript. ARM IT ONCE, THEN IT SITS DORMANT: after `lease.sh init` the registered hooks watch every turn, inject an advisory at the derived soft trigger, BLOCK auto-compaction while a handoff is unfinished, and BLOCK stopping mid-handoff — costing nothing until a chain is actually armed. Successor sessions are named by lineage: 1.1 hands off to 2.1, a parallel fork at that depth is 2.2. USE WHEN: a run has a mission that must outlive this conversation (an armed /loop, a multi-session build, an explicit ask to keep going) — evaluate this at the start of every turn during such a run and self-activate at the soft trigger without waiting to be asked. MANDATORY TRIGGERS: 'session handoff', 'run the session-handoff', 'use /session-handoff', 'hand off to a new session', 'fork before compaction'. STRONG TRIGGERS: 'keep this going after you fill up', 'hand off when you run out of context', 'continue this in a fresh session', 'don't let this die when your context fills'. Not for an ordinary conversation that merely got long — that is what compaction is for. On a real local CLI terminal use terminal-handoff instead. The rule that pays for everything: a handoff is an ownership transfer, not a polite goodbye."
hooks:
  PreCompact:
    - hooks:
        - type: command
          command: "node ./scripts/hooks.mjs"
          timeout: 15
  Stop:
    - hooks:
        - type: command
          command: "node ./scripts/hooks.mjs"
          timeout: 15
  PostToolUse:
    - hooks:
        - type: command
          command: "node ./scripts/hooks.mjs"
          timeout: 10
---

# Session Handoff

> **Adapter of the Handoff Protocol** (`README.md` / `docs/HANDOFF_PROTOCOL.md`) for Claude Code
> Remote surfaces. The protocol's universal layer — trigger policy, lease, continuation document,
> durability review, transfer ordering, standards — applies unchanged. This file supplies the four
> platform-specific extension points: **DETECT** = transcript usage + `get_session`, **SPAWN** =
> `create_session`, **ATTEST** = `get_session` on the successor, **ENFORCE** = Claude Code hooks.

The failure this exists to prevent: the context window fills, auto-compaction replaces the
conversation with a summary, then a summary of that summary, and the agent quietly starts executing
its impression of the plan instead of the plan. The fix: finish what's in flight, write down
everything the next session needs, prove that document is durable, start a genuinely fresh session,
hand it the mission — including the mission prompt word for word — and stop owning the work.

`terminal-handoff` does this on a local macOS CLI by having `osascript` open a new `Terminal.app`
window. The web, the Desktop app, and bridged environments have no terminal to automate. This skill
does the same job with what those surfaces actually have: `mcp__Claude_Code_Remote__*` tools, which
create and inspect real sessions directly. Every spawn/check/attest step is **the model making a
tool call** — a shell script cannot call an MCP tool, so none of that is delegated to a script.

---

## What makes this more than an instruction

Everything above is something a model is *told* to do, and a model under load can miss it. So the
enforcement is not left to the model. The skill registers **hooks**, which the harness runs:

| Hook | When it runs | What it does |
| --- | --- | --- |
| `PreCompact` | The harness is about to compact | **Blocks auto-compaction** (exit 2) while a handoff is armed and unfinished, with instructions to finish it now. Bounded: 2 attempts, then it lets compaction through and instead tells the summariser exactly what must survive verbatim. Never blocks a human's `/compact`. |
| `Stop` | The model tries to end its turn | **Blocks stopping** (exit 2) when the lease says a handoff is mid-flight but not `TRANSFERRED`, or when past the hard deadline with nothing started. Bounded at 2. |
| `PostToolUse` | After every tool call | Injects the advisory at `SOFT` / `HARD` / `CEILING`. Debounced to once a minute per phase; escalations always get through. |
| `SessionStart` | A session begins or resumes | Re-injects chain state — the one rule, the lease, the mission path — into a context that just lost it. *(settings.json install only; a skill's own hooks register when it is invoked, which is after this fires.)* |

`PreCompact` is the one that matters most, and it is why this works **regardless of what percentage
any given platform compacts at**: it fires when compaction is genuinely about to happen. No
threshold has to be guessed correctly for the guarantee to hold. The percentages below are early
warning; this hook is the backstop.

**Dormancy.** With no `.handoff/LEASE.json`, every hook exits silently and immediately — one small
`node` process that reads one missing path. Install it globally and forget it; it does nothing at
all until a chain is armed with `lease.sh init`.

**Every block is bounded and fails open.** A hook that blocks forever wedges the session it was
meant to protect — a full context that can never compact can't do anything else either. Budgets are
per generation, so a long chain isn't punished for an earlier link's attempts.

---

## Install

**Project (this repo):** the skill lives in `.claude/skills/session-handoff/`. Its hooks register
when the skill is invoked and stay active for the rest of that session.

**Global, every project:** copy the directory to `~/.claude/skills/session-handoff/`. Project-level
installs win on conflict; there is no inheritance mechanism, so keep them in sync by hand.

**Always-on, from the first turn (recommended for unattended runs):** put the hooks in
`~/.claude/settings.json` instead, with an absolute path. This is the only way to get
`SessionStart`, which fires before any skill is invoked:

```json
{
  "hooks": {
    "SessionStart":  [{ "hooks": [{ "type": "command", "command": "node ~/.claude/skills/session-handoff/scripts/hooks.mjs", "timeout": 15 }] }],
    "PreCompact":    [{ "hooks": [{ "type": "command", "command": "node ~/.claude/skills/session-handoff/scripts/hooks.mjs", "timeout": 15 }] }],
    "Stop":          [{ "hooks": [{ "type": "command", "command": "node ~/.claude/skills/session-handoff/scripts/hooks.mjs", "timeout": 15 }] }],
    "PostToolUse":   [{ "hooks": [{ "type": "command", "command": "node ~/.claude/skills/session-handoff/scripts/hooks.mjs", "timeout": 10 }] }]
  }
}
```

Requires `node` and `python3` on `PATH`. Verify the whole mechanism with `sh scripts/selftest.sh`
(46 assertions, no network, no spawning, nothing touched outside a temp dir).

Knobs, all optional: `HANDOFF_DIR` (default `.handoff`), `HANDOFF_COMPACTION_PCT`,
`HANDOFF_WINDOW_TOKENS`, `HANDOFF_MAX_PRECOMPACT_BLOCKS` (2), `HANDOFF_MAX_STOP_BLOCKS` (2),
`HANDOFF_ADVISORY_DEBOUNCE_MS` (60000).

---

## Session names

Every session in a chain carries a label `<generation>.<fork>`:

- **generation** is depth — how many handoffs deep. The root is `1.1`; its successor is `2.1`, then
  `3.1`.
- **fork** is width — a second, parallel successor spawned at the same depth is `2.2`, then `2.3`.

So a chain that hands off twice and forks once reads `1.1 → 2.1 → 2.2 (parallel sibling) → 3.1`.
Depth is capped by `cap` (default 5), width by `forkCap` (default 2) — forks multiply *live*
sessions, and therefore cost, in a way sequential generations do not. Use the label in the
successor's `title` (`"<mission-short> — 2.1"`) and in its `tags`, so `list_sessions` shows the
lineage. `lease.sh label <dir>` prints the current one; `lease.sh journal <dir>` shows the whole
history.

---

## The one rule

**Before doing any mission work, read the lease. If you are not the owner, stop.**

Ownership lives in `.handoff/LEASE.json` — the same directory `terminal-handoff` uses, so a chain
can cross surfaces (a CLI session handing off to a web one). A session that has handed off is
*superseded*, not paused or standing by, and must say so and stop rather than keep editing the same
repository as its successor.

---

## When it triggers

**The whole point is to hand off BEFORE compaction.** Thresholds are therefore *derived* from when
compaction will actually happen — never chosen in the abstract:

```
soft trigger  = compaction point − 15 points
hard deadline = compaction point −  5 points
```

The compaction point is resolved in this order, by `scripts/watchdog.mjs`:

1. `HANDOFF_COMPACTION_PCT` — explicit config; the universal knob for any platform.
2. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` — the platform stating it directly. Verified live 2026-09-07:
   this environment reported **80**.
3. **70%**, assumed — under Claude Code's own default auto-compact, under Copilot CLI's ~95%, at
   the top of Gemini CLI's configurable compression range. Conservative on purpose.

| Phase | At | What it means |
| --- | --- | --- |
| `SOFT` | compaction − 15 | Start nothing new. Begin converging (step 3). |
| `HARD` | compaction − 5 | The successor must be spawned *and attested* by here. |
| `CEILING` | compaction | You are already late. Hand off immediately, skip the review. |

The 10 points between soft and hard are the runway the whole handoff has to finish in. The 5
between hard and ceiling are margin for the attestation wait and for one thing going wrong.

**Why not `terminal-handoff`'s 85%:** the first version of this skill copied that number. It sits
*above* the 80% this environment actually compacts at — a hard deadline past the compaction point
isn't a deadline, it's a guarantee of failure. Never inherit a threshold without checking it
against the real one.

Also triggers on: the user arming it (`/loop <mission> use /session-handoff`), or asking for a
handoff directly at any percentage.

**Not** for a conversation that merely got long — that is what compaction is for. This is for a run
with a mission that must survive it.

---

## The Method

### 1. Arm (once)

```bash
scripts/lease.sh init <repo>/.handoff <your-session-id> 0 5 2
```

Your session id is the `id` field `get_session` returns for you (`session_...`), **not** the local
`CLAUDE_CODE_SESSION_ID` transcript id — different identifiers on this surface. Pass `0` for
`<pid>`: there is no local process to record, and liveness here is a server fact, not a PID.

Store in `.handoff/mission.txt`: the `/loop …` directive **verbatim**, the model and effort (from
`session_context`), the repo and branch, the governing plan/tracker paths, and — if `/loop` was
armed with an interval — the trigger id, because you will need it to stop the loop later.

Tell the user the chain is armed, at which label, and that the hooks are now live.

### 2. Watch

The hooks do this for you. To check by hand at a natural beat:

```bash
node scripts/watchdog.mjs --dir .handoff --session <transcript-session-id> --human
```

`get_session` (self) and its `external_metadata.context_usage` is the more direct reading and the
one to quote to the user; the watchdog is what the hooks can reach, since a hook cannot call an MCP
tool.

### 3. Wind down — converge, never abandon

At `SOFT`: start nothing new, drain in-flight work against a deadline (`TaskStop` anything that
overruns it, and record what it had and hadn't finished), reach a natural checkpoint — tests green,
a commit made, or the dirty state described precisely. At `HARD`: stop converging and checkpoint in
place.

`scripts/lease.sh state <dir> <sid> WINDING_DOWN`

### 4. Write the continuation document

`HANDOFF-TEMPLATE.md`, three non-negotiables: the mission prompt is byte-for-byte verbatim,
`FIRST ACTIONS` and `RESUME PROMPT` are present, every claim is confidence-graded (✅/⚠️/❓).
Write it to `.handoff/CONTINUATION.md` so the `SessionStart` hook can point at it.

Then `state … DOC_WRITTEN`.

### 5. Submit it for durability review

No `codex` binary exists on these surfaces — don't look for one. Dispatch a fresh subagent with the
`Agent` tool: same seven criteria (mission preserved verbatim, actionable, verifiable, complete
against the transcript, landmines recorded, authority correctly disclaimed, confidence honestly
graded), same "be concrete and hostile to hand-waving, no praise-padding", same single-line
`VERDICT: DURABLE` / `VERDICT: NOT DURABLE` contract on the final line. The subagent can't read your
conversation, so summarise the session's actual course for it — otherwise it grades the document in
isolation and can't catch omissions.

Up to 3 rounds. At the cap without `DURABLE`, hand off anyway with the objections as a prominent
section. Past `HARD`, at most one round; at `CEILING`, none. No parseable verdict line is a failed
review, never an approval.

Then `state … REVIEWED`.

### 6. Spawn the successor

Claim the label first — this is what enforces the caps:

```bash
scripts/lease.sh next-gen  <dir> <sid>    # 2.1 — the main line. exit 3 = depth cap
scripts/lease.sh next-fork <dir> <sid>    # 2.2 — a parallel sibling. exit 3 = fork cap
```

**Exit 3 means stop.** Write the document, report, wait for the user. Do not spawn.

Mark `state … SPAWN_REQUESTED` **before** calling `create_session` — `spawn-failed` only refunds
from that state.

Then call `mcp__Claude_Code_Remote__create_session` directly:

- `prompt` — the `RESUME PROMPT` block, as text, not a path: the successor starts from nothing and
  cannot read your filesystem before its first turn. It must end by demanding the exact attestation
  line (step 7).
- `source_url` / `source_revision` — same repo, current branch.
- `environment_id` — **ask, unless the user already said.** `list_environments`, then offer: the
  same environment (another cloud session), or a `"bridge"`-kind entry, which routes the successor
  onto a real machine — the closest equivalent to terminal-handoff's new local window. A bridge
  only works if Remote Control is actually running there right now; this skill does not verify that
  first (see Honest Limits).
- `title` — `"<mission-short> — <label>"`.
- `tags` — the chain id and the label, so the lineage is greppable later.

terminal-handoff's control-file/nonce dance exists to solve one problem: a spawned OS process's
argv is world-readable via `ps`. A tool call has no argv, isn't `ps`-visible, and is authenticated
as your account by construction. Pass the mission text directly.

**If `create_session` fails or the session never comes up**, run `scripts/lease.sh spawn-failed
<dir> <sid>` before retrying — it rewinds the lineage so a failed attempt doesn't burn the cap.

### 7. Attest, stop your loop, then transfer

A successful `create_session` is not proof the successor is alive and in the right place. Attest in
two layers, both read from `get_session` on the **new** id — never from anything the successor tells
you directly:

1. **Placement (server facts).** `session_status` running/connected, and
   `external_metadata.current_branches` showing the expected branch — that field reflects what is
   actually on disk; `session_context.sources` only echoes what you asked for. Live-verified: a
   successor reached this ~35 seconds after `create_session`.
2. **Execution (platform-relayed reply).** The resume prompt demanded one exact line —
   `ATTEST OK: branch=<branch>, chain=<chainId>, label=<label>`. Once the successor's first turn
   completes, `get_session` returns `post_turn_summary.recent_action` carrying that reply verbatim,
   with `status_category: completed`. Match it, label and chain id included. Mid-turn only the live
   `task_summary` exists, so this needs a bounded wait, not one immediate poll.

Layer 1 proves the platform put a session where you asked. Layer 2 proves the prompt was delivered
and acted on — and because the *platform* relays the reply, a successor that skipped or garbled the
attestation shows up as a mismatch, not as silence you might read as success.

No good attestation within a reasonable wait → `state … BLOCKED`, keep the lease, and tell the user
exactly what `create_session` returned and what `get_session` showed. A failed handoff must be loud.
(`BLOCKED` also releases the `Stop` hook, so this is the honest exit, not a trap.)

**Stop your own loop — both kinds — BEFORE transferring**: `ScheduleWakeup({stop:true})` for a
dynamic loop, `CronDelete` with the recorded trigger id for a fixed-interval Routine (`stop:true`
does not cancel a cron), `TaskStop` for any armed `Monitor`. A tick firing between transfer and
loop-stop would have this session act after it stopped owning the work.

Only then:

```bash
scripts/lease.sh transfer <dir> <sid> <successor-session-id> 0
```

### 8. Report

```
Handed off to <successor-session-id> — chain <chainId>, session 2.1, environment <env>.
Continuation document: .handoff/CONTINUATION.md
Review: DURABLE (round 2 of 3, subagent)
Attested: session_status running, branch matches, ATTEST OK line returned.
This session no longer owns the work and will not continue it.
```

---

## The Standards

- One owner at a time, enforced by a file on disk — never by intention.
- The mission prompt survives byte-for-byte, or the handoff has failed.
- Thresholds are derived from the real compaction point, never hardcoded.
- Every block is bounded and fails open. Nothing waits forever; nothing wedges the session.
- A human's explicit `/compact` is a decision, not an accident — never blocked.
- Attestation is a fact the platform reports about the successor, not the successor's own word.
- `create_session`'s environment is the user's choice, stated or asked — never silently defaulted.
- A failed handoff is loud: `BLOCKED`, plus what actually happened.
- `git add -A` is never run. Commits name explicit paths.
- `.loop/HANDOFF.md` belongs to Claude-Loop and is never touched.
- Every state transition is journaled, so a crash is recoverable rather than mysterious.

---

## Honest Limits

- **Correction to earlier versions of this file.** They said "no hook exists on this surface to make
  the trigger firmer." That was wrong. Claude Code has a full hook system, `PreCompact` can block
  compaction, `Stop` can block stopping, and skills can register hooks from their own frontmatter.
  The enforcement layer above is the result. If you read that claim in a fork of this skill, it is
  stale.
- **The hooks are verified two ways, and one gap remains.** `scripts/selftest.sh` drives all four
  events through `hooks.mjs` with synthetic input and asserts every block, budget, debounce and
  silence path (46/46 passing). What is *not* independently verified here is that Claude Code
  registers hooks from **skill frontmatter** exactly as documented — that comes from the official
  hooks reference, not from an observed firing in this session. The `settings.json` install path in
  **Install** is the belt-and-braces version if you want certainty.
- **`create_session` was live-tested 2026-09-07 and works.** A throwaway successor spawned with the
  same repo, branch and environment reached `SESSION_STATUS_RUNNING`/`connected` in ~35s;
  `get_session` showed `current_branches` matching (a server fact) and `parent_session_id` stamped
  to the spawner. Archived immediately after attestation to contain cost. Three things it surfaced:
  - The successor's `context_usage.used_tokens` read `0` while it was visibly mid-turn — that metric
    updates at turn boundaries, so a mid-turn reading understates. Check at natural beats.
  - You can't read a successor's transcript, but you **can** read its final reply, via
    `post_turn_summary.recent_action`. That is what makes layer 2 of the attestation possible.
  - `ListAgents` did not list the running cloud successor, so `SendMessage` to it is not a given.
    Attest with `get_session`, not by messaging.
- **Desktop-app availability of `mcp__Claude_Code_Remote__*` is inferred, not verified.** Confirmed
  on Claude Code for the web. The inference for Desktop/Cowork rests on `create_session`'s own
  documented `environment_id` behaviour, which shows Cowork sessions being *provisioned* by this
  call — not that a Cowork-hosted session can turn around and call it again. If those tools are
  missing there, this skill has no local-OS fallback the way terminal-handoff does.
- **A `"bridge"` environment routes to a real machine only if something is listening right now.**
  Not checked before `create_session`; expect a failure or an unreachable session rather than a
  clean error naming the cause.
- **This costs real money, unlike terminal-handoff.** A new OS window is free; a new Claude Code
  Remote session is not. An unattended `/loop` that hands off repeatedly is a standing cost, and
  forks multiply it — that is what `cap` and `forkCap` are for. Say so when arming it.
- **Subagent review is weaker than an independent process.** terminal-handoff's Codex reviewer is a
  genuinely separate tool with its own context; an `Agent` subagent shares billing and more context
  lineage. Better than self-grading near the limit; not equivalent.
- **The model still has to do the actual handoff.** Hooks can block compaction and refuse a stop —
  they cannot write the continuation document or call `create_session`, because a hook is a shell
  command and MCP tools are the model's to call. The hooks buy time and make ignoring the deadline
  hard; they do not perform the work.
