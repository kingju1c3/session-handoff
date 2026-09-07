#!/bin/sh
# selftest.sh — prove the lease, the watchdog, and every hook behave as documented.
#
#   sh scripts/selftest.sh
#
# Exercises real files in a temp dir with a synthetic transcript. No network, no
# MCP calls, no spawning. Exit 0 = all assertions held.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
LEASE="$HERE/lease.sh"
WATCH="$HERE/watchdog.mjs"
HOOKS="$HERE/hooks.mjs"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
DIR="$TMP/.handoff"
SID="session_selftest"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
is()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi; }
has()  { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing '$3')";; esac; }
hasnt(){ case "$2" in *"$3"*) bad "$1 (unexpectedly contains '$3')";; *) ok "$1";; esac; }

# A transcript whose last assistant turn reports `1` argument: total resident tokens.
mk_transcript() {
  printf '{"type":"user","message":{"role":"user"}}\n' > "$TMP/t.jsonl"
  printf '{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":%s,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n' "$1" >> "$TMP/t.jsonl"
}

# The test must not inherit this machine's own compaction settings, or the
# derived thresholds under test would move with the environment running them.
CLEANENV="env -u CLAUDE_AUTOCOMPACT_PCT_OVERRIDE -u HANDOFF_COMPACTION_PCT -u HANDOFF_WINDOW_TOKENS -u CLAUDE_CODE_SESSION_ID"

phase() {  # phase <tokens> [env-assignments...]
  mk_transcript "$1"; shift
  $CLEANENV "$@" node "$WATCH" --dir "$DIR" --transcript "$TMP/t.jsonl" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["phase"])'
}

hook() {   # hook <event> <tokens> [extra-json] -> prints "exit:<code>|<stdout>|<stderr>"
  _ev="$1"; mk_transcript "$2"; _extra="${3:-}"
  _in=$(printf '{"hook_event_name":"%s","session_id":"x"%s}' "$_ev" "${_extra:+,$_extra}")
  _o=$(printf '%s' "$_in" | $CLEANENV HANDOFF_DIR="$DIR" HANDOFF_TRANSCRIPT="$TMP/t.jsonl" \
        node "$HOOKS" 2>"$TMP/err")
  printf 'exit:%s|%s|%s' "$?" "$_o" "$(cat "$TMP/err")"
}

echo "== lease: init, labels, generations, forks =="

CHAIN=$("$LEASE" init "$DIR" "$SID" 0 3 2)
[ -n "$CHAIN" ] && ok "init prints a chain id" || bad "init prints a chain id"
is "root label is 1.1" "$("$LEASE" label "$DIR")" "1.1"

"$LEASE" init "$DIR" "$SID" 0 3 2 >/dev/null 2>&1
is "second init refuses (lease exists)" "$?" "2"

"$LEASE" owns "$DIR" "$SID"; is "owner recognised" "$?" "0"
"$LEASE" owns "$DIR" "someone_else"; is "non-owner rejected" "$?" "1"

"$LEASE" state "$DIR" "someone_else" WINDING_DOWN >/dev/null 2>&1
is "non-owner cannot transition state" "$?" "1"
"$LEASE" state "$DIR" "$SID" NOT_A_STATE >/dev/null 2>&1
is "invalid state rejected" "$?" "2"

is "next-gen yields 2.1" "$("$LEASE" next-gen "$DIR" "$SID")" "2.1"
is "next-fork yields 2.2" "$("$LEASE" next-fork "$DIR" "$SID")" "2.2"
"$LEASE" next-fork "$DIR" "$SID" >/dev/null 2>&1
is "forkCap 2 blocks a third fork" "$?" "3"
is "label follows the fork" "$("$LEASE" label "$DIR")" "2.2"

# depth cap is 3: we are at generation 2, so one more is allowed, then it stops.
is "next-gen yields 3.1" "$("$LEASE" next-gen "$DIR" "$SID")" "3.1"
"$LEASE" next-gen "$DIR" "$SID" >/dev/null 2>&1
is "depth cap 3 blocks generation 4" "$?" "3"

"$LEASE" state "$DIR" "$SID" SPAWN_REQUESTED >/dev/null
"$LEASE" spawn-failed "$DIR" "$SID" >/dev/null
is "spawn-failed refunds the generation" "$("$LEASE" label "$DIR")" "2.2"
has "spawn-failed leaves state BLOCKED" "$("$LEASE" get "$DIR")" '"state": "BLOCKED"'

has "journal records every transition" "$("$LEASE" journal "$DIR")" '"event":"next-fork"'

echo "== watchdog: phase derivation =="

rm -rf "$DIR"
is "no lease -> NOLEASE (dormant)" "$(phase 900000)" "NOLEASE"
"$LEASE" init "$DIR" "$SID" 0 5 2 >/dev/null

# window 1,000,000 (claude-sonnet-5). compaction assumed 70 -> soft 55, hard 65.
is "40% -> DORMANT"                "$(phase 400000)" "DORMANT"
is "56% -> SOFT (assumed 70)"      "$(phase 560000)" "SOFT"
is "66% -> HARD (assumed 70)"      "$(phase 660000)" "HARD"
is "72% -> CEILING (assumed 70)"   "$(phase 720000)" "CEILING"

# platform reports 80 -> soft 65, hard 75. The same 66% is now merely SOFT.
is "66% with platform 80 -> SOFT"  "$(phase 660000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80)" "SOFT"
is "76% with platform 80 -> HARD"  "$(phase 760000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80)" "HARD"
# explicit config beats the platform, both directions.
is "66% with config 60 -> CEILING" "$(phase 660000 HANDOFF_COMPACTION_PCT=60 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80)" "CEILING"

"$LEASE" state "$DIR" "$SID" TRANSFERRED >/dev/null
is "TRANSFERRED -> DORMANT (not our chain any more)" "$(phase 900000)" "DORMANT"
"$LEASE" state "$DIR" "$SID" OWNED >/dev/null

echo "== hooks: PreCompact blocks, then fails open =="

R=$(hook PreCompact 400000 '"compaction_reason":"auto"')
has "auto compaction blocked (exit 2)" "$R" "exit:2"
has "block names the successor label" "$R" "2.1"
R=$(hook PreCompact 400000 '"compaction_reason":"auto"')
has "second block still granted" "$R" "exit:2"
R=$(hook PreCompact 400000 '"compaction_reason":"auto"')
has "third attempt fails open (exit 0)" "$R" "exit:0"
has "and instructs the summariser instead" "$R" "PRESERVE THROUGH THIS SUMMARY"

rm -f "$DIR/.enforce-state.json"
R=$(hook PreCompact 400000 '"compaction_reason":"manual"')
has "manual /compact is never blocked" "$R" "exit:0"
has "manual compaction still injects context" "$R" "Manual compaction"

echo "== hooks: Stop holds a mid-flight handoff =="

rm -f "$DIR/.enforce-state.json"
R=$(hook Stop 100000)
has "Stop at OWNED + low context is silent" "$R" "exit:0"
hasnt "and emits nothing" "$R" "STOP BLOCKED"

"$LEASE" state "$DIR" "$SID" DOC_WRITTEN >/dev/null
R=$(hook Stop 100000)
has "Stop mid-handoff is blocked" "$R" "exit:2"
has "block explains the lease state" "$R" "DOC_WRITTEN"
R=$(hook Stop 100000); R=$(hook Stop 100000)
has "Stop block budget is bounded" "$R" "exit:0"

rm -f "$DIR/.enforce-state.json"
"$LEASE" state "$DIR" "$SID" BLOCKED >/dev/null
R=$(hook Stop 900000)
has "BLOCKED releases the Stop hook" "$R" "exit:0"
"$LEASE" state "$DIR" "$SID" OWNED >/dev/null

echo "== hooks: advisory + dormancy =="

rm -f "$DIR/.enforce-state.json"
R=$(hook PostToolUse 100000)
hasnt "below soft trigger: no advisory" "$R" "session-handoff"
R=$(hook PostToolUse 560000)
has "at soft trigger: advisory injected" "$R" "SOFT TRIGGER"
R=$(hook PostToolUse 560000)
hasnt "repeat of same phase is debounced" "$R" "SOFT TRIGGER"
R=$(hook PostToolUse 660000)
has "escalation always gets through" "$R" "HARD DEADLINE"

R=$(hook SessionStart 100000)
has "SessionStart re-orients a fresh context" "$R" "THE ONE RULE"

rm -rf "$DIR"
R=$(hook PreCompact 990000 '"compaction_reason":"auto"')
has "unarmed: PreCompact does not block" "$R" "exit:0"
hasnt "unarmed: PreCompact says nothing" "$R" "session-handoff"
R=$(hook PostToolUse 990000)
hasnt "unarmed: advisory stays silent" "$R" "session-handoff"

echo
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
