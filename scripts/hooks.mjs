#!/usr/bin/env node
// Optional host adapter. Default output is neutral JSON for a caller/supervisor.
// No host is assumed able to block compaction. Enable each capability only after
// an installed-host smoke test; a synthetic test does not demonstrate enforcement.
import { readFileSync, writeFileSync, existsSync, lstatSync, openSync, closeSync, unlinkSync, renameSync, constants, fstatSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evaluate, IN_FLIGHT_STATES } from './watchdog.mjs';

let input;
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); }
catch { process.stderr.write('session-handoff: invalid hook JSON\n'); process.exit(1); }
if (!input || typeof input !== 'object' || Array.isArray(input)) process.exit(1);

const event = input.hook_event_name || input.event || process.argv[2] || 'Preflight';
const sessionId = input.session_id || process.env.HANDOFF_SESSION_ID || null;
const dir = process.env.HANDOFF_DIR || resolve(input.cwd || process.cwd(), '.handoff');
const adapter = process.env.HANDOFF_HOOK_ADAPTER || 'generic';
const positiveEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'];
const clamp = (name, fallback, max) => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^\d+$/.test(raw) ? Math.min(Number(raw), max) : fallback;
};
const maxCompact = clamp('HANDOFF_MAX_PRECOMPACT_BLOCKS', 2, 2);
const maxStop = clamp('HANDOFF_MAX_STOP_BLOCKS', 2, 2);
const debounce = clamp('HANDOFF_ADVISORY_DEBOUNCE_MS', 60000, 60000);
const w = evaluate({
  dir, sessionId, signal: input.context_signal,
  transcript: process.env.HANDOFF_TRANSCRIPT || input.transcript_path || null,
});
if (w.phase === 'NOLEASE') process.exit(0);

const statePath = join(dir, '.enforce-state.json');
// Serialize budget checks without waiting inside a hook. A crashed hook may
// leave this lock: that disables blocks (safe fail-open), never steals a lock.
const lockPath = join(dir, '.hook-budget.lock');
let lock = null;
try {
  if (!lstatSync(dir).isSymbolicLink()) lock = openSync(lockPath, 'wx', 0o600);
} catch { /* Another invocation or unavailable bookkeeping: advisory only. */ }
process.on('exit', () => {
  if (lock === null) return;
  try { closeSync(lock); unlinkSync(lockPath); } catch { /* no retry */ }
});
const key = JSON.stringify([w.chainId, w.generation, sessionId]);
let state = { key, precompactBlocks: 0, stopBlocks: 0, lastPhase: null, lastEmitAt: 0 };
let writableState = true;
try {
  const fd = openSync(statePath, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  let saved;
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 65536) throw Error('invalid bookkeeping file');
    const bytes = Buffer.alloc(info.size);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    saved = JSON.parse(bytes.subarray(0, count).toString('utf8'));
  } finally { closeSync(fd); }
  if (!saved || typeof saved.key !== 'string' || !['precompactBlocks','stopBlocks','lastEmitAt'].every(
    k => Number.isSafeInteger(saved[k]) && saved[k] >= 0)) throw Error('invalid bookkeeping state');
  if (saved.key === key) state = saved;
} catch (error) {
  // Missing file starts a fresh budget; corrupt/unreadable state cannot reset
  // an existing budget and grant more blocks.
  if (error.code !== 'ENOENT') writableState = false;
}
function save() {
  if (lock === null || !writableState) return false;
  const temp = statePath + '.' + process.pid + '.tmp';
  try {
    // Do not follow bookkeeping symlinks or persist outside an existing lease dir.
    if (lstatSync(dir).isSymbolicLink()) return false;
    if (existsSync(statePath) && !lstatSync(statePath).isFile()) return false;
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    renameSync(temp, statePath);
    return true;
  } catch { return false; } // No repeat blocking if its budget cannot be persisted.
  finally { try { unlinkSync(temp); } catch { /* absent or unavailable */ } }
}
function emit(reason, decision = 'advisory', block = false) {
  if (adapter === 'claude') {
    if (block) { process.stderr.write(reason + '\n'); process.exit(2); }
    if (positiveEvents.includes(event)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: event, additionalContext: reason },
      }));
    } else process.stdout.write(reason + '\n');
  } else {
    process.stdout.write(JSON.stringify({ event, decision, phase: w.phase,
      compactionVeto: false, reason, context: w }));
  }
  process.exit(0);
}
const chain = 'chain ' + (w.chainId ?? '?') + ' · owner state ' + (w.state ?? '?');
const reading = w.pct === null ? (w.note || 'context unknown') :
  'used ' + w.pct + '%; projected ' + w.projectedPct + '%; soft ' + w.soft +
  '%; hard ' + w.hard + '%; boundary ' + w.compactionPct + '%';
const checkpoint = 'Save a private checkpoint and resume prompt NOW, before more mission work. ' +
  'Use the available fresh-session tool; use a fork only with verified context headroom. ' +
  'No automatic launch tool: show the checkpoint for a manual new session. ' +
  'Retain ownership until the exact candidate acknowledges the artifacts and is attested.';
const prefix = '[session-handoff] ' + chain + '\n' + reading + '\n';

if (w.phase === 'SUPERSEDED') emit(prefix +
  'This session does not own the mission. Stop mission edits. A candidate may only bootstrap ' +
  'read-only and acknowledge the checkpoint while waiting for transfer.', 'stop');

if (event === 'SessionStart') emit(prefix +
  'Read ' + join(dir, 'LEASE.json') + ' and the latest continuation before mission work. ' +
  'Verify ownership and refresh this session\'s telemetry. ' +
  (w.phase === 'CHECKPOINT_NOW' ? checkpoint : ''));

if (['RELEASED', 'BLOCKED'].includes(w.state)) process.exit(0);
// A transferred candidate must first acknowledge takeover; the old owner was
// already caught by SUPERSEDED. Do not silently suppress the new owner's state.
if (w.state === 'TRANSFERRED') emit(prefix +
  'Verify the transfer, set your lease state to OWNED, then refresh telemetry.', 'checkpoint');

if (['PreCompact', 'preCompact', 'PreCompress', 'before_compaction'].includes(event)) {
  const manual = [input.trigger, input.compaction_reason, input.compaction_reason_name]
    .some(v => typeof v === 'string' && v.toLowerCase() === 'manual');
  if (manual) emit(prefix + 'Manual compaction requested; do not block the user. ' +
    'The saved checkpoint survives. Re-read it and the lease after compaction.');
  // Unknown event implementations remain advisory. An env flag alone is not
  // evidence that a host honors exit 2; documentation requires a smoke test.
  const canBlock = adapter === 'claude' && event === 'PreCompact' &&
    process.env.HANDOFF_CAN_BLOCK_COMPACTION === '1';
  if (canBlock && state.precompactBlocks < maxCompact) {
    state.precompactBlocks++;
    if (save()) emit(prefix + 'Requesting a bounded compaction delay (' +
      state.precompactBlocks + '/' + maxCompact + '). ' + checkpoint, 'checkpoint', true);
  }
  emit(prefix + 'Pre-compaction warning; no verified delay is being requested. ' +
    'A pre-compaction callback does not guarantee time to rotate. ' + checkpoint, 'checkpoint');
}

if (event === 'Stop') {
  // Respect host recursion guard and explicit blocked state.
  if (input.stop_hook_active === true) process.exit(0);
  const unfinished = IN_FLIGHT_STATES.includes(w.state);
  const urgent = ['HARD','CEILING'].includes(w.phase) && w.enforce;
  if ((unfinished || urgent) && adapter === 'claude' &&
      process.env.HANDOFF_CAN_BLOCK_STOP === '1' && state.stopBlocks < maxStop) {
    state.stopBlocks++;
    if (save()) emit(prefix + 'Handoff incomplete; bounded stop delay (' +
      state.stopBlocks + '/' + maxStop + '). ' + checkpoint +
      ' If unavailable, record the exact blocker and set BLOCKED.', 'checkpoint', true);
  }
  if (unfinished) emit(prefix + 'Handoff remains incomplete. ' + checkpoint, 'checkpoint');
  process.exit(0);
}
if (!['CHECKPOINT_NOW','SOFT','HARD','CEILING'].includes(w.phase)) process.exit(0);

const now = Date.now();
// A preflight result must never be debounced: every proposed operation needs a
// decision. Only repeated post-tool informational messages can be suppressed.
if (event === 'PostToolUse' && state.lastPhase === w.phase &&
    now - state.lastEmitAt < debounce) process.exit(0);
state.lastPhase = w.phase; state.lastEmitAt = now; save();
emit(prefix + w.phase + ': ' + checkpoint, 'checkpoint');
