#!/bin/sh
# terminal-handoff — adversarial durability review of a continuation document.
#
# A session at 70% context is the last thing that should grade its own handoff.
# GSD names the failure exactly: "silent partial completion — agent claims task is
# done but implementation is incomplete." So an outside reviewer rules on it.
#
# Codex runs READ-ONLY in its own process, so the parent session pays only for the
# prompt and the verdict — not the reviewer's reasoning.
#
# Usage:
#   review-handoff.sh <doc> <transcript> <workdir> <artifact-dir> [thread-id]
#
# Round 1 omits <thread-id>. Later rounds pass the thread id printed by round 1 so
# the SAME reviewer session re-reviews with its context intact.
#
# Prints to stdout:
#   THREAD_ID=<id>          (round 1 only, when obtainable)
#   VERDICT=DURABLE | NOT_DURABLE | UNKNOWN
# The reviewer's full critique is written to <artifact-dir>/review-<n>.md
#
# Exit: 0 review completed (read VERDICT) · 2 bad args · 7 codex missing
#       8 codex failed or timed out — treat as a FAILED review, never as approval.
#
# THREE MECHANICS THAT ARE NOT OPTIONAL (from ~/.claude/skills/codex-review, verified 2026-06-04):
#   1. `< /dev/null` — codex exec reads stdin IN ADDITION to the prompt arg. Without
#      the redirect it blocks forever at ~0% CPU under any non-TTY driver.
#   2. `codex exec resume` REJECTS `-s`. Read-only must be forced with
#      `-c sandbox_mode="read-only"`, because config.toml may default to
#      danger-full-access — which would let the reviewer WRITE files.
#   3. A hard timeout. A stall must fail loudly, not hang the handoff.
set -eu

DOC="${1:-}"; TRANSCRIPT="${2:-}"; WORKDIR="${3:-}"; ARTDIR="${4:-}"; THREAD="${5:-}"
[ -n "$DOC" ] && [ -n "$TRANSCRIPT" ] && [ -n "$WORKDIR" ] && [ -n "$ARTDIR" ] || {
  echo "usage: review-handoff.sh <doc> <transcript> <workdir> <artifact-dir> [thread-id]" >&2; exit 2; }
[ -f "$DOC" ] || { echo "doc not found: $DOC" >&2; exit 2; }
command -v codex >/dev/null 2>&1 || { echo "codex not on PATH" >&2; exit 7; }

mkdir -p "$ARTDIR"
# Next round = highest existing index + 1, counting BOTH .md and .jsonl —
# a timed-out round leaves an orphan .jsonl, and its index must not be reused
# (reuse would truncate the stream a postmortem needs).
_max=$(find "$ARTDIR" -maxdepth 1 \( -name 'review-*.md' -o -name 'review-*.jsonl' \) 2>/dev/null \
  | sed -nE 's/.*review-([0-9]+)\.(md|jsonl)$/\1/p' | sort -n | tail -1 | awk '{print $0+0}')
N=$(( ${_max:-0} + 1 ))
OUT="$ARTDIR/review-$N.md"
STREAM="$ARTDIR/review-$N.jsonl"

MODEL="${TH_REVIEW_MODEL:-gpt-5.6-terra}"
EFFORT="${TH_REVIEW_EFFORT:-xhigh}"
# Past the 85% hard deadline the CALLER sets TH_REVIEW_TIMEOUT=180 and runs at
# most 1 round — see SKILL.md step 5 / fix F14. This script does not enforce
# the round cap itself; it only honors whatever timeout it is given.
TIMEOUT_S="${TH_REVIEW_TIMEOUT:-600}"

PROMPT="You are an adversarial reviewer judging whether a SESSION HANDOFF DOCUMENT is DURABLE —
i.e. whether a brand-new agent with zero memory could pick up this work using only that document
plus the repository, and continue correctly without asking a single clarifying question.

Handoff document: $DOC
Repository:       $WORKDIR
Predecessor session transcript (JSONL): $TRANSCRIPT

Read the document in full. Then SAMPLE THE TAIL of the transcript (the last few hundred lines are
enough — do not read the whole file) and compare. You are read-only; modify nothing.

Judge these seven criteria and state a finding for each:
1. MISSION PRESERVED — is the mission prompt reproduced verbatim, and could the successor re-arm it
   exactly? A paraphrase is a FAILURE: it silently turns a continuing loop into a one-shot session.
2. ACTIONABLE — is the next action concrete enough to execute immediately, with no clarification?
3. VERIFIABLE — is every factual claim checkable (commit SHA, file path, exact command)? Vague
   claims like 'tests pass' with no command are failures.
4. COMPLETE VS TRANSCRIPT — does anything material that happened in the transcript fail to appear in
   the document? This is the single most important check. Name specific omissions.
5. LANDMINES — are failed approaches and dead ends recorded, so the successor will not repeat them?
6. AUTHORITY — is the governing plan/tracker named, and does the document correctly disclaim its own
   authority rather than posing as the source of truth?
7. HONEST CONFIDENCE — is anything marked HIGH confidence that was not actually verified this
   session? Flag over-claiming specifically.

Be concrete and hostile to hand-waving. For each failure give a one-line fix. Rank by severity.
Do not pad with praise.

End your reply with EXACTLY one line:
VERDICT: DURABLE
or
VERDICT: NOT DURABLE"

set +e
if [ -z "$THREAD" ]; then
  # Round 1 — fresh reviewer. -s read-only is accepted here.
  ( cd "$WORKDIR" && \
    exec codex exec -s read-only --json -m "$MODEL" -c model_reasoning_effort="$EFFORT" \
      -o "$OUT" "$PROMPT" < /dev/null > "$STREAM" 2>&1 ) &
  CPID=$!
else
  # Resume — MUST force read-only via -c; `resume` rejects -s.
  ( cd "$WORKDIR" && \
    exec codex exec resume "$THREAD" -c sandbox_mode="read-only" -c model_reasoning_effort="$EFFORT" \
      --json -o "$OUT" \
      "The handoff document was revised. Re-review $DOC against the same seven criteria. Same rules, still read-only. End with exactly one line: VERDICT: DURABLE or VERDICT: NOT DURABLE" \
      < /dev/null > "$STREAM" 2>&1 ) &
  CPID=$!
fi

# Hard ceiling — a stall fails loudly rather than hanging the handoff.
( sleep "$TIMEOUT_S"; kill -0 "$CPID" 2>/dev/null && kill -TERM "$CPID" 2>/dev/null ) 2>/dev/null &
WPID=$!
wait "$CPID"; RC=$?
kill "$WPID" 2>/dev/null || true
set -e

if [ "$RC" -ne 0 ]; then
  echo "VERDICT=UNKNOWN"
  echo "codex exited $RC (timeout ceiling ${TIMEOUT_S}s) — treat as a FAILED review, not approval" >&2
  exit 8
fi

if [ -z "$THREAD" ]; then
  TID=$(python3 - "$STREAM" <<'PY'
import json,sys
for line in open(sys.argv[1], errors="ignore"):
    line=line.strip()
    if not line.startswith("{"): continue
    try: d=json.loads(line)
    except Exception: continue
    for k in ("thread_id","threadId"):
        if d.get(k): print(d[k]); raise SystemExit
    t=d.get("thread") or {}
    if isinstance(t,dict) and t.get("id"): print(t["id"]); raise SystemExit
PY
)
  [ -n "${TID:-}" ] && echo "THREAD_ID=$TID"
fi

# The FINAL NONBLANK line must be the verdict — that is the contract the prompt
# sets ("End your reply with EXACTLY one line"). Accepting any earlier matching
# line lets quoted prose spoof an approval; accepting a later one lets trailing
# prose bury a real NOT DURABLE.
VER=$(awk 'NF{last=$0} END{print last}' "$OUT" 2>/dev/null | tr -d '\r' | tr '[:lower:]' '[:upper:]' | sed 's/  */ /g; s/^ *//; s/ *$//')
case "$VER" in
  "VERDICT: DURABLE")     echo "VERDICT=DURABLE" ;;
  "VERDICT: NOT DURABLE") echo "VERDICT=NOT_DURABLE" ;;
  *)                      echo "VERDICT=UNKNOWN" ;;
esac
echo "REVIEW_FILE=$OUT"
