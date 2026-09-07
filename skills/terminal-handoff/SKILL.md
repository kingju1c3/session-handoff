---
name: terminal-handoff
description: "Keep a long autonomous run alive past the context window by handing off BEFORE auto-compaction fires: at the soft trigger (65%, or lower if the real compaction point — read from $CLAUDE_AUTOCOMPACT_PCT_OVERRIDE — is lower) the session stops expanding, finishes what's in flight, writes a continuation document, has an unbiased outside reviewer rule on whether that document is actually durable, then opens a NEW Claude Code session in a new Terminal window, hands it the same mission verbatim, and transfers ownership so only one session ever owns the work — all done by the hard deadline (75%, derived the same way). Exists because the default is a slow death — auto-compaction summarizes a summary until the agent has quietly lost the plan, and a session near its limit is the last thing that should grade its own handoff. Local macOS CLI only (osascript/Terminal.app); for web/Desktop-app sessions use session-handoff. MANDATORY TRIGGERS: 'terminal handoff', 'run the terminal-handoff', 'use /terminal-handoff', 'hand off to a new terminal'. STRONG TRIGGERS (only for a long-running build the user wants continued across sessions — never for a normal conversation that merely got long): 'keep this going after you fill up', 'hand off when you run out of context', 'continue this in a fresh session', 'rotate to a new terminal before compaction', 'don't let this die when your context fills'. The rule that pays for everything: a handoff is an ownership transfer, not a polite goodbye."
---

# The Terminal Handoff

> **Adapter of the Handoff Protocol** (`docs/HANDOFF_PROTOCOL.md`) for a local Claude Code CLI
> on macOS. The protocol's universal layer applies unchanged; this file supplies the three
> platform-specific extension points — **DETECT** = `scripts/context-check.mjs`, **SPAWN** =
> `scripts/spawn-successor.sh` (osascript → Terminal.app), **ATTEST** = nonce + session id + cwd +
> HEAD messaged back by the successor. For Claude Code on the web / Desktop app / bridged
> environments, use the sibling `session-handoff` adapter instead.

A long run does not fail loudly. It fades. The context window fills, auto-compaction replaces the
conversation with a summary, then a summary of that summary — and somewhere in there the agent stops
executing the plan and starts executing its impression of the plan. Nobody notices until the work is
subtly wrong.

The fix is not a better summary. It is a clean break: finish what is in flight, write down everything
the next agent needs, prove that document is good enough to work from, then start a genuinely fresh
session and give it the work — including the mission prompt, word for word. The old session does not
"wind down and stay available." It stops owning the work. That distinction is the whole skill: two
live sessions sharing one working tree is the failure this exists to prevent, and it is exactly what
happens when a handoff is a suggestion instead of a transfer.

---

## The one rule

**Before doing any mission work, read the lease. If you are not the owner, stop.**

Ownership lives in `.handoff/LEASE.json`, not in anyone's good intentions. A session that has handed
off is not paused, not idle, not standing by — it is *superseded*, and it must say so and stop rather
than keep editing the same repository as its successor.

---

## When it triggers — and the number that actually matters

**This skill's entire purpose is to hand off BEFORE auto-compaction fires.** Every threshold
below is derived from when compaction will actually happen, not chosen in the abstract.

**Find the real compaction point first.** Claude Code exposes it as `$CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
(the percentage of the window at which this session auto-compacts; `scripts/context-check.mjs`
now reports it as `autocompactPct` when set). Verified live 2026-09-07 in a Claude Code Remote
session: **80**. When unset, the real point is unknown — use the conservative defaults below and
say so.

Then, on each tick, `scripts/context-check.mjs --json` and compare `percent` against:

| Threshold | Default | If the override is set | What it means |
| --- | --- | --- | --- |
| **Soft trigger** | 65% | `min(65, override − 15)` | Start nothing new. Begin converging. |
| **Hard deadline** | 75% | `min(75, override − 5)` | Successor must be spawned *and attested* by here. |
| **Absolute ceiling** | 80% | `override` itself | Compaction. Already late — hand off immediately, skip review. |

Always take the **lower** of the default and the override-derived value.

**Correction to this skill's original 70%/85%:** 85% is *above* the 80% compaction point observed
in practice. A hard deadline past the compaction point guarantees the failure this skill exists to
prevent. The original numbers assumed compaction near ~95%; that assumption is not safe to inherit —
read the env var.

Other triggers:
- The user armed it: `/loop <mission> use /terminal-handoff`.
- The user asks for a handoff directly, at any percentage.

**Not** for a conversation that merely got long — that is what auto-compaction is for. This is for a
run with a mission that must survive.

---

## The Method

### 1. Arm (once)

Record the mission and take the lease:

```
scripts/lease.sh init <repo>/.handoff <your-session-id> <your-pid> 5
```

It prints a chain id. Store, in `.handoff/mission.txt`: the `/loop …` directive **verbatim**, the
model, the effort (from `$CLAUDE_EFFORT` — settings will lie), the cwd, the governing plan/tracker
paths, and — if `/loop` was armed with an interval — **the cron job id**, because you will need it to
stop the loop later.

Tell the user the chain is armed and at which generation.

### 2. Check context at natural beats

After each loop tick, after a subagent batch returns, after a checkpoint:

```
node scripts/context-check.mjs --json
```

It prints `percent`. It **fails closed** — non-zero exit for an unknown model or an unknown session
id, because a handoff fired on a guessed number is worse than no handoff. If it exits non-zero, do
not hand off; tell the user why.

### 3. Wind down — converge, never abandon

At the soft trigger:

- **Start nothing new.** No new workstream, no new subagent batch, no tangent.
- **Drain what is in flight, with a deadline.** Let running children finish and return their results.
  If a child exceeds the deadline, `TaskStop` it and record in the document what it had completed and
  what it did not. Waiting is never unbounded — waiting itself burns the context you are trying to
  save.
- **Reach a natural checkpoint:** tests green, files saved, and either a commit made or the dirty
  state described precisely.
- At the hard deadline, stop converging and checkpoint in place: name the half-finished work, the
  files mid-edit, and the single next action.

Mark the lease: `scripts/lease.sh state <dir> <sid> WINDING_DOWN`.

### 4. Write the continuation document

Fill `HANDOFF-TEMPLATE.md` (in this skill's directory) and write it to the repo root as
`AI_Continuation_Document-<DDMmmYYYY>-<HHMM>.md`. Banner the previous one as superseded and update
`.handoff/CHAIN.md`.

Three things are non-negotiable:

- **The mission prompt is verbatim.** Not summarized, not tidied. A paraphrase silently converts a
  continuing loop into a one-shot session that stops after one pass.
- **`FIRST ACTIONS` and `RESUME PROMPT` are present.** A document that describes state without
  naming the next concrete action has failed, however beautiful it is.
- **Confidence is graded per claim** — ✅ verified this session, ⚠️ carried forward, ❓ assumed — and
  the successor is told to verify every ❓ before relying on it.

Then `state … DOC_WRITTEN`, and stop writing to the repo — the document is now being judged against a
frozen world.

### 5. Submit it for durability review

Never grade your own handoff near the limit. Record HEAD, a dirty-file manifest hash, and the document's
SHA-256, then:

```
scripts/review-handoff.sh <doc> <transcript> <workdir> <artifact-dir> [thread-id]
```

Codex if it is on PATH; otherwise dispatch a fresh Opus subagent with the same seven criteria. Either
way the reviewer runs in its own context — you pay for the prompt and the verdict, not the reasoning.
The reviewer gets your **transcript path**, so it can judge what the document *omitted*; that is the
check that catches the real failures.

Up to **3 rounds**. Revise and re-submit to the same reviewer session. You have final say — the
reviewer advises, it does not command — and you log what you changed and what you rejected, with
reasons. `VERDICT=UNKNOWN` is a failed review, never an approval.

At the cap without `DURABLE`: **hand off anyway**, with the unresolved objections as a prominent
section and the successor's literal first task. A stalled overnight run delivers nothing; a flagged
document still moves the work and is honest about what is shaky.

**Past the hard deadline, the review itself is bounded too:** run at most **one** review round,
with `TH_REVIEW_TIMEOUT=180`. If that single round is not `DURABLE`, hand off anyway with the
objections attached (the same rule as the 3-round cap above) — do not spend a second round burning
context you no longer have.

Then `state … REVIEWED`.

### 6. Spawn the successor

Claim the generation — this is the step that enforces the cap:

```
scripts/lease.sh next-gen <dir> <sid>     # exit 3 = cap reached
```

**Exit 3 means stop.** Write the document, report, and wait for the user. Do not spawn.

Write a mode-0600 control file holding the nonce, document path, model, effort, cwd, chain id,
generation, expected HEAD, and **your session id** (not your name — see step 7). Mark
`state … SPAWN_REQUESTED` **before** running the launcher — `spawn-failed` only refunds from that
state, so marking it afterwards would make a preflight failure unrefundable. Then:

```
scripts/spawn-successor.sh <control-file>
```

One opaque argument, by design: `argv` is world-readable through `ps`, so mission text and prompts
never touch a command line.

**The launcher preflights workspace trust and will refuse.** A `claude` started in a folder that has
never been trusted stops at an interactive "Is this a project you trust?" dialog — the process lives,
binds a socket, and never registers or runs your briefing. The handoff hangs forever with no error.
Observed 2026-08-15 during this skill's own smoke test, and the same trap is recorded in this repo's
parity notes ("Codex stopped at a trust prompt in a fresh isolated workspace"). If the launcher exits
7, tell the user to open that folder once and accept the prompt. **Never answer a trust dialog on
their behalf** — that is their decision, not yours.

**If the spawn fails at all** — trust preflight (exit 7), `osascript` blocked by Automation
permissions (exit 6), or any other non-zero exit — run `scripts/lease.sh spawn-failed <dir> <sid>`
before retrying. It refunds the generation `next-gen` claimed, so a failed attempt does not burn the
cap on a spawn that never happened.

### 7. Require attestation, stop your own loop, then transfer

A Terminal window is not a successor. Wait for it to message you with the **nonce**, its own session
id, its cwd, and the HEAD it observed. Verify all four, and re-check HEAD and the dirty manifest
against what the reviewer saw — if the world moved during the review, refresh before trusting it.

**Address by session id, never by stored name.** The control file instructs the successor to resolve
your *current* name from `claude agents --json` by matching your session id. Session names can be
changed by the user at any moment — that happened mid-test while building this skill, which would
have silently broken the reply address and stalled the handoff. Session ids are stable; names are not.

No attestation inside the deadline → kill only the nonce-matched child, `state … BLOCKED`, keep the
lease, and tell the user plainly. A failed handoff must be loud, never silent.

**Now stop your own loop — both kinds — BEFORE transferring, not after.** `ScheduleWakeup({stop:true})`
for a dynamic loop, **`CronDelete` with the recorded job id** for a fixed-interval one (`stop: true`
does **not** cancel a cron), `TaskStop` for any armed `Monitor`. Do this first: a tick that fires
between transfer and loop-stop would have this session act while it is no longer the owner. Missing
either leaves the old session waking up and working after the handoff.

Only then:

```
scripts/lease.sh transfer <dir> <sid> <successor-session-id> <successor-pid>
```

### 8. Report

Print, in plain language:

```
Handed off to a new Claude terminal — PID <pid>, session <id>.
Continuation document: <path>
Review: DURABLE (round 2 of 3, Codex gpt-5.6-terra)
Successor attested: nonce OK, cwd OK, HEAD <sha> OK.
This session no longer owns the work and will not continue it.
```

---

## The Standards

- One owner at a time, enforced by a file on disk — never by intention.
- The mission prompt survives byte-for-byte, or the handoff has failed.
- The context number fails closed: unknown model or unknown session means no handoff.
- Waiting always has a deadline; nothing blocks forever.
- No mission text, prompt, or secret is ever placed in a command line.
- A window opening is not success; attestation is.
- Sessions are addressed by session id; a stored name is never trusted (users rename sessions).
- An untrusted workspace refuses the spawn loudly rather than hanging on a dialog nobody sees.
- `git add -A` is never run. Commits name explicit paths.
- `.loop/HANDOFF.md` belongs to Claude-Loop and is never touched.
- Every state transition is journaled, so a crash is recoverable rather than mysterious.

---

## The Output

The user gets a new Terminal window, already working, holding the same mission at a fraction of the
context cost — plus a continuation document at the repo root that an outside reviewer has ruled
durable, a chain index showing which generation is live, and one plain-language line naming the PID
where the work now lives. The old window stays open and inert: nothing is lost, and it will not
quietly keep working.

Recover from a crash with `scripts/lease.sh get` and the journal; `status`, and `cancel` release the
chain without losing the documents. If a predecessor died mid-handoff and left the chain stranded,
`scripts/lease.sh recover <dir> <session-id> <pid>` takes ownership over — it refuses (exit 1) if the
recorded owner is still alive, so it cannot steal a lease out from under a live session. If a spawn
attempt itself failed (trust preflight, blocked Automation permissions), `scripts/lease.sh spawn-failed
<dir> <session-id>` refunds the generation that `next-gen` claimed, so the failed attempt does not
count against the cap.

---

## The Honest Limits

- **The trigger is an instruction, not a guarantee.** It rides in the `/loop` prompt, which is
  re-delivered verbatim every tick — the strongest in-session mechanism available — but nothing forces
  a model to run a check. A hook would be firmer; that was deliberately declined to avoid adding to an
  already-crowded hooks configuration.
- **The context percentage is a good heuristic, not an authority.** It is the last assistant turn's
  usage over a per-model window table, validated against `/context` to within a rounding error. It can
  drift if a window changes or compaction resets the count. The soft trigger (65%) sits 15 points
  below the 80% compaction point observed in practice — **not** the ~95% this skill's first version
  assumed, which was wrong — so a few points of drift are survivable, but not many. Read
  `$CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` rather than trusting either number.
- **An agent orchestrating its own replacement is structurally weaker than an external supervisor
  owning rotation.** For headless runs, `~/Claude-Loop` is the better tool and already does this. This
  skill exists for the case that one cannot serve: keeping the interactive session *you are sitting in*
  alive, in a window you can still talk to.
- **The successor has full capability** — every tool, bash, writes, subagents. That is the point, and
  it is also the risk. The only things constraining it are the document you wrote and the repository
  it lands in.
- **The attestation nonce is a bearer token, not proof of identity.** It authenticates POSSESSION of
  the control file — anyone who can read that file can attest with it. Any process running as the same
  macOS user can read it too, since the 0600 permission bit only stops other users. Attestation defends
  against accidents (the wrong window, a half-started successor), not against a hostile process already
  running as you.
- **macOS only.** It drives Terminal.app through `osascript`; VS Code's integrated terminal cannot be
  scripted this way. Automation permission must be granted or the spawn fails cleanly.
- **A new workspace needs one human "yes" first.** Handing off inside the folder you are already
  working in is fine — it is trusted by definition. A fresh clone, a new worktree, or a temp
  directory is not, and the skill will refuse to spawn there until the user accepts the trust prompt
  once themselves.
- **`flock` does not exist on macOS.** The lease uses `mkdir`, which POSIX guarantees is atomic.
  Verified against 12 concurrent claimants: no duplicate generation, no lost counter. Under heavy
  contention a claimant fails closed (exit 4) rather than risking a duplicate.
