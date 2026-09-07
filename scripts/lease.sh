#!/bin/sh
# session-handoff — cooperative single-writer lease, POSIX + Python 3 stdlib.
# The host/model verifies remote status and attestation; this CLI records its
# observation and enforces ordering. Possession of a session ID is not auth.
#
# init <dir> <sid> <pid> [cap=5] [forkCap=2]
# get|label|journal <dir>; owns <dir> <sid>
# state <dir> <sid> <STATE>
# next-gen <dir> <sid>                  reserve one successor, print its label
# attest <dir> <sid> <candidate-sid>    after verifying host evidence
# transfer <dir> <sid> <candidate-sid> <pid>
# spawn-failed <dir> <sid> <confirmed-absent|unknown>
# recover <dir> <new-sid> <pid> <expected-owner> confirmed-stopped
# release <dir> <sid>
# next-fork is retained only to explain that a native fork uses next-gen;
# parallel workers have separate scopes, never a second owner of this lease.
# Exit: 0 success, 1 ownership/state conflict, 2 bad input, 3 cap, 4 lock timeout.
set -eu
umask 077
exec python3 - "$@" <<'PY'
import fcntl
import json
import os
import stat
import sys
import time
import uuid


def fail(message, code=2):
    print("lease.sh: " + message, file=sys.stderr)
    raise SystemExit(code)


def identity(value):
    if not value.strip() or len(value) > 512 or any(ord(c) < 32 for c in value):
        fail("session IDs must be nonempty, at most 512 characters, without control characters")
    return value


def integer(value, minimum=0):
    if len(value) > 10 or not value.isascii() or not value.isdecimal() or not minimum <= int(value) <= 2147483647:
        fail("expected an integer between %s and 2147483647" % minimum)
    return int(value)


args = sys.argv[1:]
if len(args) < 2 or not args[1]:
    fail("expected a command and state directory; see script header")
command, directory, *values = args
arities = {"init": (2, 4), "get": (0, 0), "label": (0, 0), "journal": (0, 0),
           "owns": (1, 1), "state": (2, 2), "next-gen": (1, 1), "next-fork": (1, 1),
           "attest": (2, 2), "transfer": (3, 3), "release": (1, 1),
           "recover": (4, 4), "spawn-failed": (2, 2)}
if command not in arities or not arities[command][0] <= len(values) <= arities[command][1]:
    fail("invalid command or arguments; see script header")
if values:
    identity(values[0])
if command == "init":
    pid = integer(values[1])
    cap = integer(values[2], 1) if len(values) > 2 else 5
    forkcap = integer(values[3], 1) if len(values) > 3 else 2
if command == "transfer":
    identity(values[1])
    pid = integer(values[2])
if command == "recover":
    pid = integer(values[1])
    identity(values[2])
    if values[3] != "confirmed-stopped":
        fail("recover requires fresh host evidence and the literal confirmed-stopped")


try:
    if command == "init":
        os.makedirs(directory, mode=0o700, exist_ok=True)
    # Refuse a symlink as the state directory and pin its inode for all I/O.
    root = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    info = os.fstat(root)
    if info.st_uid != os.geteuid():
        fail("state directory must belong to the current user")
    if command == "init":
        os.fchmod(root, 0o700)
    elif stat.S_IMODE(info.st_mode) & 0o077:
        fail("state directory must be private (chmod 700 before use)")

    def open_regular(name, flags, mode=0o600):
        fd = os.open(name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, mode, dir_fd=root)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid():
            os.close(fd)
            fail("%s must be an owned regular file with one link" % name)
        if stat.S_IMODE(info.st_mode) & 0o077:
            os.close(fd)
            fail("%s must be private (chmod 600 before use)" % name)
        return fd

    # Keep the lock inode. Deleting it or stealing an aged mkdir lock can let
    # two claimants lock different inodes; the kernel releases flock on exit.
    lock = open_regular(".lock", os.O_RDWR | os.O_CREAT)
    deadline = time.monotonic() + 10
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() >= deadline:
                fail("could not acquire lease lock", 4)
            time.sleep(0.1)

    def read_json():
        with os.fdopen(open_regular("LEASE.json", os.O_RDONLY)) as stream:
            result = json.load(stream)
        if not isinstance(result, dict):
            fail("invalid lease object")
        return result

    if command == "init":
        try:
            os.stat("LEASE.json", dir_fd=root, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            fail("lease already exists; inspect it instead of overwriting")
        data = {"chainId": str(uuid.uuid4()), "generation": 1, "fork": 1, "label": "1.1",
                "cap": cap, "forkCap": forkcap, "ownerSessionId": values[0],
                "ownerPid": pid, "state": "OWNED", "lineage": ["1.1"]}
        output = data["chainId"]
    elif command == "journal":
        try:
            fd = open_regular("JOURNAL.jsonl", os.O_RDONLY)
        except FileNotFoundError:
            print("(no journal)")
        else:
            with os.fdopen(fd) as stream:
                sys.stdout.write(stream.read())
        raise SystemExit(0)
    else:
        data = read_json()
        output = None

    if command == "get":
        print(json.dumps(data, indent=2))
        raise SystemExit(0)
    if command == "label":
        print(data["label"])
        raise SystemExit(0)
    if command == "owns":
        raise SystemExit(0 if data.get("ownerSessionId") == values[0]
                         and data.get("state") != "RELEASED" else 1)
    if command not in {"init", "recover"} and data.get("ownerSessionId") != values[0]:
        fail("not owner", 1)
    pending = data.get("pendingSuccessor")

    if command == "state":
        new = values[1]
        # Ownership/candidate states have dedicated commands; generic state
        # updates must not bypass their guards.
        transitions = {"OWNED": {"WINDING_DOWN", "BLOCKED"},
                       "TRANSFERRED": {"OWNED", "WINDING_DOWN", "BLOCKED"},
                       "WINDING_DOWN": {"DOC_WRITTEN", "BLOCKED"},
                       "DOC_WRITTEN": {"REVIEWED", "WINDING_DOWN", "BLOCKED"},
                       "REVIEWED": {"WINDING_DOWN", "BLOCKED"},
                       "SPAWN_REQUESTED": {"BLOCKED"}, "ATTESTED": {"BLOCKED"},
                       "BLOCKED": {"SPAWN_REQUESTED"} if pending else {"WINDING_DOWN"}}
        if new in {"ATTESTED", "TRANSFERRED", "RELEASED"} or new not in transitions:
            fail("use the dedicated command for ownership states, or a valid state")
        if new != data["state"] and new not in transitions.get(data["state"], set()):
            fail("invalid transition %s -> %s" % (data["state"], new), 1)
        data["state"] = new
    elif command == "next-gen":
        if pending or data["state"] not in {"DOC_WRITTEN", "REVIEWED"}:
            fail("write the document first; only one pending successor is allowed", 1)
        # A deadline may skip review with a reason in the document, never the
        # durable document itself.
        generation = data["generation"] + 1
        if generation > data["cap"]:
            fail("generation cap reached", 3)
        output = "%s.1" % generation
        data["pendingSuccessor"] = {"label": output, "sessionId": None}
        data["state"] = "SPAWN_REQUESTED"
    elif command == "next-fork":
        fail("native forks use next-gen; parallel workers need separate scopes, not another mission owner")
    elif command == "attest":
        candidate = identity(values[1])
        if not pending or data["state"] != "SPAWN_REQUESTED" or candidate == values[0]:
            fail("attest requires a pending, distinct successor in SPAWN_REQUESTED", 1)
        if pending.get("sessionId") not in {None, candidate}:
            fail("candidate differs from the previously recorded successor", 1)
        pending["sessionId"] = candidate
        data["state"] = "ATTESTED"
    elif command == "transfer":
        if data["state"] != "ATTESTED" or not pending or pending.get("sessionId") != values[1]:
            fail("transfer requires the exact attested successor", 1)
        data["previousOwnerSessionId"] = data["ownerSessionId"]
        data["ownerSessionId"], data["ownerPid"] = values[1], pid
        data["label"] = pending["label"]
        data["generation"], data["fork"] = map(int, pending["label"].split("."))
        data["lineage"].append(pending["label"])
        del data["pendingSuccessor"]
        data["state"] = "TRANSFERRED"
    elif command == "spawn-failed":
        outcome = values[1]
        if outcome not in {"confirmed-absent", "unknown"}:
            fail("spawn outcome must be confirmed-absent or unknown")
        if not pending or data["state"] not in {"SPAWN_REQUESTED", "BLOCKED"}:
            fail("no pending spawn to reconcile", 1)
        if outcome == "confirmed-absent":
            del data["pendingSuccessor"]
        data["state"] = "BLOCKED"
    elif command == "release":
        if pending:
            fail("reconcile the pending successor before releasing the chain", 1)
        data["state"], data["ownerSessionId"], data["ownerPid"] = "RELEASED", None, 0
    elif command == "recover":
        if data.get("state") == "RELEASED" or not data.get("ownerSessionId"):
            fail("a released chain is terminal; create a new chain directory", 1)
        if data["ownerSessionId"] != values[2] or values[0] == values[2]:
            fail("recorded owner changed, or recovery identity is unchanged", 1)
        if pending and pending.get("sessionId") == values[0]:
            fail("recovering as the pending candidate needs explicit reconciliation first", 1)
        data["previousOwnerSessionId"] = data["ownerSessionId"]
        data["ownerSessionId"], data["ownerPid"] = values[0], pid
        data["state"] = "BLOCKED" if pending else "OWNED"

    # Validate the journal before committing: a planted symlink must not
    # redirect records or allow a state change followed by a known bad append.
    journal = open_regular("JOURNAL.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND)
    data["updatedAt"] = int(time.time())
    event = {"ts": data["updatedAt"], "event": command, "sessionId": values[0],
             "state": data["state"], "label": data["label"], "args": values[1:]}
    temp = ".LEASE.%s.tmp" % uuid.uuid4()
    try:
        with os.fdopen(open_regular(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL), "w") as stream:
            json.dump(data, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, "LEASE.json", src_dir_fd=root, dst_dir_fd=root)
        os.fsync(root)
        with os.fdopen(journal, "a") as stream:
            stream.write(json.dumps(event, separators=(",", ":")) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        try:
            os.unlink(temp, dir_fd=root)
        except FileNotFoundError:
            pass
    if output is not None:
        print(output)
except (OSError, ValueError, KeyError, TypeError) as error:
    # A crash/I/O error between the lease write and append may omit a journal
    # record. A failed command never implies that the mutation rolled back.
    fail("%s; inspect LEASE.json before retrying a mutation" % error)
PY
