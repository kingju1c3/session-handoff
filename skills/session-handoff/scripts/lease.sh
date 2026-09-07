#!/bin/sh
# session-handoff — ownership lease + append-only journal.
#
# Shared, unmodified logic with terminal-handoff's lease.sh: this file has
# zero platform dependency (pure POSIX sh + python3, mkdir-based locking),
# so it is copied rather than referenced across both handoff skills.
#
# The lease is what makes a handoff an ownership TRANSFER rather than a
# polite suggestion. Exactly one session owns the mission at a time; every
# other session must refuse to do mission work. It lives on disk so it
# survives a crash.
#
# LIVENESS DIFFERS FROM terminal-handoff'S VERSION: that one checks a local
# PID with `kill -0`. A Claude Code Remote session has no local PID to
# check — its liveness is a server fact (session_status/connection_status
# from the get_session tool), which only the calling MODEL can query (a
# shell script cannot call an MCP tool). So `recover` here does NOT try to
# determine liveness itself the way the PID-based version does: the model
# must call get_session on the recorded owner FIRST and only invoke
# `recover` once it has confirmed, from that tool result, that the owner
# is not RUNNING/connected. `ownerPid` is still recorded (best-effort,
# often 0 for a remote session) for audit/debugging, not as the liveness
# check.
#
# SESSION LABELS: every session in a chain has a label "<generation>.<fork>".
# The root is 1.1. Its successor is 2.1, then 3.1 — generation is depth down
# the chain. A second, parallel successor spawned at the same depth is 2.2,
# then 2.3 — fork is width. So a chain that hands off twice and forks once
# reads 1.1 -> 2.1 -> 2.2 (parallel sibling) -> 3.1. Depth is capped by `cap`
# (default 5) and width by `forkCap` (default 2), because forks multiply live
# sessions and therefore cost.
#
# Usage:
#   lease.sh init      <dir> <session-id> <pid> [cap] [forkCap]
#                                                       -> prints chainId; creates 1.1
#   lease.sh get       <dir>                            -> prints LEASE.json
#   lease.sh label     <dir>                            -> prints current label, e.g. 2.1
#   lease.sh owns      <dir> <session-id>               -> exit 0 owner, 1 not owner, 2 no lease
#   lease.sh state     <dir> <session-id> <STATE>       -> transition state (owner only)
#   lease.sh next-gen  <dir> <session-id>               -> claim next generation atomically
#                                                          prints label (e.g. 2.1)
#                                                          exit 3 if depth cap reached
#   lease.sh next-fork <dir> <session-id>               -> claim a parallel sibling at the
#                                                          current generation; prints label
#                                                          (e.g. 2.2); exit 3 if forkCap hit
#   lease.sh transfer  <dir> <session-id> <new-sid> <new-pid>  -> hand ownership over
#   lease.sh release   <dir> <session-id>               -> mark released, own nothing
#   lease.sh recover   <dir> <session-id> <pid>         -> take over a lease whose owner is
#                                                          confirmed dead (see LIVENESS note above —
#                                                          this script no longer verifies that itself)
#   lease.sh spawn-failed <dir> <session-id>            -> refund a generation after a failed
#                                                          spawn (state must be SPAWN_REQUESTED)
#   lease.sh journal   <dir>                            -> print JOURNAL.jsonl
#
# Exit codes: 0 ok · 1 not owner · 2 no lease / bad args · 3 generation cap reached
#             4 could not acquire lock
set -eu

STALE_SECS=30
# The lock is held for milliseconds (one python read-modify-write), so poll finely.
# Coarse polling starves contending claimants and refuses work that should have
# succeeded. 100 tries x 0.1s = 10s ceiling, then fail closed.
LOCK_TRIES=100
LOCK_SLEEP=0.1

die() { echo "lease.sh: $1" >&2; exit "${2:-2}"; }

lock_acquire() {
  _lock="$1/.lock"
  _i=0
  while [ "$_i" -lt "$LOCK_TRIES" ]; do
    if mkdir "$_lock" 2>/dev/null; then
      echo $$ > "$_lock/pid"
      return 0
    fi
    _holder=""
    if [ -f "$_lock/pid" ]; then
      _holder=$(cat "$_lock/pid" 2>/dev/null || echo "")
    fi
    if [ -n "$_holder" ]; then
      # A nonempty pid exists: trust it completely. Never age-steal from a
      # holder that is still alive — that is a lost update, not a stale lock.
      if ! kill -0 "$_holder" 2>/dev/null; then
        rm -rf "$_lock" 2>/dev/null || true
        if [ -d "$_lock" ]; then
          # rm failed (e.g. raced another claimant) — don't spin forever on it.
          sleep "$LOCK_SLEEP"
          _i=$((_i+1))
        fi
        continue
      fi
      # Holder pid present and alive: do NOT age-steal. Just keep polling.
      sleep "$LOCK_SLEEP"
      _i=$((_i+1))
      continue
    fi
    # No usable pid (no file, empty, or unreadable): mkdir happened but the
    # writer died before the pid landed. Only here does the age check apply —
    # an empty pid file must not hold the lock forever.
    _age=$(python3 - "$_lock" <<'PY' 2>/dev/null || echo 0
import os,sys,time
try: print(int(time.time()-os.path.getmtime(sys.argv[1])))
except Exception: print(0)
PY
)
    if [ "${_age:-0}" -gt "$STALE_SECS" ]; then
      rm -rf "$_lock" 2>/dev/null || true
      if [ -d "$_lock" ]; then
        sleep "$LOCK_SLEEP"
        _i=$((_i+1))
      fi
      continue
    fi
    sleep "$LOCK_SLEEP"
    _i=$((_i+1))
  done
  die "could not acquire lock at $_lock" 4
}

lock_release() { rm -rf "$1/.lock" 2>/dev/null || true; }

journal() {
  # append-only; one JSON object per line
  printf '%s\n' "$2" >> "$1/JOURNAL.jsonl"
}

DIR="${2:-}"
[ -n "$DIR" ] || die "missing <dir>"

case "${1:-}" in

  init)
    SID="${3:-}"; PID="${4:-}"; CAP="${5:-5}"; FORKCAP="${6:-2}"
    [ -n "$SID" ] && [ -n "$PID" ] || die "usage: init <dir> <session-id> <pid> [cap] [forkCap]"
    mkdir -p "$DIR"
    lock_acquire "$DIR"
    trap 'lock_release "$DIR"' EXIT
    if [ -f "$DIR/LEASE.json" ]; then
      lock_release "$DIR"; trap - EXIT
      die "lease already exists — use 'get' or 'recover'"
    fi
    # python3 uuid4, not uuidgen: uuidgen ships with macOS but is not
    # guaranteed present on every Linux/container image this skill targets
    # (confirmed missing in this session's own sandbox) — python3 is
    # already a hard dependency of this script, so this adds nothing new.
    CHAIN=$(python3 -c 'import uuid; print(uuid.uuid4())')
    python3 - "$DIR/LEASE.json" "$CHAIN" "$SID" "$PID" "$CAP" "$FORKCAP" <<'PY'
import json,sys,time
p,chain,sid,pid,cap,forkcap = sys.argv[1:7]
# label = "<generation>.<fork>". The root session is 1.1; its successor is 2.1;
# a second parallel successor at that same depth is 2.2. Depth is the chain,
# the second number is the branch.
d = {"chainId":chain,"generation":1,"fork":1,"label":"1.1",
     "cap":int(cap),"forkCap":int(forkcap),"ownerSessionId":sid,
     "ownerPid":int(pid),"state":"OWNED","lineage":["1.1"],
     "updatedAt":int(time.time())}
tmp = p + ".tmp"
open(tmp,"w").write(json.dumps(d,indent=2))
import os; os.replace(tmp,p)          # atomic
PY
    journal "$DIR" "{\"ts\":$(date +%s),\"event\":\"init\",\"chainId\":\"$CHAIN\",\"generation\":1,\"fork\":1,\"label\":\"1.1\",\"sessionId\":\"$SID\",\"pid\":$PID,\"cap\":$CAP,\"forkCap\":$FORKCAP}"
    echo "$CHAIN"
    ;;

  get)
    [ -f "$DIR/LEASE.json" ] || die "no lease at $DIR" 2
    cat "$DIR/LEASE.json"
    ;;

  owns)
    SID="${3:-}"
    [ -f "$DIR/LEASE.json" ] || exit 2
    python3 - "$DIR/LEASE.json" "$SID" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
sys.exit(0 if d.get("ownerSessionId")==sys.argv[2] else 1)
PY
    ;;

  state)
    SID="${3:-}"; NEW="${4:-}"
    [ -n "$SID" ] && [ -n "$NEW" ] || die "usage: state <dir> <session-id> <STATE>"
    lock_acquire "$DIR"; trap 'lock_release "$DIR"' EXIT
    [ -f "$DIR/LEASE.json" ] || { lock_release "$DIR"; trap - EXIT; die "no lease at $DIR" 2; }
    python3 - "$DIR/LEASE.json" "$SID" "$NEW" <<'PY'
import json,sys,os,time
p,sid,new = sys.argv[1:4]
d=json.load(open(p))
if d.get("ownerSessionId")!=sid:
    print("not owner: lease is held by %s" % d.get("ownerSessionId"), file=sys.stderr); sys.exit(1)
valid={"OWNED","WINDING_DOWN","DOC_WRITTEN","REVIEWED","SPAWN_REQUESTED","ATTESTED","TRANSFERRED","BLOCKED","RELEASED"}
if new not in valid:
    print("invalid state %r" % new, file=sys.stderr); sys.exit(2)
d["state"]=new; d["updatedAt"]=int(time.time())
tmp=p+".tmp"; open(tmp,"w").write(json.dumps(d,indent=2)); os.replace(tmp,p)
PY
    journal "$DIR" "{\"ts\":$(date +%s),\"event\":\"state\",\"state\":\"$NEW\",\"sessionId\":\"$SID\"}"
    ;;

  next-gen)
    SID="${3:-}"
    [ -n "$SID" ] || die "usage: next-gen <dir> <session-id>"
    lock_acquire "$DIR"; trap 'lock_release "$DIR"' EXIT
    [ -f "$DIR/LEASE.json" ] || { lock_release "$DIR"; trap - EXIT; die "no lease at $DIR" 2; }
    # Read-modify-write inside the lock: two concurrent ticks cannot both claim n+1.
    LABEL=$(python3 - "$DIR/LEASE.json" "$SID" <<'PY'
import json,sys,os,time
p,sid = sys.argv[1:3]
d=json.load(open(p))
if d.get("ownerSessionId")!=sid:
    print("not owner", file=sys.stderr); sys.exit(1)
nxt = d["generation"] + 1
if nxt > d.get("cap",5):
    print("cap", file=sys.stderr); sys.exit(3)
# A new generation always starts at fork 1 — the main line. Parallel siblings
# at the same depth are claimed afterwards with `next-fork`.
d["generation"]=nxt; d["fork"]=1
d["label"]="%d.1" % nxt
d.setdefault("lineage",[]).append(d["label"])
d["updatedAt"]=int(time.time())
tmp=p+".tmp"; open(tmp,"w").write(json.dumps(d,indent=2)); os.replace(tmp,p)
print(d["label"])
PY
) || { rc=$?; lock_release "$DIR"; trap - EXIT; exit $rc; }
    journal "$DIR" "{\"ts\":$(date +%s),\"event\":\"next-gen\",\"label\":\"$LABEL\",\"sessionId\":\"$SID\"}"
    echo "$LABEL"
    ;;

  next-fork)
    SID="${3:-}"
    [ -n "$SID" ] || die "usage: next-fork <dir> <session-id>"
    lock_acquire "$DIR"; trap 'lock_release "$DIR"' EXIT
    [ -f "$DIR/LEASE.json" ] || { lock_release "$DIR"; trap - EXIT; die "no lease at $DIR" 2; }
    LABEL=$(python3 - "$DIR/LEASE.json" "$SID" <<'PY'
import json,sys,os,time
p,sid = sys.argv[1:3]
d=json.load(open(p))
if d.get("ownerSessionId")!=sid:
    print("not owner", file=sys.stderr); sys.exit(1)
nxt = d.get("fork",1) + 1
# Forks multiply cost in a way generations do not: N forks means N live
# sessions, not one after another. The width cap is the brake.
if nxt > d.get("forkCap",2):
    print("forkcap", file=sys.stderr); sys.exit(3)
d["fork"]=nxt
d["label"]="%d.%d" % (d["generation"], nxt)
d.setdefault("lineage",[]).append(d["label"])
d["updatedAt"]=int(time.time())
tmp=p+".tmp"; open(tmp,"w").write(json.dumps(d,indent=2)); os.replace(tmp,p)
print(d["label"])
PY
) || { rc=$?; lock_release "$DIR"; trap - EXIT; exit $rc; }
    journal "$DIR" "{\"ts\":$(date +%s),\"event\":\"next-fork\",\"label\":\"$LABEL\",\"sessionId\":\"$SID\"}"
    echo "$LABEL"
    ;;

  label)
    [ -f "$DIR/LEASE.json" ] || die "no lease at $DIR" 2
    python3 - "$DIR/LEASE.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
print(d.get("label") or "%s.%s" % (d.get("generation","?"), d.get("fork",1)))
PY
    ;;

  transfer)
    SID="${3:-}"; NSID="${4:-}"; NPID="${5:-}"
    [ -n "$SID" ] && [ -n "$NSID" ] && [ -n "$NPID" ] || die "usage: transfer <dir> <sid> <new-sid> <new-pid>"
    lock_acquire "$DIR"; trap 'lock_release "$DIR"' EXIT
    [ -f "$DIR/LEASE.json" ] || { lock_release "$DIR"; trap - EXIT; die "no lease at $DIR" 2; }
    python3 - "$DIR/LEASE.json" "$SID" "$NSID" "$NPID" <<'PY'
import json,sys,os,time
p,sid,nsid,npid = sys.argv[1:5]
d=json.load(open(p))
if d.get("ownerSessionId")!=sid:
    print("not owner", file=sys.stderr); sys.exit(1)
d["ownerSessionId"]=nsid; d["ownerPid"]=int(npid)
d["state"]="TRANSFERRED"; d["updatedAt"]=int(time.time())
tmp=p+".tmp"; open(tmp,"w").write(json.dumps(d,indent=2)); os.replace(tmp,p)
PY
    journal "$DIR" "{\"ts\":$(date +%s),\"event\":\"transfer\",\"from\":\"$SID\",\"to\":\"$NSID\",\"toPid\":$NPID}"
    ;;

  release)
    SID="${3:-}"
    lock_acquire "$DIR"; trap 'lock_release "$DIR"' EXIT
    [ -f "$DIR/LEASE.json" ] || { lock_release "$DIR"; trap - EXIT; die "no lease at $DIR" 2; }
    python3 - "$DIR/LEASE.json" "$SID" <<'PY'
import json,sys,os,time
p,sid = sys.argv[1:3]
d=json.load(open(p))
if d.get("ownerSessionId")!=sid:
    print("not owner", file=sys.stderr); sys.exit(1)
d["state"]="RELEASED"; d["ownerSessionId"]=None; d["updatedAt"]=int(time.time())
tmp=p+".tmp"; open(tmp,"w").write(json.dumps(d,indent=2)); os.replace(tmp,p)
PY
    journal "$DIR" "{\"ts\":$(date +%s),\"event\":\"release\",\"sessionId\":\"$SID\"}"
    ;;

  recover)
    NSID="${3:-}"; NPID="${4:-}"
    [ -n "$NSID" ] && [ -n "$NPID" ] || die "usage: recover <dir> <session-id> <pid>"
    lock_acquire "$DIR"; trap 'lock_release "$DIR"' EXIT
    [ -f "$DIR/LEASE.json" ] || { lock_release "$DIR"; trap - EXIT; die "no lease at $DIR" 2; }
    # No liveness check here — see LIVENESS note in the file header. The
    # caller (the model, via get_session) has already established the
    # recorded owner is not running before invoking this.
    python3 - "$DIR/LEASE.json" "$NSID" "$NPID" <<'PY'
import json,sys,os,time
p,nsid,npid = sys.argv[1:4]
d=json.load(open(p))
old=d.get("ownerSessionId")
d["ownerSessionId"]=nsid; d["ownerPid"]=int(npid)
d["state"]="OWNED"; d["updatedAt"]=int(time.time())
tmp=p+".tmp"; open(tmp,"w").write(json.dumps(d,indent=2)); os.replace(tmp,p)
print(old or "", file=sys.stderr)
PY
    journal "$DIR" "{\"ts\":$(date +%s),\"event\":\"recover\",\"to\":\"$NSID\"}"
    ;;

  spawn-failed)
    SID="${3:-}"
    [ -n "$SID" ] || die "usage: spawn-failed <dir> <session-id>"
    lock_acquire "$DIR"; trap 'lock_release "$DIR"' EXIT
    [ -f "$DIR/LEASE.json" ] || { lock_release "$DIR"; trap - EXIT; die "no lease at $DIR" 2; }
    python3 - "$DIR/LEASE.json" "$SID" <<'PY'
import json,sys,os,time
p,sid = sys.argv[1:3]
d=json.load(open(p))
if d.get("ownerSessionId")!=sid:
    print("not owner", file=sys.stderr); sys.exit(1)
if d.get("state")!="SPAWN_REQUESTED":
    print("not in SPAWN_REQUESTED state: %r" % d.get("state"), file=sys.stderr); sys.exit(1)
# Refund the claim by rewinding to the previous entry in the lineage — which
# restores the right label whether a generation or a fork was claimed.
if d.get("lineage"): d["lineage"].pop()
prev = d["lineage"][-1] if d.get("lineage") else "1.1"
g,_,f = prev.partition(".")
d["generation"]=int(g); d["fork"]=int(f or 1); d["label"]=prev
d["state"]="BLOCKED"; d["updatedAt"]=int(time.time())
tmp=p+".tmp"; open(tmp,"w").write(json.dumps(d,indent=2)); os.replace(tmp,p)
PY
    journal "$DIR" "{\"ts\":$(date +%s),\"event\":\"spawn-failed\",\"sessionId\":\"$SID\"}"
    ;;

  journal)
    [ -f "$DIR/JOURNAL.jsonl" ] && cat "$DIR/JOURNAL.jsonl" || echo "(no journal)"
    ;;

  *)
    die "unknown command '${1:-}' — see header for usage"
    ;;
esac
