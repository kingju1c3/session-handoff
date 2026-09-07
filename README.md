# session-handoff

**Hand a long-running agent session to a fresh one *before* auto-compaction destroys it — as an
ownership transfer, not a polite goodbye.**

An [Agent Skill](https://code.claude.com/docs/en/skills) for Claude Code on the web, the Desktop
app, and Claude Code Remote-bridged environments.

---

## The problem

A long agent run doesn't fail loudly. It fades.

The context window fills. The harness compacts the conversation into a summary. Later it summarises
the summary. And somewhere in there the agent stops executing the plan and starts executing its
*impression* of the plan. Nothing errors. The tests still pass. The work just quietly drifts — and
the further it drifts, the less context survives to notice.

Compaction is the right default for a conversation. It is the wrong default for a **mission**.

## What this does

When context crosses a derived threshold, the session:

1. **Stops expanding** — no new workstreams, no new tangents.
2. **Converges** what's in flight to a real checkpoint, with a deadline.
3. **Writes a continuation document** — including the mission prompt *byte-for-byte verbatim*,
   because a paraphrase silently turns a continuing loop into a one-shot session.
4. **Submits it for adversarial review** by a fresh reviewer with its own context, against seven
   criteria. A session at 70% context is the last thing that should grade its own handoff.
5. **Spawns a genuinely fresh session** carrying that mission.
6. **Proves the successor is alive** from a source the successor cannot fabricate.
7. **Transfers ownership** — and then stops working. Two live sessions sharing one working tree is
   the failure this exists to prevent.

## Why this isn't just a prompt telling a model to be careful

Because a model under load misses instructions, and the moment it matters most is the moment it's
most loaded. So the deadline is enforced by the harness, not by the model's judgment:

| Hook | What it does |
| --- | --- |
| `PreCompact` | **Refuses auto-compaction** while a handoff is armed and unfinished, naming the exact next step. Bounded at two attempts, then it lets compaction through and instead tells the summariser exactly what must survive verbatim. Never blocks a human's `/compact`. |
| `Stop` | **Refuses to let the turn end** mid-handoff, when the lease says a successor was promised and never delivered. Bounded at two. |
| `PostToolUse` | Injects the advisory when the session crosses the soft trigger. Debounced; escalations always get through. |
| `SessionStart` | Re-injects the chain state into a context that just lost it. |

`PreCompact` is the one that matters: it fires when compaction is *genuinely about to happen*, so
the guarantee doesn't depend on any threshold being guessed correctly.

That matters more than it sounds. Agent platforms compact anywhere from **~60% to ~95%** of their
window — 35 points apart. Any tool that hardcodes a percentage is wrong almost everywhere. This one
derives its thresholds from the platform's real compaction point, and then doesn't have to rely on
them being right.

## Install

The repository **is** the skill. Clone it straight into your skills directory:

```bash
git clone https://github.com/kingju1c3/session-handoff ~/.claude/skills/session-handoff
sh ~/.claude/skills/session-handoff/scripts/selftest.sh
```

`selftest.sh` runs 46 assertions over the lease, the threshold derivation, and every hook path — no
network, no session spawning, nothing written outside a temp dir.

Per-project instead: clone into `.claude/skills/session-handoff/`.

For unattended runs, also register the hooks in `~/.claude/settings.json` so they're live from the
first turn (and so you get `SessionStart`) — the snippet is in [`SKILL.md`](SKILL.md).

Requires `node` and `python3`.

## Use

In a session running something worth protecting:

```
/session-handoff
```

It arms a lease and **goes dormant**. With no armed chain every hook exits immediately and does
nothing — install it globally and forget it. Once armed, it watches, warns at the soft trigger, and
refuses to let compaction happen before the mission has a successor.

Successors are named by lineage — `1.1` hands off to `2.1`; a parallel fork at that depth is `2.2`:

```
1.1 ──→ 2.1 ──→ 3.1
         └──→ 2.2        (parallel fork)
```

Depth is capped (default 5) and width is capped (default 2), because forks multiply *simultaneously
live* sessions and therefore cost.

## Thresholds

```
soft trigger  = compaction point − 15 points
hard deadline = compaction point −  5 points
```

The compaction point is resolved as: `HANDOFF_COMPACTION_PCT` (your config) →
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (the platform stating it) → **70%, assumed**.

Configuration is also how you buy margin, not just how you fill a gap. If your platform compacts at
95% and you don't want a mission being driven at 80% of a million-token window, set the compaction
point *lower than the truth* — the whole policy moves down with it.

**Why derived and not written down:** an earlier version of this carried a hardcoded 85% hard
deadline. Reading the real compaction point on a live session showed it compacting at 80% — the
"deadline" was past the cliff. A deadline above the compaction point is not a deadline.

## What's verified, and what isn't

This matters more than a feature list, so it's stated plainly here and in full in [`SKILL.md`](SKILL.md):

- ✅ **Spawning works.** Live-tested: a real successor reached running/connected in ~35 seconds with
  the requested branch checked out — a server-reported fact, not self-reported.
- ✅ **Attestation works in two layers** — the platform's own record of where the session is, plus
  its relay of the successor's first reply, so a skipped attestation is a visible mismatch rather
  than silence you might read as success.
- ✅ **Every hook path is tested** — all four events, every block, budget, debounce and cap.
- ⚠️ **Hook registration from skill frontmatter** follows the official hooks reference but was not
  observed firing here. The `settings.json` install is the belt-and-braces version.
- ⚠️ **Desktop-app tool availability is inferred**, not directly verified. Where the spawn tools are
  absent, everything up to the reviewed continuation document still works; only the automatic spawn
  doesn't — and the skill says so rather than pretending.
- ⚠️ **This costs real money.** Each generation is a real session. That's what the caps are for.

## Porting to another agent

The parts that are genuinely portable ship once: the ownership lease, the continuation template, the
seven review criteria, the transfer ordering, the trigger policy. Only three things are
platform-specific — **DETECT** (how full am I, and where does this platform compact), **SPAWN** (how
do I create a successor carrying a prompt), and **ATTEST** (what can the platform tell me about that
successor that it can't fake) — plus an optional fourth, **ENFORCE** (can a hook refuse compaction).

What that looks like elsewhere, from research rather than working implementations:

| Platform | DETECT | SPAWN | Can a hook block compaction? |
| --- | --- | --- | --- |
| **Cursor** | `preCompact` hook delivers `context_usage_percent` directly — the best DETECT signal anywhere | cloud/background agents exist; no verified scriptable create-with-prompt | unverified |
| **OpenAI Codex** | `PreCompact` hook (GA v0.124+); or session JSONL token usage | `codex exec fork <id> "<prompt>"` — natively inherits the prior transcript | likely; `PreToolUse` can also *deny* tool calls from a superseded session |
| **Gemini CLI** | session JSONL + `/stats`; auto-compress threshold is configurable (~60% cited) | `gemini -r "<id>" "<prompt>"` resumes with a new prompt in one command | hooks are first-class; `gemini hooks migrate` imports Claude Code hooks |
| **GitHub Copilot CLI** | `/context`, `/usage`; auto-compaction documented at ~95% | `copilot --resume`; `&`-prefix delegates to the cloud agent | no `preCompact` — advisory only |
| **OpenClaw** | `contextTokens > contextWindow − reserveTokens`; `openclaw sessions --json` | `/new`; subagent fork (no nesting) | `before_compaction` is observe-only |
| **Amp** | token-usage display | `/handoff` opens a new thread natively — but keeps the old one alive, with no ownership transfer | compaction was *replaced* by handoff |

The `SKILL.md` package format itself is portable: Gemini, Copilot, Cursor, Codex and Claude Code all
read it, and Copilot reads `.claude/skills/` directly.

## License

MIT © 2026 KingJu1c3
