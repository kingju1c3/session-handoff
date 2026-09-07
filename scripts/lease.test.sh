#!/bin/sh
# Ownership regression checks: temporary local files only, no host sessions.
set -eu
exec python3 - "$(dirname "$0")/lease.sh" <<'PY'
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

lease = str(Path(sys.argv[1]).resolve())
checks = 0


def check(condition, label):
    global checks
    assert condition, label
    checks += 1


def run(*args, code=0):
    result = subprocess.run(["sh", lease, *map(str, args)], capture_output=True, text=True)
    check(result.returncode == code,
          "%s: expected %s, got %s: %s" % (args[0], code, result.returncode, result.stderr))
    return result.stdout.strip()


def read(directory):
    return json.loads((directory / "LEASE.json").read_text())


def prepare(directory, owner):
    run("state", directory, owner, "WINDING_DOWN")
    run("state", directory, owner, "DOC_WRITTEN")


with tempfile.TemporaryDirectory(prefix="handoff-lease-test-") as temp:
    root = Path(temp)
    directory = root / "chain"
    owner = 'owner"quoted'
    for pid, cap in [("-1", "5"), ("x", "5"), ("0", "0"), ("0", "-1"), ("0", "2.5"), ("9" * 5000, "5")]:
        run("init", directory, owner, pid, cap, code=2)
    run("init", directory, "owner\nforged", "0", code=2)
    check(not directory.exists(), "invalid initialization leaves no state directory")
    run("init", directory, owner, 0, 2)
    check(directory.stat().st_mode & 0o777 == 0o700, "private state directory")
    check(all((directory / p).stat().st_mode & 0o777 == 0o600
              for p in ["LEASE.json", "JOURNAL.jsonl", ".lock"]), "private state files")
    check(json.loads((directory / "JOURNAL.jsonl").read_text())["sessionId"] == owner,
          "journal escapes quoted session IDs")
    run("init", directory, owner, 0, code=2)
    run("owns", directory, owner)
    run("owns", directory, "other", code=1)
    before = (directory / "LEASE.json").read_bytes()
    run("state", directory, "other", "WINDING_DOWN", code=1)
    check((directory / "LEASE.json").read_bytes() == before, "non-owner cannot change lease")
    run("transfer", directory, owner, "candidate", 0, code=1)
    run("state", directory, owner, "ATTESTED", code=2)
    run("state", directory, owner, "TRANSFERRED", code=2)
    run("next-gen", directory, owner, code=1)
    run("next-fork", directory, owner, code=2)
    prepare(directory, owner)

    def claim(_):
        return subprocess.run(["sh", lease, "next-gen", str(directory), owner],
                              capture_output=True, text=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(claim, range(8)))
    check(sorted(r.returncode for r in results) == [0] + [1] * 7,
          "concurrent claims reserve exactly one successor")
    state = read(directory)
    check(state["label"] == "1.1" and state["pendingSuccessor"]["label"] == "2.1",
          "reservation does not relabel the current owner")
    run("spawn-failed", directory, owner, code=2)
    run("spawn-failed", directory, owner, "unknown")
    check(read(directory)["pendingSuccessor"]["label"] == "2.1",
          "unknown spawn retains the reservation")
    run("next-gen", directory, owner, code=1)
    run("release", directory, owner, code=1)
    run("state", directory, owner, "SPAWN_REQUESTED")
    run("attest", directory, owner, owner, code=1)
    run("attest", directory, owner, "candidate")
    run("transfer", directory, owner, "different-candidate", 0, code=1)
    run("transfer", directory, owner, "candidate", 0)
    run("owns", directory, owner, code=1)
    run("owns", directory, "candidate")
    state = read(directory)
    check(state["label"] == "2.1" and state["lineage"] == ["1.1", "2.1"]
          and "pendingSuccessor" not in state, "transfer commits the reserved lineage once")
    run("state", directory, "candidate", "OWNED")
    prepare(directory, "candidate")
    run("next-gen", directory, "candidate", code=3)
    run("recover", directory, "recovery", 0, code=2)
    run("recover", directory, "recovery", 0, owner, "confirmed-stopped", code=1)
    run("recover", directory, "recovery", 0, "candidate", "unknown", code=2)
    run("recover", directory, "recovery", 0, "candidate", "confirmed-stopped")
    run("owns", directory, "candidate", code=1)
    run("owns", directory, "recovery")
    run("release", directory, "recovery")
    run("recover", directory, "resurrect", 0, "recovery", "confirmed-stopped", code=1)
    run("owns", directory, "recovery", code=1)

    retry = root / "retry"
    run("init", retry, "root", 0)
    prepare(retry, "root")
    run("next-gen", retry, "root")
    run("spawn-failed", retry, "root", "confirmed-absent")
    check("pendingSuccessor" not in read(retry) and read(retry)["lineage"] == ["1.1"],
          "confirmed absence clears only the uncommitted reservation")
    prepare(retry, "root")
    check(run("next-gen", retry, "root") == "2.1", "confirmed absent attempt permits retry")

    external = root / "external"
    external.write_text("untouched")
    external.chmod(0o600)
    for name in [".lock", "JOURNAL.jsonl", "LEASE.json"]:
        planted = root / ("planted-" + name.replace(".", ""))
        planted.mkdir(mode=0o700)
        (planted / name).symlink_to(external)
        run("init", planted, "owner", 0, code=2)
        check(external.read_text() == "untouched", "reject %s symlink without modifying target" % name)
    linked = root / "linked-journal"
    linked.mkdir(mode=0o700)
    os.link(external, linked / "JOURNAL.jsonl")
    run("init", linked, "owner", 0, code=2)
    check(external.read_text() == "untouched", "hard-linked journal cannot redirect writes")

    # A killed lock holder must not leave a stale directory to steal/delete.
    crash = root / "crash"
    run("init", crash, "owner", 0)
    holder = subprocess.Popen([sys.executable, "-c",
        "import fcntl,sys; f=open(sys.argv[1],'r+'); fcntl.flock(f,fcntl.LOCK_EX); "
        "print('locked',flush=True); sys.stdin.read()", str(crash / ".lock")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        check(holder.stdout.readline().strip() == "locked", "fixture acquires real kernel lock")
        inode = (crash / ".lock").stat().st_ino
        waiter = subprocess.Popen(["sh", lease, "state", str(crash), "owner", "WINDING_DOWN"],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            waiter.wait(timeout=0.15)
            check(False, "contender must wait while lock holder is alive")
        except subprocess.TimeoutExpired:
            check(True, "contender waits for a live holder")
        holder.kill()
        holder.wait()
        _, stderr = waiter.communicate(timeout=3)
        check(waiter.returncode == 0, "kernel releases crashed holder's lock: " + stderr)
        check((crash / ".lock").stat().st_ino == inode, "lock inode is never stolen or deleted")
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait()
    (crash / "LEASE.json").chmod(0o644)
    run("get", crash, code=2)

print("lease: %s checks passed" % checks)
PY
