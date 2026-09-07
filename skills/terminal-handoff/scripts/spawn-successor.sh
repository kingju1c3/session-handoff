#!/bin/sh
# terminal-handoff — open a successor Claude Code session in a new Terminal window.
#
# SECURITY CONTRACT — the reason this script exists at all:
# argv is world-readable via ps(1). Mission text, prompts, and secrets must NEVER
# be interpolated into an AppleScript string or a shell command line. (Verified
# 2026-08-15: another session's entire startup prompt was readable with
# `ps -o command=`.) So this launcher takes ONE opaque argument — the path to a
# mode-0600 control file — and the successor reads everything else from disk.
#
# Usage:  spawn-successor.sh <control-file>
#
# The control file is JSON and must contain:
#   nonce, docPath, model, effort, cwd, chainId, generation, predecessorName
#
# Prints the Terminal window id on success. Exit 0 launch requested, non-zero otherwise.
# NOTE: a launched window is NOT a ready successor. The caller must wait for the
# successor to attest (nonce + its own session id + cwd + HEAD) before transferring
# ownership. Terminal returning a window id proves only that Terminal obeyed.
set -eu

CTL="${1:-}"
[ -n "$CTL" ] || { echo "usage: spawn-successor.sh <control-file>" >&2; exit 2; }
[ -f "$CTL" ] || { echo "control file not found: $CTL" >&2; exit 2; }

# Refuse to proceed if the control file is readable by anyone else.
PERM=$(stat -f '%Lp' "$CTL" 2>/dev/null || echo "")
case "$PERM" in
  600|400) : ;;
  *) echo "control file $CTL has mode $PERM — must be 600 (it holds the attestation nonce)" >&2; exit 3 ;;
esac

# Pull only what the launcher itself needs. The nonce is NOT read here and never
# reaches a command line.
eval "$(python3 - "$CTL" <<'PY'
import json,sys,shlex
d=json.load(open(sys.argv[1]))
for k in ("model","effort","cwd","chainId","generation"):
    v=d.get(k)
    if v in (None,""):
        sys.stderr.write("control file missing %s\n"%k); sys.exit(4)
    print("%s=%s"%(k.upper(), shlex.quote(str(v))))
PY
)"

# Validate the shapes of everything that will later be embedded anywhere
# (banner text, window title, claude argv). A control file is semi-trusted at
# best — a hostile value must die here, not reach AppleScript or a shell.
case "$GENERATION" in ''|*[!0-9]*) echo "invalid generation in control file: $GENERATION" >&2; exit 4 ;; esac
case "$CHAINID" in ''|*[!A-Za-z0-9-]*) echo "invalid chainId in control file (must be [A-Za-z0-9-])" >&2; exit 4 ;; esac
case "$MODEL" in ''|*[!A-Za-z0-9._-]*) echo "invalid model in control file" >&2; exit 4 ;; esac
case "$EFFORT" in minimal|low|medium|high|xhigh) : ;; *) echo "invalid effort in control file: $EFFORT" >&2; exit 4 ;; esac

[ -d "$CWD" ] || { echo "cwd from control file does not exist: $CWD" >&2; exit 5; }

# PREFLIGHT: workspace trust.
# A `claude` started in a folder that has never been trusted stops at an interactive
# "Is this a project you trust?" dialog. The process is alive and binds a socket, but
# it never registers and never runs the briefing — the handoff hangs forever with no
# error. Verified 2026-08-15; the same trap is recorded in this repo's own parity notes
# ("Codex stopped at a trust prompt in a fresh isolated workspace").
# Fail loudly here rather than stalling at 3am. Never auto-accept a trust dialog —
# that is the user's decision, not the skill's.
if ! python3 - "$CWD" <<'PY'
import json,sys,os
cwd=os.path.realpath(sys.argv[1])
p=os.path.expanduser("~/.claude.json")
try: d=json.load(open(p))
except Exception: sys.exit(0)          # no registry -> can't prove untrusted, allow
projects=d.get("projects",{})
for k,v in projects.items():
    if os.path.realpath(k)==cwd:
        sys.exit(0 if v.get("hasTrustDialogAccepted") else 1)
sys.exit(1)                            # never seen -> will show the dialog
PY
then
  cat >&2 <<MSG
REFUSING TO SPAWN: the workspace has not been trusted yet.
  $CWD
A new Claude Code session there would stop at the "Is this a project you trust?"
prompt and hang forever without running the handoff.
Fix: open a session in that folder once and accept the prompt yourself, then retry.
(This skill will not answer a trust dialog on your behalf.)
MSG
  exit 7
fi

SHORT=$(printf '%s' "$CHAINID" | cut -c1-8)
NAME="handoff-${SHORT}-g${GENERATION}"

# A tiny launcher script so the Terminal command line stays free of prompt text.
#
# F10a: no control-file value is interpolated unquoted into this runner. The
# only thing baked in at generation time is CTL itself, shell-quoted via
# python3 shlex.quote — everything else (MODEL/EFFORT/CWD/NAME) is re-read by
# the runner AT RUNTIME from the control file, through the same
# eval "$(python3 ... shlex.quote ...)" pattern the preflight above uses, so a
# value containing spaces or shell metacharacters can never break out.
RUNNER="${CTL}.run"
CTLQ=$(python3 -c 'import shlex,sys;print(shlex.quote(sys.argv[1]))' "$CTL")
{
  printf '#!/bin/zsh\n'
  printf 'CTL=%s\n' "$CTLQ"
  cat <<'RUNNER_EOF'
eval "$(python3 - "$CTL" <<'PY'
import json,sys,shlex
d=json.load(open(sys.argv[1]))
for k in ("model","effort","cwd"):
    v=d.get(k)
    if v in (None,""):
        sys.stderr.write("control file missing %s\n"%k); sys.exit(4)
    print("%s=%s"%(k.upper(), shlex.quote(str(v))))
chain=str(d.get("chainId") or "")
gen=str(d.get("generation") or "")
print("SHORT=%s" % shlex.quote(chain[:8]))
print("GEN=%s" % shlex.quote(gen))
print("NAME=%s" % shlex.quote("handoff-%s-g%s" % (chain[:8], gen)))
PY
)"
cd "$CWD" || exit 1
clear
echo "=============================================================="
echo " SUCCESSOR SESSION — chain ${SHORT} generation ${GEN}"
echo " model: ${MODEL}   effort: ${EFFORT}"
echo "=============================================================="
echo ""
exec claude --model "$MODEL" --effort "$EFFORT" -n "$NAME" \
  "You are a successor Claude Code session in a handoff chain. Read the control file at $CTL FIRST — it names your briefing document and contains a one-time token you must send back to your predecessor. Follow its instructions exactly, in order, before doing anything else."
RUNNER_EOF
} > "$RUNNER"
chmod 700 "$RUNNER"

# F10b: argv passing, not string interpolation into the AppleScript source —
# a path containing quotes or spaces can no longer break out of the script or
# inject additional AppleScript/zsh commands.
WINID=$(osascript - "$RUNNER" <<'OSA'
on run argv
  tell application "Terminal"
    activate
    set w to do script (quoted form of (item 1 of argv))
    return id of window 1
  end tell
end run
OSA
) || { echo "osascript failed — Terminal.app may be blocked by Automation permissions" >&2; exit 6; }

# WINID must be numeric before it re-enters AppleScript source; SHORT and
# GENERATION are safe by the charset validation above.
case "$WINID" in ''|*[!0-9]*) echo "unexpected window id from Terminal: $WINID" >&2; echo "$WINID"; exit 0 ;; esac
osascript -e "tell application \"Terminal\" to set custom title of tab 1 of window id $WINID to \"HANDOFF ${SHORT} g${GENERATION}\"" >/dev/null 2>&1 || true

echo "$WINID"
