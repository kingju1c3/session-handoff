# The Handoff Protocol

*Preserve an autonomous agent's fidelity across its context-window limit by handing the mission to
a fresh session **before** compaction destroys it — as an ownership transfer, not a polite goodbye.*

---

## The problem

A long agent run doesn't fail loudly. The context window fills, the harness compacts the
conversation into a summary, then later summarises the summary, and somewhere in there the agent
stops executing the plan and starts executing its *impression* of the plan. Nothing errors. The
tests still pass. The work just quietly drifts — and the further it drifts, the less context
survives to notice.

Compaction is the right default for a conversation. It is the wrong default for a **mission**.

## What this repo is

- **A protocol** — the platform-agnostic specification below: trigger policy, ownership lease,
  continuation document, durability review, transfer ordering, and the honest boundary between what
  is universal and what every platform has to supply itself.
- **Two working Claude Code skills** in [`skills/`](skills/) — reference adapters, installable now:
  - [`session-handoff`](skills/session-handoff/) — Claude Code on the web, the Desktop app, and
    bridged environments. Spawns successors with `create_session`. **Enforced by hooks.**
  - [`terminal-handoff`](skills/terminal-handoff/) — Claude Code in a local macOS terminal. Spawns
    successors by opening a new `Terminal.app` window.

## Why this isn't just a prompt telling a model to be careful

Because a model under load misses instructions, and the moment it matters most is the moment it is
most loaded. So on Claude Code the deadline is enforced by the harness, not by the model's judgment:

| Hook | What it does |
| --- | --- |
| `PreCompact` | **Refuses auto-compaction** while a handoff is armed and unfinished, and says which step to do next. Bounded at two attempts, then it lets compaction through and instead tells the summariser exactly what must survive verbatim. Never blocks a human's `/compact`. |
| `Stop` | **Refuses to let the turn end** mid-handoff — when the lease says a successor was promised and never delivered. Bounded at two. |
| `PostToolUse` | Injects the advisory when the session crosses the soft trigger, debounced. |
| `SessionStart` | Re-injects the chain state into a context that just lost it. |

`PreCompact` is the one that matters: it fires when compaction is *genuinely about to happen*, which
means the guarantee doesn't depend on any threshold being guessed correctly. Platforms compact
anywhere from ~60% to ~95% of their window — 35 points apart — so a tool that hardcodes a percentage
is wrong almost everywhere. This one derives its thresholds, and then doesn't have to rely on them.

## Quickstart (Claude Code)

```bash
git clone https://github.com/kingju1c3/session-handoff
cp -r session-handoff/skills/session-handoff ~/.claude/skills/     # global
# or: cp -r session-handoff/skills/session-handoff .claude/skills/  # one project

sh ~/.claude/skills/session-handoff/scripts/selftest.sh            # 46 assertions, no network
```

Requires `node` and `python3`. Then, in a session running a mission worth protecting:

```
/session-handoff
```

It arms a lease and **goes dormant**. With no armed chain the hooks exit immediately and do
nothing at all — install it globally and forget it. Once armed, it watches, warns at the soft
trigger, and refuses to let compaction happen before the mission is handed to a successor.

Successor sessions are named by lineage: `1.1` hands off to `2.1`; a parallel fork at that depth is
`2.2`. Depth is capped (default 5) and width is capped (default 2), because forks multiply live
sessions and therefore cost.

See [`skills/session-handoff/SKILL.md`](skills/session-handoff/SKILL.md) for the full method, the
`settings.json` install path, and its *Honest Limits* section.

---

## What "universal" honestly means here

A skill that claims to "just work on any LLM" without qualification is not telling the truth,
because the platforms don't share an API for the two things that matter most: *how full is my
context right now* and *how do I create a successor session*. Claude Code exposes one set of
primitives, OpenAI Codex another, Gemini CLI another, an open-source harness whatever its author
built. There is no common substrate to abstract over.

So this protocol is split deliberately:

- **The universal layer** — implement it identically everywhere. The trigger policy, the lease
  (ownership) semantics, the continuation document, the durability review, the transfer ordering,
  and the standards. None of it depends on which model or harness is running. `lease.sh` and
  `HANDOFF-TEMPLATE.md` are portable reference implementations of two of these pieces.
- **Three platform-specific extension points** — an adapter must supply each one for its platform.
  Everything platform-specific is confined to exactly these three, so writing an adapter is a
  bounded job, not a rewrite:

| Extension point | Question it answers | Must return |
| --- | --- | --- |
| **DETECT** | How full is this session's context, and at what percentage will the harness compact? | `used/max` as a percentage, plus the compaction point if the platform exposes it (else `unknown`) |
| **SPAWN** | How do I create a genuinely fresh successor session, in the same codebase, carrying the resume prompt? | A successor identifier |
| **ATTEST** | How do I confirm, from a source the successor can't fake, that it is alive and in the right place? | Pass / fail, with the evidence |
| **ENFORCE** *(optional)* | Can the harness itself make the trigger binding, rather than trusting the model to notice? | A hook that observes turns and, ideally, one that can **refuse compaction** |

The first three are required. **ENFORCE is optional but changes the character of the tool**: without
it, every threshold in this document is an instruction a model can miss under load; with it, the
harness enforces the deadline whether or not the model is paying attention. Where a platform
exposes a pre-compaction hook that can *block*, the guarantee stops depending on any percentage
being guessed correctly — the hook fires exactly when compaction is genuinely about to happen. See
the `ENFORCE` column in *Known adapters*; four of the platforms surveyed have a usable hook.

If a platform can't provide one of the required three, the protocol can't run there, and the adapter
should say so rather than fake it. See *Known adapters* for what real ones look like and *Writing an
adapter* for the checklist.

---

## The universal layer

### 1. The one rule

**Before doing any mission work, read the lease. If you are not the owner, stop.**

Ownership lives in a file on disk (`.handoff/LEASE.json`), never in intention. A session that has
handed off is *superseded* — not paused, not standing by — and must say so and stop, rather than
keep editing the same working tree as its successor. Two live sessions sharing one working tree
is the failure this whole protocol exists to prevent.

### 2. Trigger policy — derived from the compaction point, never guessed

The purpose is to hand off **before** compaction fires. Every threshold is relative to when that
will actually happen. DETECT must try to find the real compaction point; when it can't, the
defaults below are the conservative fallback and the adapter must say the point was unknown.

Everything is derived from the compaction point *C*. There are no absolute percentages in the
policy, because there is no percentage that is correct on more than one platform:

| Phase | Derivation | Meaning |
| --- | --- | --- |
| **Soft trigger** | `C − 15` | Start nothing new. Begin converging. |
| **Hard deadline** | `C − 5` | Successor spawned *and attested* by here. |
| **Ceiling** | `C` | Compaction. Already late — hand off immediately, skip review. |

The 10 points between soft trigger and hard deadline are the runway the entire handoff must finish
in; the 5 between hard deadline and ceiling absorb the attestation wait and one failure.

*C* is resolved in this order: **explicit configuration** → **the platform reporting it** →
**70%, assumed**. That fallback is a compromise, not a measurement: below Claude Code's own default
auto-compact, below Copilot CLI's ~95%, at the top of Gemini CLI's configurable range.

**Configuration is also how you buy margin, not just how you fill a gap.** Compaction is the only
*concrete, verifiable* fidelity cliff a platform exposes, so the policy derives from it — but
long-context degradation starts well before it, with no crisp number to act on. If your platform
compacts at 95% and you don't want a session driving a mission at 80% of a million-token window,
set the compaction point *lower than the truth* and the whole policy moves down with it. Declaring
a stricter cliff is supported and expected; hardcoding one for everybody is not.

**Why this is derived and not written down:** the first adapters shipped with a hardcoded 85% hard
deadline, inherited without checking. Reading the real compaction point on a live Claude Code
session showed it compacting at **80%** — the "deadline" was past the cliff. A deadline above the
compaction point is not a deadline. Never inherit a threshold; derive it.

**And where ENFORCE exists, none of this has to be right.** A pre-compaction hook that can block
fires at the real moment, so the thresholds become early warning rather than the guarantee. That is
the difference between a tool that usually hands off in time and one that hands off in time.

### 3. The lease

`LEASE.json` — one file, atomic replace on every write, guarded by a `mkdir`-based lock (POSIX
guarantees `mkdir` is atomic; `flock` does not exist everywhere):

```json
{
  "chainId": "<uuid>",
  "generation": 2,
  "fork": 1,
  "label": "2.1",
  "cap": 5,
  "forkCap": 2,
  "lineage": ["1.1", "2.1"],
  "ownerSessionId": "<platform session id>",
  "ownerPid": 0,
  "state": "OWNED",
  "updatedAt": 1760000000
}
```

States: `OWNED → WINDING_DOWN → DOC_WRITTEN → REVIEWED → SPAWN_REQUESTED → ATTESTED → TRANSFERRED`,
plus `BLOCKED` (handoff failed loudly, lease kept) and `RELEASED`. Every transition is appended to
`JOURNAL.jsonl`, so a crash is recoverable rather than mysterious.

**Session naming.** Every session in a chain has a label `<generation>.<fork>`. *Generation* is
depth — the root is `1.1`, its successor `2.1`, then `3.1`. *Fork* is width — a second, parallel
successor spawned at the same depth is `2.2`, then `2.3`. A chain that hands off twice and forks
once reads `1.1 → 2.1 → 2.2 → 3.1`. The label goes in the successor's session title and tags, so
the lineage is legible from a session list without opening anything.

Two caps, because the two axes cost differently: `cap` (default 5) bounds depth and is the brake on
an unattended chain running forever; `forkCap` (default 2) bounds width, and matters more, because
forks multiply *simultaneously live* sessions rather than sequential ones. `next-gen` and
`next-fork` each claim atomically and refuse with exit 3 at their cap. A failed spawn *rewinds the
lineage* (`spawn-failed`, only from `SPAWN_REQUESTED`), so an attempt that never became a session
doesn't burn either cap.

`ownerPid` is a local-process convenience for adapters that have one; for remote sessions it is
`0` and **liveness is an ATTEST-layer fact, not a lease-file fact.** `recover` (take over a
chain whose owner died) therefore requires the caller to have established, through ATTEST's
mechanism, that the recorded owner is not running — the reference `lease.sh` in the remote
adapter does not pretend to check that itself.

Reference implementation: `scripts/lease.sh` (POSIX sh + python3, no other dependencies —
`uuidgen` was removed after it turned out not to exist on every Linux image).

### 4. The continuation document

Filled from `HANDOFF-TEMPLATE.md`, written to the repo root as
`AI_Continuation_Document-<DDMmmYYYY>-<HHMM>.md`, previous one bannered as superseded. Three
things are non-negotiable, whatever the platform:

1. **The mission prompt is verbatim.** Not summarized, not tidied. A paraphrase silently converts
   a continuing loop into a one-shot session that stops after one pass.
2. **`FIRST ACTIONS` and `RESUME PROMPT` are present.** A document that describes state without
   naming the next concrete action has failed, however beautiful it is.
3. **Confidence is graded per claim** — ✅ verified this session, ⚠️ carried forward, ❓ assumed —
   and the successor is told to verify every ❓ before relying on it.

The document is a snapshot, **not an authority**: it names the real source of truth and defers to
it wherever they disagree.

### 5. Durability review — never grade your own handoff near the limit

An outside reviewer with its own context judges the document against seven criteria and ends with
exactly one line, `VERDICT: DURABLE` or `VERDICT: NOT DURABLE`:

1. Mission preserved verbatim; 2. Actionable next step; 3. Every claim verifiable (SHA, path,
exact command — "tests pass" with no command fails); 4. **Complete against the transcript** — the
single most important check, it catches omissions; 5. Landmines (failed approaches) recorded;
6. Authority correctly disclaimed; 7. Confidence honestly graded, over-claiming flagged.

Up to 3 rounds; the author has final say and logs what it rejected and why. `VERDICT=UNKNOWN`
(no parseable final line — trailing prose after a verdict counts as no verdict) is a failed
review, never an approval. At the cap without `DURABLE`: **hand off anyway** with the objections
as a prominent section and the successor's first task. Past the hard deadline: one round. At
the ceiling: none. A stalled run delivers nothing; a flagged document still moves the work and
is honest about what is shaky.

The reviewer's independence varies by adapter (a separate process/tool > a subagent > self) and
the adapter must say which it provides.

### 6. Transfer ordering — stop your own loop first

1. SPAWN the successor. 2. ATTEST it. 3. **Stop every mechanism that could make this session act
again** — dynamic loops, scheduled/cron triggers, armed monitors — *before* step 4, because a tick
that fires between transfer and loop-stop would have the old session act while it no longer owns
the work. 4. `lease transfer`. 5. Report, in plain language, where the work now lives.

No attestation within the deadline → `BLOCKED`, keep the lease, tell the user plainly. A failed
handoff must be loud, never silent.

### 7. The standards

- One owner at a time, enforced by a file on disk — never by intention.
- The mission prompt survives byte-for-byte, or the handoff has failed.
- Thresholds are derived from the real compaction point; an unknown point is *said*, not assumed.
- Waiting always has a deadline; nothing blocks forever.
- A successor existing is not success; attestation is — and attestation is a fact the platform
  reports, not something the successor reports about itself.
- No mission text or secret is placed anywhere an untrusted party can read it (for a spawned OS
  process, that means never in argv — `ps` is world-readable).
- `git add -A` is never run. Commits name explicit paths.
- Every state transition is journaled.

---

## Known adapters

| Platform | Adapter | DETECT | SPAWN | ATTEST | Status |
| --- | --- | --- | --- | --- | --- |
| **Claude Code, local CLI (macOS)** | `terminal-handoff` | `context-check.mjs` reads the local transcript JSONL (last assistant turn's token usage / per-model window) + `$CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | `osascript` opens a new `Terminal.app` window running `claude` with a mode-600 control file (mission never touches argv) | Successor messages back a nonce + its session id + cwd + observed HEAD | Built. macOS only (Terminal.app). Reviewer: Codex CLI if present, else a subagent. |
| **Claude Code Remote** — web (claude.ai/code), Desktop app, bridged environments | `session-handoff` | `get_session` (self) → server-computed `context_usage.used_tokens/max_tokens`; `watchdog.mjs` reads the transcript tail for the hooks, which cannot call MCP tools + `$CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | `create_session` tool call (same repo/branch; user picks the target environment — same cloud, or a `bridge` to a real machine) | `get_session(successor)` → status running, repo/branch match — a server fact | Built, **enforced by hooks**, and **live-tested 2026-09-07**: `create_session` spawned a real successor that booted to running in ~35s, checked out the requested branch (server-reported), and executed the resume prompt (`task_summary`). No OS dependency. Caveats: DETECT metric updates per completed turn, not live; a successor's full transcript isn't readable, but its final reply is (`post_turn_summary.recent_action` after its turn completes) — the test successor's attestation line read back verbatim. Reviewer: subagent only. |
| **OpenAI Codex** (CLI / Desktop app) | *not built* | `PreCompact` hook (GA v0.124+) fires at the real moment — no percentage heuristic needed; or `~/.codex/sessions/*.jsonl` `turn.completed` token usage | `codex exec fork <SESSION_ID> "<prompt>"` — the fork natively inherits the full prior transcript, so far less rests on the written document than on Claude Code | `PreToolUse` hook can *deny* tool calls from a superseded session — enforceable, not advisory | Researched only. Sketch: hook-driven fork, lease check enforced by hook. Would need a live install to verify hook I/O contracts. |
| **Gemini CLI** | *not built* | sessions are JSONL with token-usage stats in `~/.gemini/tmp/<project_hash>/chats/`; `/stats` in-session; auto-compress is a **configurable** threshold (cheat sheets cite ~60%) — read it as *C* | `gemini -r "<session-id>" "<prompt>"` resumes a session with a new prompt in one command (headless mode); `/chat save <tag>` checkpoints; no true fork — a fresh session + the continuation document is the pattern | `gemini --list-sessions`; headless stdout for the attestation line | Researched 2026-09-07. Skills + hooks are first-class (Agent Skills standard; `gemini hooks migrate` imports Claude Code hooks). Buildable. |
| **GitHub Copilot CLI** | *not built* | `/context` and `/usage` in-session; **auto-compaction documented at ~95%** — so *C*≈95 and the defaults are comfortably conservative | `copilot --continue` / `--resume`; `&`-prefix delegates to the cloud coding agent; VS Code can fork a conversation from a checkpoint; no verified single-command resume-with-prompt | session picker via `/resume`; cloud-agent session state on GitHub | Researched. Skills GA; reads `.github/skills/`, `.claude/skills/`, `.agents/skills/` directly. Hooks: `sessionStart/End`, `preToolUse`, `postToolUse` — **no `preCompact`**. Buildable. |
| **Cursor** | *partial* | **`preCompact` hook** delivers `context_usage_percent` (0–100) and `trigger` (auto/manual) — the best DETECT signal of any platform here; works in cloud agents too | Cloud/background agents exist; no verified scriptable "create agent session with prompt" primitive found | unverified | Skills first-class (`.cursor/skills/`, `.agents/skills/`). DETECT solved; SPAWN unverified. |
| **Amp (Sourcegraph)** | *native* | Amp **replaced compaction with `/handoff`** (Oct 2025) — no compaction point exists; token-usage hover shows fullness | `/handoff <goal>`: analyzes the thread, drafts a prompt + relevant files, opens a **new thread**, original untouched | new thread exists; draft is user-reviewed before send | Native prior art for SPAWN + document. What it lacks is exactly this protocol's other half: automatic trigger, and a **lease** — Amp keeps the old thread alive with no ownership transfer, the two-live-threads risk the lease exists to prevent. Its docs: "requires user interaction (not automatic)." |
| **OpenClaw** | *not built* | `before_compaction`/`after_compaction` plugin hooks (observe-only); a built-in **pre-compaction memory flush** silent turn at a soft threshold; rule is `contextTokens > contextWindow − reserveTokens`; `openclaw sessions --json` | `/new` fresh session; subagent/thread fork with parent-fork policy; **sub-agents cannot spawn sub-agents** (no nesting) | `openclaw sessions --json` | Researched. The closest existing design to this protocol's trigger policy. Known bug at time of research: hook-driven compaction could brick a session (#30134). Buildable. |
| **OpenAI Responses API** (hosted shell + skills) | *not built* | `usage` object on every response | new response with `previous_response_id`, or fresh | the API response itself | Developer-platform target, not the consumer app. Researched. |
| **ChatGPT (consumer chat)** | *not a target* | — | — | — | No skills-with-scripts, no shell, no session primitive. Its agent surface is Codex (`chatgpt.com/codex`) — use that row. |
| Cline / Roo / others | *not researched* | ? | ? | ? | Not looked at. Not claiming anything. |
| Anything else | *your adapter* | ? | ? | ? | See below. |

**Compaction points observed, per platform** (the number every threshold must be derived from):
Claude Code Remote **80%** (live, `$CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`); Copilot CLI **~95%** (documented); Gemini CLI **configurable** (~60% cited); OpenClaw `window − reserve` (config); Amp **none** (handoff replaced it). They differ by 35 points. A skill that hardcodes one number is wrong on most platforms — which is why DETECT must read *C* and the policy derives from it.

**What is genuinely portable across all of them:** the `SKILL.md` package itself. Gemini, Copilot, Cursor, Codex, and Claude Code all read the same format (Copilot reads `.claude/skills/` directly; Gemini migrates Claude Code hooks). So the protocol, the lease, the template, and the review criteria ship once. Only DETECT/SPAWN/ATTEST are per-platform — and the table above is the honest state of each.

### ENFORCE, per platform

Whether the harness can make the deadline binding, rather than advisory:

| Platform | Pre-compaction hook | Can it block? | Consequence |
| --- | --- | --- | --- |
| **Claude Code** | `PreCompact` (`compaction_reason` distinguishes auto from manual) | **Yes** — exit 2 prevents compaction | Implemented in `session-handoff`. Also uses `Stop` (blocks ending a turn mid-handoff), `PostToolUse` (advisory), `SessionStart` (re-orients a compacted context). Skills may register hooks from their own frontmatter. |
| **Cursor** | `preCompact`, delivering `context_usage_percent` and `trigger` | Not verified | Best DETECT signal of any platform surveyed — it hands you the percentage directly. |
| **OpenAI Codex** | `PreCompact` (GA v0.124+) | Not verified | `PreToolUse` can *deny* tool calls from a superseded session — a stronger lease than any file on disk. |
| **OpenClaw** | `before_compaction` / `after_compaction` | **No** — observe-only | Has a built-in pre-compaction memory flush at a soft threshold; closest existing design to this policy. |
| **GitHub Copilot CLI** | none (`sessionStart/End`, `preToolUse`, `postToolUse` only) | — | Advisory only. Its ~95% compaction point leaves generous runway, so this hurts less than it would elsewhere. |
| **Gemini CLI** | hooks are first-class; `gemini hooks migrate` imports Claude Code hooks | Unverified for compaction | Worth checking whether the migrated `PreCompact` retains blocking semantics. |
| **Amp** | n/a — compaction was *replaced* by `/handoff` | — | Nothing to block. |

The pattern to copy where a blocking hook exists: **bound every block and fail open.** A hook that
refuses compaction indefinitely wedges the session it was protecting — a full context that can never
compact cannot do anything else either. `session-handoff` grants two blocks per generation, then
lets compaction through and instead instructs the summariser on exactly what must survive verbatim.
And a human's explicit `/compact` is a decision, not an accident: never block it.

---

## Writing an adapter

Copy `HANDOFF-TEMPLATE.md` and `scripts/lease.sh` unchanged. Then answer, concretely and
honestly, in a `SKILL.md`:

1. **DETECT** — what call or file gives `used/max`? Does the platform expose its compaction point?
   If not, say the defaults are a guess and why they're conservative.
2. **SPAWN** — what primitive creates a fresh session in the same codebase with a prompt? Does it
   inherit prior context (Codex `fork`) or start empty (Claude Code)? That decides how much weight
   the continuation document carries. Where does the mission text travel, and can anything
   untrusted read it there?
3. **ATTEST** — what does the *platform* report about the successor that the successor can't
   fabricate? If the answer is "only what the successor tells me," say so; that's a bearer-token
   attestation, and it defends against accidents, not adversaries. A strong two-layer pattern,
   verified live on Claude Code Remote: (1) placement — the platform's own record of the
   successor's status and checked-out branch; (2) execution — make the resume prompt demand one
   exact reply line, then read it back through the platform's post-turn record rather than a
   message the successor chose to send. The successor produced the line, but the platform relayed
   it, so a skipped or garbled attestation is a visible mismatch, not silence.
4. **ENFORCE** — does the platform have a hook that runs before compaction, and can it *block*? If
   yes, wire it, and bound it: two blocks then fail open, never block a manual compaction, and make
   the block message tell the model exactly which step to do next. If no, say plainly that the
   trigger is advisory.
5. **Reviewer** — separate process, subagent, or self? Say which.
6. **Loop-stop** — what are *all* the mechanisms that could wake this session again, and how is
   each one stopped before transfer?
7. **Honest limits** — what you could not test, what it costs, what it can't do. An adapter without
   this section isn't finished.

Run the scripts through their paces on the target platform before shipping. `session-handoff`'s
`selftest.sh` is the pattern: 46 assertions over the lease, the threshold derivation, and every
hook path, with no network and nothing touched outside a temp dir. The `terminal-handoff` version
caught a real dependency bug (`uuidgen` missing on Linux) on its first run.

---

## Provenance

- `terminal-handoff` v1.0.0 — original Claude Code CLI skill (author unrecorded in the archive
  it arrived in; reviewed file-by-file before installation).
- `session-handoff` — derived adapter for Claude Code Remote surfaces, 2026-09-07.
- This protocol — extracted from both, with the trigger policy corrected against a live
  compaction point (85% → derived-from-`C`), 2026-09-07.
- **ENFORCE layer added 2026-09-07**, after verifying against the Claude Code hooks reference that
  `PreCompact` can block compaction and that skills can register hooks from their own frontmatter.
  Earlier revisions of both adapters stated the opposite — that no such hook surface existed — and
  were wrong. The correction is recorded in each adapter's *Honest Limits* rather than quietly
  edited away.
