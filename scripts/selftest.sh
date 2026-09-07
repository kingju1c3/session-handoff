#!/bin/sh
# Local script verification only. No network, model calls, or session launch.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh -n "$HERE/lease.sh"
node --check "$HERE/watchdog.mjs"
node --check "$HERE/hooks.mjs"
sh "$HERE/lease.test.sh"
node "$HERE/watchdog.test.mjs"
node "$HERE/hooks.test.mjs"
