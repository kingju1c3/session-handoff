---
name: session-handoff
description: "Keeps a long autonomous run alive past the context window by handing the mission to a fresh session BEFORE auto-compaction destroys it — and enforces that with harness hooks instead of good intentions. At the soft trigger the session stops expanding, converges what's in flight, writes a continuation document, has an outside reviewer rule on whether that document is actually durable, spawns a genuinely fresh session carrying the mission prompt verbatim, proves it is alive from a source it cannot fake, then transfers ownership so only one session ever owns the work. ARM IT ONCE, THEN IT SITS DORMANT: with no armed chain the hooks exit silently and cost nothing; once armed they warn at the derived soft trigger, BLOCK auto-compaction while a handoff is unfinished, and BLOCK stopping mid-handoff. Thresholds are derived from the platform's real compaction point, never hardcoded, because platforms compact anywhere from 60% to 95%. Successors are named by lineage: 1.1 hands off to 2.1; a parallel fork at that depth is 2.2. For agent surfaces that spawn sessions through tool calls rather than a shell — Claude Code on the web (claude.ai/code), the Desktop app, and Claude Code Remote-bridged environments. USE WHEN: a run has a mission that must outlive this conversation (an armed /loop, a multi-session build, an explicit ask to keep going) — evaluate this at the start of every turn during such a run and self-activate at the soft trigger without waiting to be asked. MANDATORY TRIGGERS: 'session handoff', 'run the session-handoff', 'use /session-handoff', 'hand off to a new session', 'fork before compaction'. STRONG TRIGGERS: 'keep this going after you fill up', 'hand off when you run out of context', 'continue this in a fresh session', 'don't let this die when your context fills'. Not for an ordinary conversation that merely got long — that is what compaction is for. The rule that pays for everything: a handoff is an ownership transfer, not a polite goodbye."
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

A long run does not fail loudly. It fades. The context window fills, auto-compaction replaces the
conversation with a summary, then a summary of that summary — and somewhere in there the agent stops
executing the plan and starts executing its impression of the plan. Nothing errors. The tests still
pass. Nobody notices until the work is subtly wrong.

The fix is not a better summary. It is a clean break: finish what is in flight, write down
everything the next session needs, prove that document is good enough to work from, start a
genuinely fresh session, and give it the work — including the mission prompt, word for word. The
old session does not "wind down and stay available." It stops owning the work.

That distinction is the whole skill. Two live sessions sharing one working tree is the failure this
exists to prevent, and it is exactly what happens when a handoff is a suggestion instead of a
transfer.

---

## The one rule

**Before doing any mission work, read the lease. If you are not the owner, stop.**

Ownership lives in `.handoff/LEASE.json`, not in anyone's good intentions. A session that has handed
off is not paused, not idle, not standing by — it is *superseded*, and it must say so and stop
rather than keep editing the same repository as its successor.

---

## What makes this more than an instruction

Everything above is something a model is *told* to do, and a model under load can miss it —
especially at the exact moment it matters most, when its context is nearly full. So the deadline is
not left to the model's judgment. This skill registers **hooks**, which the harness runs:

| Hook | When | What it does |
| --- | --- | --- |
| `PreCompact` | The harness is about to compact | **Refuses auto-compaction** (exit 2) while a handoff is armed and unfinished, naming the exact next step. Bounded at 2 attempts, then it lets compaction through and instead tells the summariser precisely what must survive verbatim. Never blocks a human's `/compact`. |
| `Stop` | The model tries to end its turn | **Refuses to let the turn end** when the lease says a handoff is mid-flight but not `TRANSFERRED`, or when past the hard deadline with nothing started. Bounded at 2. |
| `PostToolUse` | After every tool call | Injects the advisory at `SOFT` / `HARD` / `CEILING`. Debounced to once a minute per phase; escalations always get through. |
| `SessionStart` | A session begins or resumes | Re-injects chain state — the one rule, the lease, the mission path — into a context that just lost it. *(`settings.json` install only: a skill's own hooks register when the skill is invoked, which is after this fires.)* |

`PreCompact` is the one that matters, because it fires when compaction is *genuinely about to
happen*. No threshold has to be guessed correctly for the guarantee to hold. Everything in **When it
triggers** is early warning; this hook is the backstop.

**Dormancy.** With no `.handoff/LEASE.json`, every hook exits silently and immediately — one small
`node` process that reads one missing path. Install it globally and forget it. It does nothing at
all until a chain is armed.

**Every block is bounded and fails open.** A hook that blocks forever wedges the session it was
meant to protect: a full context that can never compact cannot do anything else either. Budgets are
per generation, so a long chain is not punished for an earlier link's attempts.

---

## Install

Clone straight into your skills directory — the repository *is* the skill:

```bash
git clone https://github.com/kingju1c3/session-handoff ~/.claude/skills/session-handoff
sh ~/.claude/skills/session-handoff/scripts/selftest.sh     # 46 assertions, no network
```

Per-project instead: clone into `.claude/skills/session-handoff/`. Project installs win on conflict.

**For unattended runs, also register the hooks in `~/.claude/settings.json`** with an absolute path.
This is the only way to get `SessionStart`, and it means the hooks are live from the first turn
rather than from first invocation:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node ~/.claude/skills/session-handoff/scripts/hooks.mjs", "timeout": 15 }] }],
    "PreCompact":   [{ "hooks": [{ "type": "command", "command": "node ~/.claude/skills/session-handoff/scripts/hooks.mjs", "timeout": 15 }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "node ~/.claude/skills/session-handoff/scripts/hooks.mjs", "timeout": 15 }] }],
    "PostToolUse":  [{ "hooks": [{ "type": "command", "command": "node ~/.claude/skills/session-handoff/scripts/hooks.mjs", "timeout": 10 }] }]
  }
}
```

Requires `node` and `python3` on `PATH`, and the `mcp__Claude_Code_Remote__*` tools for spawning
(see Honest Limits for where those exist).

Optional knobs: `HANDOFF_DIR` (default `.handoff`), `HANDOFF_COMPACTION_PCT`,
`HANDOFF_WINDOW_TOKENS`, `HANDOFF_MAX_PRECOMPACT_BLOCKS` (2), `HANDOFF_MAX_STOP_BLOCKS` (2),
`HANDOFF_ADVISORY_DEBOUNCE_MS` (60000).

---

## Session names

Every session in a chain carries a label `<generation>.<fork>`:

- **generation** is depth — how many handoffs deep. The root is `1.1`, its successor `2.1`, then
  `3.1`.
- **fork** is width — a second, parallel successor at the same depth is `2.2`, then `2.3`.

A chain that hands off twice and forks once reads `1.1 → 2.1 → 2.2 → 3.1`. Put the label in the
successor's `title` and `tags` so the lineage is legible from a session list without opening
anything. `scripts/lease.sh label <dir>` prints the current one.

Depth is capped by `cap` (default 5); width by `forkCap` (default 2). The two axes cost differently:
generations run one after another, forks run *at the same time*.

---

## When it triggers

**The entire purpose is to hand off BEFORE compaction.** Thresholds are therefore derived from when
compaction will actually happen — never chosen in the abstract:

```
soft trigger  = compaction point − 15 points
hard deadline = compaction point −  5 points
```

`scripts/watchdog.mjs` resolves the compaction point in this order:

1. `HANDOFF_COMPACTION_PCT` — explicit configuration.
2. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` — the platform stating it directly. Verified live 2026-09-07:
   this environment reported **80**.
3. **70%, assumed** — a compromise, not a measurement. Conservative on purpose.

| Phase | At | What it means |
| --- | --- | --- |
| `SOFT` | compaction − 15 | Start nothing new. Begin converging (step 3). |
| `HARD` | compaction − 5 | The successor must be spawned *and attested* by here. |
| `CEILING` | compaction | You are already late. Hand off immediately, skip the review. |

The 10 points between soft and hard are the runway the whole handoff has to finish in. The 5 between
hard and ceiling absorb the attestation wait and one thing going wrong.

**Configuration is also how you buy margin, not just how you fill a gap.** Compaction is the only
concrete, verifiable fidelity cliff a platform exposes, so the policy derives from it — but
long-context degradation starts well before it, with no crisp number to act on. If your platform
compacts at 95% and you don't want a mission being driven at 80% of a million-token window, set
`HANDOFF_COMPACTION_PCT` *lower than the truth* and the whole policy moves down with it.

**Why derived and not written down:** an earlier version of this skill carried a hardcoded 85% hard
deadline. Reading the real compaction point on a live session showed it compacting at **80%** — the
"deadline" was past the cliff. A deadline above the compaction point is not a deadline. Never
inherit a threshold; derive it.

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

It prints a chain id and creates session `1.1`.

Your session id is the `id` field `get_session` returns for you (`session_...`) — **not** the local
`CLAUDE_CODE_SESSION_ID` transcript id. Those are different identifiers here: the latter names a
transcript file on disk, the former is what `create_session` / `get_session` operate on. Pass `0`
for `<pid>`; there is no local process to record, and liveness here is a server fact, not a PID.

Store in `.handoff/mission.txt`: the `/loop …` directive **verbatim**, the model and effort (from
`get_session`'s `session_context`), the repo and branch, the governing plan/tracker paths, and — if
`/loop` was armed with an interval — **the trigger/cron id**, because you will need it to stop the
loop later.

Tell the user the chain is armed, at which label, that the hooks are live, and that each generation
spawns a real session that costs real money.

### 2. Check context at natural beats

After a loop tick, after a subagent batch returns, after a checkpoint:

```bash
node scripts/watchdog.mjs --dir .handoff --session <transcript-session-id> --human
```

`get_session` (self) → `external_metadata.context_usage` is the more direct reading and the one to
quote to the user. The watchdog is what the *hooks* can reach, since a hook is a shell command and
cannot call an MCP tool. Both can be wrong (see Honest Limits); if either fails or looks implausible,
say so rather than handing off on a number you don't trust.

### 3. Wind down — converge, never abandon

At `SOFT`:

- **Start nothing new.** No new workstream, no new subagent batch, no tangent.
- **Drain what is in flight, with a deadline.** Let running children finish and return results. If a
  child overruns, `TaskStop` it and record in the document what it had completed and what it had
  not. Waiting is never unbounded — waiting itself burns the context you are trying to save.
- **Reach a natural checkpoint:** tests green, files saved, and either a commit made or the dirty
  state described precisely.

At `HARD`, stop converging and checkpoint in place: name the half-finished work, the files mid-edit,
and the single next action.

`scripts/lease.sh state <dir> <sid> WINDING_DOWN`

### 4. Write the continuation document

Fill `HANDOFF-TEMPLATE.md` and write it to the repo root as
`AI_Continuation_Document-<DDMmmYYYY>-<HHMM>.md`. Banner any previous one as superseded, update
`.handoff/CHAIN.md`, and copy the current document to `.handoff/CONTINUATION.md` so the
`SessionStart` hook can point at it.

Three things are non-negotiable:

- **The mission prompt is verbatim.** Not summarised, not tidied. A paraphrase silently converts a
  continuing loop into a one-shot session that stops after one pass.
- **`FIRST ACTIONS` and `RESUME PROMPT` are present.** A document that describes state without
  naming the next concrete action has failed, however beautiful it is.
- **Confidence is graded per claim** — ✅ verified this session, ⚠️ carried forward, ❓ assumed — and
  the successor is told to verify every ❓ before relying on it.

Then `state … DOC_WRITTEN`, and **stop writing to the repo.** The document is now being judged
against a frozen world.

### 5. Submit it for durability review

Never grade your own handoff near the limit. A session at 70% context is the last thing that should
rule on whether its own summary is adequate.

First **freeze the world**: record `HEAD`, a hash of the dirty-file manifest, and the document's
SHA-256. You will re-check these after the review — if the world moved while the reviewer was
reading, refresh before trusting the verdict.

Then dispatch a fresh subagent with the `Agent` tool. Give it the document path, the repository
path, and — because it cannot read your live conversation — a concrete summary of what actually
happened this session, so it can judge *omissions* rather than grading the document in isolation.
That is the check that catches the real failures. Use this prompt:

```text
You are an adversarial reviewer judging whether a SESSION HANDOFF DOCUMENT is DURABLE — i.e.
whether a brand-new agent with zero memory could pick up this work using only that document plus
the repository, and continue correctly without asking a single clarifying question.

Read the document in full, then compare it against the session summary provided. You are
read-only; modify nothing.

Judge these seven criteria and state a finding for each:
1. MISSION PRESERVED — is the mission prompt reproduced verbatim, and could the successor re-arm
   it exactly? A paraphrase is a FAILURE: it silently turns a continuing loop into a one-shot
   session.
2. ACTIONABLE — is the next action concrete enough to execute immediately, with no clarification?
3. VERIFIABLE — is every factual claim checkable (commit SHA, file path, exact command)? Vague
   claims like 'tests pass' with no command are failures.
4. COMPLETE VS SESSION — does anything material that happened this session fail to appear in the
   document? This is the single most important check. Name specific omissions.
5. LANDMINES — are failed approaches and dead ends recorded, so the successor will not repeat them?
6. AUTHORITY — is the governing plan/tracker named, and does the document correctly disclaim its
   own authority rather than posing as the source of truth?
7. HONEST CONFIDENCE — is anything marked HIGH confidence that was not actually verified this
   session? Flag over-claiming specifically.

Be concrete and hostile to hand-waving. For each failure give a one-line fix. Rank by severity.
Do not pad with praise.

End your reply with EXACTLY one line:
VERDICT: DURABLE
or
VERDICT: NOT DURABLE
```

**Parse the verdict from the final non-blank line only.** Accepting an earlier matching line lets
quoted prose spoof an approval; accepting a later one lets trailing prose bury a real
`NOT DURABLE`. No parseable verdict is a **failed review, never an approval.**

Up to **3 rounds**. Revise and re-submit. You have final say — the reviewer advises, it does not
command — and you log what you changed and what you rejected, with reasons.

At the cap without `DURABLE`: **hand off anyway**, with the unresolved objections as a prominent
section and the successor's literal first task. A stalled overnight run delivers nothing; a flagged
document still moves the work and is honest about what is shaky.

Past `HARD`: **one** round only. At `CEILING`: none. Do not spend a second round burning context you
no longer have.

Then `state … REVIEWED`.

### 6. Spawn the successor

Claim the label first — this is the step that enforces the caps:

```bash
scripts/lease.sh next-gen  <dir> <sid>    # 2.1 — the main line.       exit 3 = depth cap
scripts/lease.sh next-fork <dir> <sid>    # 2.2 — a parallel sibling.  exit 3 = fork cap
```

**Exit 3 means stop.** Write the document, report, and wait for the user. Do not spawn.

Mark `state … SPAWN_REQUESTED` **before** calling `create_session` — `spawn-failed` only refunds
from that state, so marking it afterwards would make a failed call unrefundable.

Then call `mcp__Claude_Code_Remote__create_session` **directly, as a tool call**. There is no
launcher script here, because a script cannot call an MCP tool:

- `prompt` — the `RESUME PROMPT` block from the document, as literal text, not a path: the successor
  starts from nothing and cannot read your filesystem before its first turn. It must end by
  demanding the exact attestation line (step 7).
- `source_url` / `source_revision` — the same repo and current branch, so the successor lands in the
  same codebase state.
- `environment_id` — **ask the user, unless they already said in the mission.** Call
  `list_environments` and offer the choice explicitly: the same environment as your own (another
  cloud session, reachable from claude.ai/code or the Claude app), or a different one — e.g. a
  `"bridge"`-kind entry, which routes the successor onto a real machine. Never default this
  silently to "somewhere else."
- `title` — `"<mission-short> — <label>"`.
- `tags` — the chain id and the label.

Mission text passed to a tool call is not a command line: it is not in `argv`, not visible to `ps`,
and the call is authenticated as your account by construction. Pass it directly.

**If `create_session` fails, or the returned session never comes up**, run `scripts/lease.sh
spawn-failed <dir> <sid>` before retrying. It rewinds the lineage, so an attempt that never became a
session does not burn either cap.

### 7. Require attestation, stop your own loop, then transfer

A `create_session` call returning is not a successor. Attest in two layers, both read from
`get_session` on the **new** session's id — never from anything the successor sends you directly:

1. **Placement (server facts).** `session_status` running/connected, and
   `external_metadata.current_branches` showing the expected branch. That field reflects what is
   actually on disk; `session_context.sources` only echoes what you asked for. Live-verified: a
   successor reached this state ~35 seconds after `create_session`.
2. **Execution (platform-relayed reply).** The resume prompt demanded one exact line —
   `ATTEST OK: branch=<branch>, chain=<chainId>, label=<label>`. Once the successor's first turn
   completes, `get_session` returns `post_turn_summary.recent_action` carrying that reply verbatim,
   with `status_category: completed`. Match it, chain id and label included. Mid-turn only the live
   `task_summary` exists, so this needs a bounded wait, not one immediate poll.

Layer 1 proves the platform put a session where you asked. Layer 2 proves the prompt was delivered
and acted on — and because the *platform* relays the reply, a successor that skipped or garbled the
attestation shows up as a mismatch, not as silence you might read as success.

Re-check `HEAD` and the dirty manifest against what the reviewer saw. If the world moved during the
review, refresh the document before handing over.

No good attestation inside the deadline → `state … BLOCKED`, keep the lease, and tell the user
exactly what `create_session` returned and what `get_session` showed. A failed handoff must be loud,
never silent. (`BLOCKED` also releases the `Stop` hook, so this is an honest exit, not a trap.)

**Now stop your own loop — both kinds — BEFORE transferring, not after.**
`ScheduleWakeup({stop:true})` for a dynamic loop, **`CronDelete` with the recorded trigger id** for a
fixed-interval one (`stop:true` does *not* cancel a cron/Routine), `TaskStop` for any armed
`Monitor`. Do this first: a tick firing between transfer and loop-stop would have this session act
while it no longer owns the work.

Only then:

```bash
scripts/lease.sh transfer <dir> <sid> <successor-session-id> 0
```

### 8. Report

```
Handed off to <successor-session-id> — chain <chainId>, session 2.1, environment <env>.
Continuation document: AI_Continuation_Document-07Sep2026-1432.md
Review: DURABLE (round 2 of 3, subagent)
Attested: status running, branch matches, ATTEST OK line returned.
This session no longer owns the work and will not continue it.
```

---

## The Standards

- One owner at a time, enforced by a file on disk — never by intention.
- The mission prompt survives byte-for-byte, or the handoff has failed.
- Thresholds are derived from the real compaction point, never hardcoded.
- Every block is bounded and fails open. Nothing waits forever; nothing wedges the session.
- A human's explicit `/compact` is a decision, not an accident — never blocked.
- A session existing is not success; attestation is — and attestation is a fact the platform
  reports about the successor, not something the successor reports about itself.
- Sessions are addressed by session id. A stored name is never trusted; users rename sessions.
- The reviewer advises, it does not command — but no parseable verdict is a failure, not an approval.
- A failed handoff is loud: `BLOCKED`, plus exactly what happened.
- `create_session`'s environment is the user's choice, stated or asked — never silently defaulted.
- `git add -A` is never run. Commits name explicit paths.
- `.loop/HANDOFF.md` belongs to Claude-Loop and is never touched.
- Every state transition is journaled, so a crash is recoverable rather than mysterious.

---

## The Output

The user gets a new session, already working, holding the same mission at a fraction of the context
cost — plus a continuation document at the repo root that an outside reviewer has ruled durable, a
chain index showing which generation is live, and one plain-language line naming where the work now
lives. The old session stays open and inert: nothing is lost, and it will not quietly keep working.

Recover from a crash with `scripts/lease.sh get <dir>` and `scripts/lease.sh journal <dir>`. If a
predecessor died mid-handoff and left the chain stranded, `scripts/lease.sh recover <dir>
<session-id> 0` takes ownership — but **confirm the recorded owner is actually dead first**, via
`get_session` on its id. Unlike a local process there is no PID to test here, so the script cannot
check liveness itself and does not pretend to. `scripts/lease.sh release <dir> <sid>` gives up the
chain without losing the documents.

---

## Honest Limits

- **The hooks are verified two ways, and one gap remains.** `scripts/selftest.sh` drives all four
  events through `hooks.mjs` with synthetic input and asserts every block, budget, debounce, cap and
  silence path (46/46 passing). What is *not* independently verified is that Claude Code registers
  hooks from **skill frontmatter** exactly as documented — that comes from the official hooks
  reference, not from an observed firing. The `settings.json` install path is the belt-and-braces
  version if you want certainty.
- **`create_session` was live-tested 2026-09-07 and works.** A throwaway successor spawned with the
  same repo, branch and environment reached `SESSION_STATUS_RUNNING`/`connected` in ~35s;
  `get_session` showed `current_branches` matching (a server fact) and `parent_session_id` stamped
  to the spawner. It was archived immediately after attestation to contain cost. Three things it
  surfaced:
  - The successor's `context_usage.used_tokens` read `0` while it was visibly mid-turn — that metric
    updates at turn boundaries, so a mid-turn reading understates. Check at natural beats.
  - You cannot read a successor's transcript, but you **can** read its final reply, through
    `post_turn_summary.recent_action`. That is what makes layer 2 of the attestation possible.
  - `ListAgents` did not list the running cloud successor, so `SendMessage` to it is not a given.
    Attest with `get_session`, not by messaging.
- **This needs the `mcp__Claude_Code_Remote__*` tools to spawn anything.** They are confirmed
  available on Claude Code for the web. Availability inside the Desktop app is *inferred* — from
  `create_session`'s own documented `environment_id` behaviour, which shows Cowork sessions being
  *provisioned* by this call, not that a Cowork-hosted session can turn around and call it again.
  Where those tools are absent, everything up to and including the reviewed continuation document
  still works; only the automatic spawn does not, and the skill should say so plainly rather than
  pretend.
- **A `"bridge"` environment routes to a real machine only if something is listening right now.**
  Not checked before `create_session`; expect a failure or an unreachable session rather than a
  clean error naming the cause.
- **The context percentage is a good heuristic, not an authority.** The watchdog reads the last
  assistant turn's usage over a per-model window table; it can drift if a window changes or
  compaction resets the count. It refuses to *enforce* on an unknown model — it assumes the smallest
  plausible window, which triggers earlier, and drops to advisory only.
- **This costs real money.** Each generation is a real session. An unattended `/loop` that hands off
  repeatedly is a standing cost, and forks multiply it — that is what `cap` and `forkCap` are for.
  Say so when arming it.
- **Subagent review is weaker than a fully independent process.** It runs with its own context, which
  is the point, but it shares billing and dispatch lineage. Better than self-grading near the limit;
  not equivalent to an external reviewer.
- **An agent orchestrating its own replacement is structurally weaker than an external supervisor
  owning rotation.** If you can run a supervisor outside the session, do that instead. This exists
  for the case that cannot serve: keeping the session *you are talking to* alive.
- **The successor has full capability** — every tool, every write, subagents of its own. That is the
  point, and it is the risk. The only things constraining it are the document you wrote and the
  repository it lands in.
- **The model still has to do the actual handoff.** Hooks can refuse compaction and refuse a stop;
  they cannot write the continuation document or call `create_session`, because a hook is a shell
  command and MCP tools are the model's to call. The hooks buy time and make ignoring the deadline
  hard. They do not do the work.
