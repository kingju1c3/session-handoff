#!/bin/sh
# terminal-handoff — selftest for the fixes in this batch (F1-F16).
#
# Exercises lease.sh, the review-handoff.sh round-numbering (F1) and verdict-parsing (F2)
# logic (replicated verbatim — this test never launches codex), and context-check.mjs's
# sidechain filtering (F11), all inside a throwaway mktemp -d sandbox. Never launches
# claude, codex, or osascript/Terminal.
#
# Usage: scripts/selftest.sh
# Exit: 0 all cases passed · 1 at least one case failed.

SELFDIR=$(cd "$(dirname "$0")" && pwd)
LEASE="$SELFDIR/lease.sh"
CTXCHECK="$SELFDIR/context-check.mjs"

SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/th-selftest.XXXXXX")
cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT INT TERM

FAILS=0
TOTAL=0

pass() { TOTAL=$((TOTAL+1)); echo "PASS: $1"; }
fail() { TOTAL=$((TOTAL+1)); FAILS=$((FAILS+1)); echo "FAIL: $1 -- $2"; }

expect_rc() {
  # expect_rc <label> <expected-rc> <actual-rc> [extra-context]
  _label="$1"; _exp="$2"; _act="$3"; _ctx="${4:-}"
  if [ "$_act" -eq "$_exp" ]; then
    pass "$_label (rc=$_act)"
  else
    fail "$_label" "expected rc=$_exp got rc=$_act $_ctx"
  fi
}

expect_eq() {
  # expect_eq <label> <expected> <actual>
  _label="$1"; _exp="$2"; _act="$3"
  if [ "$_act" = "$_exp" ]; then
    pass "$_label (=$_act)"
  else
    fail "$_label" "expected '$_exp' got '$_act'"
  fi
}

dead_pid() {
  # Spawn a process that exits immediately, wait for it to be reaped, echo its pid.
  # After `wait`, kill -0 on this pid reliably fails (not alive, not a zombie).
  sh -c 'exit 0' &
  _dp=$!
  wait "$_dp" 2>/dev/null
  echo "$_dp"
}

echo "== terminal-handoff selftest =="
echo "sandbox: $SANDBOX"
echo ""

# ---------------------------------------------------------------------------
# Case 1: lease init -> get -> owns (owner=0, stranger=1)
# ---------------------------------------------------------------------------
DIR1="$SANDBOX/case1"
CHAIN1=$("$LEASE" init "$DIR1" owner-sid-1 "$$" 5 2>"$SANDBOX/case1-init.err")
RC=$?
if [ "$RC" -eq 0 ] && [ -n "$CHAIN1" ]; then
  pass "case1: init succeeds and prints a chain id"
else
  fail "case1: init succeeds and prints a chain id" "rc=$RC chain='$CHAIN1'"
fi

"$LEASE" get "$DIR1" >/dev/null 2>&1
expect_rc "case1: get on initialized dir" 0 $?

"$LEASE" owns "$DIR1" owner-sid-1 >/dev/null 2>&1
expect_rc "case1: owns — actual owner" 0 $?

"$LEASE" owns "$DIR1" stranger-sid >/dev/null 2>&1
expect_rc "case1: owns — stranger" 1 $?

# ---------------------------------------------------------------------------
# Case 2: state transition by non-owner fails (exit 1); by owner succeeds
# ---------------------------------------------------------------------------
"$LEASE" state "$DIR1" stranger-sid WINDING_DOWN >/dev/null 2>&1
expect_rc "case2: state by non-owner" 1 $?

"$LEASE" state "$DIR1" owner-sid-1 WINDING_DOWN >/dev/null 2>&1
expect_rc "case2: state by owner" 0 $?

# ---------------------------------------------------------------------------
# Case 3: missing-lease — `state` on an empty dir exits 2, no python traceback
# ---------------------------------------------------------------------------
DIR3="$SANDBOX/case3"
mkdir -p "$DIR3"
OUT3=$("$LEASE" state "$DIR3" some-sid OWNED 2>&1)
RC3=$?
expect_rc "case3: state on empty dir" 2 "$RC3"
case "$OUT3" in
  *Traceback*) fail "case3: no python traceback" "output contained 'Traceback': $OUT3" ;;
  *"no lease at"*) pass "case3: clean 'no lease at' message" ;;
  *) fail "case3: clean 'no lease at' message" "unexpected output: $OUT3" ;;
esac

# ---------------------------------------------------------------------------
# Case 4: live-lock hold — F5 regression test. Lock held (mkdir + live pid=$$),
# backdated >30s. A `state` call must FAIL with exit 4 (never stolen from a live
# holder). This case waits out the full lock-retry ceiling (~10s) by design.
# ---------------------------------------------------------------------------
DIR4="$SANDBOX/case4"
"$LEASE" init "$DIR4" owner-sid-4 "$$" 5 >/dev/null 2>&1
mkdir "$DIR4/.lock"
echo "$$" > "$DIR4/.lock/pid"
touch -t "$(date -v-40S +%Y%m%d%H%M.%S)" "$DIR4/.lock" 2>/dev/null || touch -d '-40 seconds' "$DIR4/.lock" 2>/dev/null
"$LEASE" state "$DIR4" owner-sid-4 WINDING_DOWN >/dev/null 2>&1
expect_rc "case4: live lock (backdated >30s) is NOT stolen" 4 $?
rm -rf "$DIR4/.lock" 2>/dev/null

# ---------------------------------------------------------------------------
# Case 5: dead-lock steal — same setup, but the recorded holder pid is dead.
# The operation must succeed (stale lock broken immediately).
# ---------------------------------------------------------------------------
DIR5="$SANDBOX/case5"
"$LEASE" init "$DIR5" owner-sid-5 "$$" 5 >/dev/null 2>&1
DP5=$(dead_pid)
mkdir "$DIR5/.lock"
echo "$DP5" > "$DIR5/.lock/pid"
touch -t "$(date -v-40S +%Y%m%d%H%M.%S)" "$DIR5/.lock" 2>/dev/null || touch -d '-40 seconds' "$DIR5/.lock" 2>/dev/null
"$LEASE" state "$DIR5" owner-sid-5 WINDING_DOWN >/dev/null 2>&1
expect_rc "case5: dead-holder lock is stolen" 0 $?

# ---------------------------------------------------------------------------
# Case 6: next-gen increments; spawn-failed refunds + sets BLOCKED; next-gen
# again reaches cap -> exit 3
# ---------------------------------------------------------------------------
DIR6="$SANDBOX/case6"
"$LEASE" init "$DIR6" owner-sid-6 "$$" 2 >/dev/null 2>&1
G1=$("$LEASE" next-gen "$DIR6" owner-sid-6 2>/dev/null)
expect_eq "case6: next-gen 1->2" "2" "$G1"

"$LEASE" state "$DIR6" owner-sid-6 SPAWN_REQUESTED >/dev/null 2>&1

"$LEASE" spawn-failed "$DIR6" owner-sid-6 >/dev/null 2>&1
expect_rc "case6: spawn-failed refunds" 0 $?

LEASE6=$("$LEASE" get "$DIR6" 2>/dev/null)
case "$LEASE6" in
  *'"generation": 1'*) pass "case6: generation refunded to 1" ;;
  *) fail "case6: generation refunded to 1" "lease: $LEASE6" ;;
esac
case "$LEASE6" in
  *'"state": "BLOCKED"'*) pass "case6: state set to BLOCKED" ;;
  *) fail "case6: state set to BLOCKED" "lease: $LEASE6" ;;
esac

G2=$("$LEASE" next-gen "$DIR6" owner-sid-6 2>/dev/null)
expect_eq "case6: next-gen reuses refunded generation" "2" "$G2"

"$LEASE" next-gen "$DIR6" owner-sid-6 >/dev/null 2>&1
expect_rc "case6: next-gen hits cap" 3 $?

# spawn-failed outside SPAWN_REQUESTED must refuse — the refund is only legal
# for a spawn that was actually requested (SKILL.md step 6 marks the state
# BEFORE running the launcher for exactly this reason).
DIR6B="$SANDBOX/case6b"
"$LEASE" init "$DIR6B" owner-sid-6b "$$" 5 >/dev/null 2>&1
"$LEASE" spawn-failed "$DIR6B" owner-sid-6b >/dev/null 2>&1
expect_rc "case6: spawn-failed refused outside SPAWN_REQUESTED" 1 $?

# ---------------------------------------------------------------------------
# Case 7: recover — transfer to a fake sid with a dead pid, then recover as a
# new sid succeeds. recover while owner pid is alive ($$) refuses (exit 1).
# ---------------------------------------------------------------------------
DIR7="$SANDBOX/case7"
"$LEASE" init "$DIR7" owner-sid-7a "$$" 5 >/dev/null 2>&1
DP7=$(dead_pid)
"$LEASE" transfer "$DIR7" owner-sid-7a fake-sid-7 "$DP7" >/dev/null 2>&1
expect_rc "case7: transfer to fake sid (dead pid)" 0 $?

"$LEASE" recover "$DIR7" owner-sid-7b "$$" >/dev/null 2>&1
expect_rc "case7: recover succeeds (old owner pid dead)" 0 $?

OWNS7=$("$LEASE" owns "$DIR7" owner-sid-7b >/dev/null 2>&1; echo $?)
expect_eq "case7: new owner after recover is owner-sid-7b" "0" "$OWNS7"

OUT7=$("$LEASE" recover "$DIR7" owner-sid-7c "$$" 2>&1)
RC7=$?
expect_rc "case7: recover refuses when current owner pid is alive" 1 "$RC7"
case "$OUT7" in
  *"still alive"*) pass "case7: refusal message names the live owner" ;;
  *) fail "case7: refusal message names the live owner" "output: $OUT7" ;;
esac

# ---------------------------------------------------------------------------
# Case 8: review round numbering — F1's N computation, replicated verbatim
# ---------------------------------------------------------------------------
compute_n() {
  # replicates review-handoff.sh's round computation verbatim against $1
  ARTDIR="$1"
  _max=$(find "$ARTDIR" -maxdepth 1 \( -name 'review-*.md' -o -name 'review-*.jsonl' \) 2>/dev/null \
    | sed -nE 's/.*review-([0-9]+)\.(md|jsonl)$/\1/p' | sort -n | tail -1 | awk '{print $0+0}')
  echo $(( ${_max:-0} + 1 ))
}

ART8E="$SANDBOX/case8-empty"
mkdir -p "$ART8E"
expect_eq "case8: N on empty artifact dir" "1" "$(compute_n "$ART8E")"

ART8F="$SANDBOX/case8-full"
mkdir -p "$ART8F"
: > "$ART8F/review-1.md"
: > "$ART8F/review-1.jsonl"
expect_eq "case8: N with review-1.md + review-1.jsonl present" "2" "$(compute_n "$ART8F")"

# A timed-out round leaves an orphan .jsonl with no .md — its index must be
# skipped, not reused (reuse would truncate the stream a postmortem needs).
: > "$ART8F/review-2.jsonl"
expect_eq "case8: orphan review-2.jsonl bumps N to 3" "3" "$(compute_n "$ART8F")"

# A human-renamed zero-padded index must not crash sh arithmetic as octal.
ART8Z="$SANDBOX/case8-zeropad"
mkdir -p "$ART8Z"
: > "$ART8Z/review-08.md"
expect_eq "case8: zero-padded review-08.md yields N=9, not an octal error" "9" "$(compute_n "$ART8Z")"

# ---------------------------------------------------------------------------
# Case 9: verdict parsing — F2's parsing block, replicated verbatim
# ---------------------------------------------------------------------------
parse_verdict() {
  # replicates review-handoff.sh's verdict block verbatim against $1:
  # the FINAL NONBLANK line must be the verdict.
  OUT="$1"
  VER=$(awk 'NF{last=$0} END{print last}' "$OUT" 2>/dev/null | tr -d '\r' | tr '[:lower:]' '[:upper:]' | sed 's/  */ /g; s/^ *//; s/ *$//')
  case "$VER" in
    "VERDICT: DURABLE")     echo "VERDICT=DURABLE" ;;
    "VERDICT: NOT DURABLE") echo "VERDICT=NOT_DURABLE" ;;
    *)                      echo "VERDICT=UNKNOWN" ;;
  esac
}

OUT9A="$SANDBOX/out9a.md"
cat > "$OUT9A" <<'EOF'
Some preamble analysis follows.
VERDICT: DURABLE
(that line above is only an example of the required format from the prompt)
More critique text here.
VERDICT: NOT DURABLE
EOF
R9A=$(parse_verdict "$OUT9A")
expect_eq "case9: early DURABLE + final NOT DURABLE -> NOT_DURABLE" "VERDICT=NOT_DURABLE" "$R9A"

OUT9B="$SANDBOX/out9b.md"
cat > "$OUT9B" <<'EOF'
Everything checked out.
VERDICT: DURABLE
EOF
R9B=$(parse_verdict "$OUT9B")
expect_eq "case9: final DURABLE -> DURABLE" "VERDICT=DURABLE" "$R9B"

OUT9C="$SANDBOX/out9c.md"
cat > "$OUT9C" <<'EOF'
The reviewer never emitted a verdict line at all.
EOF
R9C=$(parse_verdict "$OUT9C")
expect_eq "case9: no verdict line -> UNKNOWN" "VERDICT=UNKNOWN" "$R9C"

# Trailing prose after the verdict violates the exactly-one-final-line contract
# and must NOT count as approval.
OUT9D="$SANDBOX/out9d.md"
cat > "$OUT9D" <<'EOF'
Critique here.
VERDICT: DURABLE
P.S. one more thought after the verdict line.
EOF
R9D=$(parse_verdict "$OUT9D")
expect_eq "case9: trailing prose after verdict -> UNKNOWN" "VERDICT=UNKNOWN" "$R9D"

# ---------------------------------------------------------------------------
# Case 10: context-check sidechain filtering (F11)
# ---------------------------------------------------------------------------
T10="$SANDBOX/fake-transcript.jsonl"
cat > "$T10" <<'EOF'
{"type":"assistant","isSidechain":false,"message":{"model":"claude-sonnet-5","usage":{"input_tokens":1000,"cache_read_input_tokens":2000,"cache_creation_input_tokens":500}}}
{"type":"assistant","isSidechain":true,"message":{"model":"claude-sonnet-5","usage":{"input_tokens":9999,"cache_read_input_tokens":9999,"cache_creation_input_tokens":9999}}}
EOF
JSON10=$(node "$CTXCHECK" --transcript "$T10" --json 2>/dev/null)
RC10=$?
if [ "$RC10" -eq 0 ]; then
  case "$JSON10" in
    *'"contextTokens": 3500'*) pass "case10: sidechain row skipped, main-chain numbers used" ;;
    *) fail "case10: sidechain row skipped, main-chain numbers used" "json: $JSON10" ;;
  esac
else
  fail "case10: context-check.mjs ran successfully" "rc=$RC10 output: $JSON10"
fi

# ---------------------------------------------------------------------------
# Case 11: recover fails CLOSED — a lease dir path containing a single quote
# must not break the owner-liveness read (regression: $DIR was interpolated
# into python source; the read failed open and a LIVE owner could be stolen).
# ---------------------------------------------------------------------------
DIR11="$SANDBOX/o'brien dir/case11"
"$LEASE" init "$DIR11" owner-sid-11 "$$" 5 >/dev/null 2>&1
expect_rc "case11: init in apostrophe-bearing path" 0 $?

OUT11=$("$LEASE" recover "$DIR11" thief-sid-11 "$$" 2>&1)
RC11=$?
expect_rc "case11: recover refuses — live owner readable despite apostrophe path" 1 "$RC11"
case "$OUT11" in
  *"still alive"*) pass "case11: refusal names the live owner (read succeeded)" ;;
  *) fail "case11: refusal names the live owner (read succeeded)" "output: $OUT11" ;;
esac

DIR11B="$SANDBOX/case11-corrupt"
"$LEASE" init "$DIR11B" owner-sid-11b "$$" 5 >/dev/null 2>&1
printf 'not json' > "$DIR11B/LEASE.json"
"$LEASE" recover "$DIR11B" thief-sid-11b "$$" >/dev/null 2>&1
expect_rc "case11: unreadable lease aborts recover (fail closed)" 2 $?

# ---------------------------------------------------------------------------
# Case 12: an EMPTY .lock/pid file must behave like a missing pid file — the
# age check applies, so a backdated empty-pid lock is stolen instead of
# holding the lease hostage forever.
# ---------------------------------------------------------------------------
DIR12="$SANDBOX/case12"
"$LEASE" init "$DIR12" owner-sid-12 "$$" 5 >/dev/null 2>&1
mkdir "$DIR12/.lock"
: > "$DIR12/.lock/pid"
touch -t "$(date -v-40S +%Y%m%d%H%M.%S)" "$DIR12/.lock" 2>/dev/null || touch -d '-40 seconds' "$DIR12/.lock" 2>/dev/null
"$LEASE" state "$DIR12" owner-sid-12 WINDING_DOWN >/dev/null 2>&1
expect_rc "case12: backdated empty-pid lock is stolen (not held forever)" 0 $?

# ---------------------------------------------------------------------------
echo ""
echo "== $((TOTAL-FAILS))/$TOTAL passed =="
if [ "$FAILS" -gt 0 ]; then
  echo "SELFTEST: FAIL ($FAILS failing case(s))"
  exit 1
fi
echo "SELFTEST: PASS"
exit 0
