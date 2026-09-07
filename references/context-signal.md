# Context signal contract

The watchdog consumes a small, host-neutral JSON observation. A host adapter is
responsible for measuring context and checking its source; these helpers do not
poll model-provider APIs, install hooks or launch sessions. Use an effective
session window and the earliest applicable compaction/truncation boundary.

```json
{
  "session_id": "session-from-the-host",
  "observed_at": "2026-09-07T12:00:00Z",
  "source": {"kind": "host", "name": "your-host-adapter"},
  "used_tokens": 40000,
  "window_tokens": 100000,
  "compaction_pct": 60,
  "next_step_tokens": 2000,
  "reserve_tokens": 5000
}
```

This is a synthetic example. Replace the timestamp and measurements with a fresh
observation; do not reuse the example as a live signal. Save signals in a private
directory, then evaluate **before** the proposed action:

```sh
node /ABSOLUTE/SKILL/DIR/scripts/watchdog.mjs \
  --dir /ABSOLUTE/PROJECT/.handoff --session session-from-the-host \
  --signal /ABSOLUTE/PRIVATE/context.json
```

`session_id` must match both the independently supplied current session and its
lease owner. `source` is provenance supplied by the adapter, not cryptographic
authentication. `observed_at` is an ISO timestamp; default maximum age is 60
seconds. Refresh on each preflight and after a host/model/settings change. A
fresh timestamp alone cannot repair an old or incomplete measurement.

Fields are JSON numbers, never numeric strings, booleans, NaN or Infinity. Use
`used_pct` instead of the used/window pair on percentage-only hosts. Thresholds
and budgets may likewise use `compaction_tokens`, `next_step_pct`, `reserve_pct`.
Token fields need `window_tokens`. If both representations are supplied they
must agree. Missing or contradictory values produce `CHECKPOINT_NOW`.

`next_step_*` is an upper bound for everything the upcoming action adds to the
resident context: input, tool output, generated output/reasoning where counted,
and any queued worker results. `reserve_*` is a **separate** budget for writing,
reviewing and delivering the checkpoint, bootstrapping a candidate and completing
acknowledgment/transfer. Supply both explicitly; the reserve must be positive.
An explicit zero next-step budget is permitted for a no-op. Unknown or unbounded costs are
not zero; checkpoint before proceeding. The caller remains responsible for
limiting tool output and ensuring the host actually honors those bounds.

For boundary `c`, policy margins are:

```text
soft = c − min(15, c × 0.25)
hard = c − min(5,  c × 0.10)
projected = used + next_step + reserve
```

All quantities above are percentage points of the same effective window.
Projecting past a deadline triggers before the next action starts. Margins stay
ordered even for a host compacting at 1%; they are not vendor defaults or a timing
guarantee. Any in-flight work must also fit inside the remaining reserve.

Configuration:

| Environment variable | Meaning |
| --- | --- |
| `HANDOFF_CONTEXT_SIGNAL` | Explicit JSON file path; invalid files do not silently fall back |
| `HANDOFF_SESSION_ID` | Current independently obtained session ID |
| `HANDOFF_COMPACTION_PCT` | Optional earlier safety cap; cannot postpone a host boundary or substitute for an unknown boundary |
| `HANDOFF_SIGNAL_MAX_AGE_MS` | Observation freshness limit, default 60000 ms |

An optional explicit Claude transcript reader accepts `--transcript` or
`HANDOFF_TRANSCRIPT`. It reads a bounded tail of the selected transcript, checks
the row's session identity and timestamp, and counts the last resident input
including cache reads/creation. It requires `HANDOFF_WINDOW_TOKENS`, the host's
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, plus explicit `HANDOFF_NEXT_STEP_TOKENS` (or
`_PCT`) and `HANDOFF_RESERVE_TOKENS` (or `_PCT`). It does not search unrelated
transcripts or guess a window from a model name. Transcript input usage may omit
newer generated or queued content; include that in the next-step bound or reject
the reading as incomplete. This reader is not an adapter for every host's JSONL.

`enforce` in watchdog output means the numerical policy has enough validated
inputs to act on. It does **not** mean the host supports a compaction veto.
`compactionVeto` is always false in the host-neutral evaluator. With no trustworthy
measurement or budget, preserve a checkpoint immediately and arrange an early
fresh-session handoff. Universal automatic timing cannot be promised on that host.

## Optional hook wrapper

`scripts/hooks.mjs` reads JSON from stdin. Generic mode emits a neutral result for
a supervisor to translate: `event`, `decision`, `phase`, `reason`, and `context`.
It is not a provider's hook schema. Supply `context_signal` inline or use the
signal file environment variable. A generic warning cannot stop a host by itself.

```json
{
  "event": "Preflight",
  "session_id": "session-from-the-host",
  "cwd": "/ABSOLUTE/PROJECT"
}
```

The optional `HANDOFF_HOOK_ADAPTER=claude` output adapter uses the documented
Claude hook envelope for supported context events and exit 2 for requested
blocks. Enable `HANDOFF_CAN_BLOCK_COMPACTION=1` or `HANDOFF_CAN_BLOCK_STOP=1` only
after an installed-host smoke test confirms that exact event's behavior.
Compaction delay applies only to `PreCompact`, not Cursor's `preCompact` or
Gemini's `PreCompress`. Manual compaction passes through. Unknown adapters never
receive an invented exit-code guarantee.

Block attempts are capped at two per chain/generation/session and fail open if
bookkeeping cannot be saved or its serialization lock is unavailable. A crashed
hook can leave `.hook-budget.lock`; inspect and remove that file only after
confirming no hook process owns it. A stale lock disables blocks, never steals
another hook's budget. This avoids wedging a full session; it also means a
blocked hook is no guarantee of eventual handoff. Hooks provide no mission writer
lock; every participant must check the lease. Register them using absolute paths
and merge into existing host settings without replacing other hooks. Installation
does not automatically modify those settings. See [host notes](hosts.md).
