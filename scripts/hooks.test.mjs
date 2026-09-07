#!/usr/bin/env node
// Local integration tests: real subprocesses/files, synthetic host messages.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'handoff-hooks-'));
const dir = join(temp, '.handoff');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('HANDOFF_') && !key.startsWith('CLAUDE_')));
let checks = 0;
function check(condition, label) { assert.ok(condition, label); checks++; }
function lease(...args) {
  const result = spawnSync('sh', [join(here, 'lease.sh'), args[0], dir, ...args.slice(1)],
    { encoding: 'utf8', env: environment, timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function signal(used = 10) {
  return { session_id: 'owner', observed_at: new Date().toISOString(),
    source: {kind: 'host', name: 'test-host'}, used_pct: used, compaction_pct: 60,
    next_step_pct: 2, reserve_pct: 5 };
}
function hook(event, { used = 10, env = {}, input = {}, raw } = {}) {
  const result = spawnSync(process.execPath, [join(here, 'hooks.mjs')], {
    input: raw ?? JSON.stringify({ event, hook_event_name: event, session_id: 'owner',
      cwd: temp, context_signal: signal(used), ...input }),
    encoding: 'utf8', timeout: 5000,
    env: {...environment, HANDOFF_DIR: dir, ...env},
  });
  assert.equal(result.error, undefined);
  return result;
}
const claude = {HANDOFF_HOOK_ADAPTER: 'claude', HANDOFF_CAN_BLOCK_COMPACTION: '1'};
try {
  check(hook('PreCompact', {env: claude}).stdout === '', 'unarmed hook silent');
  check(hook('PreCompact', {env: claude}).status === 0, 'unarmed never blocks');
  lease('init', 'owner', '0', '3');
  check(hook('Preflight').stdout === '', 'safe preflight permits bounded work');
  let r = hook('Preflight', {used: 40});
  check(JSON.parse(r.stdout).phase === 'SOFT', 'projected budget enters soft threshold');
  r = hook('Preflight', {used: 40});
  check(JSON.parse(r.stdout).phase === 'SOFT', 'preflight is never debounced');
  check(hook('PostToolUse', {used: 40}).stdout === '', 'same-phase post-tool advisory debounced');
  r = hook('Preflight', {used: 38, input: {context_signal: {...signal(38), next_step_pct: 19, reserve_pct: 6}}});
  check(JSON.parse(r.stdout).phase === 'CEILING', 'large next action caught before tool dispatch');
  r = hook('Preflight', {input: {context_signal: null}});
  check(JSON.parse(r.stdout).phase === 'CHECKPOINT_NOW', 'unknown telemetry checkpoints now');
  r = hook('Preflight', {input: {session_id: 'wrong'}});
  check(JSON.parse(r.stdout).phase === 'SUPERSEDED', 'other caller cannot drive owner mission');
  r = hook('PreCompact');
  check(r.status === 0 && JSON.parse(r.stdout).compactionVeto === false, 'generic precompact never claims veto');
  for (const name of ['preCompact','PreCompress','before_compaction']) {
    r = hook(name, {env: claude});
    check(r.status === 0, name + ' cannot inherit Claude veto');
  }
  r = hook('PreCompact', {env: {HANDOFF_HOOK_ADAPTER: 'claude'}});
  check(r.status === 0, 'Claude adapter alone does not enable block');
  r = hook('PreCompact', {env: claude, input: {trigger: 'manual'}});
  check(r.status === 0 && r.stdout.includes('Manual compaction'), 'manual trigger passes');
  check(hook('PreCompact', {env: claude}).status === 2, 'opt-in Claude block first');
  check(hook('PreCompact', {env: claude}).status === 2, 'opt-in Claude block second');
  check(hook('PreCompact', {env: claude}).status === 0, 'third attempt fails open');
  check(hook('PreCompact', {env: {...claude, HANDOFF_MAX_PRECOMPACT_BLOCKS: '999999'}}).status === 0,
    'invalidly large configuration cannot expand cap');
  r = hook('Stop', {env: {HANDOFF_HOOK_ADAPTER: 'claude', HANDOFF_CAN_BLOCK_STOP: '1'}});
  check(r.status === 0, 'low-context owner stop permitted');
  lease('state', 'owner', 'WINDING_DOWN');
  const stop = {HANDOFF_HOOK_ADAPTER: 'claude', HANDOFF_CAN_BLOCK_STOP: '1'};
  check(hook('Stop', {env: stop, input: {stop_hook_active: true}}).status === 0, 'Stop recursion guard');
  check(hook('Stop', {env: stop}).status === 2, 'unfinished stop block first');
  check(hook('Stop', {env: stop}).status === 2, 'unfinished stop block second');
  check(hook('Stop', {env: stop}).status === 0, 'stop budget bounded');
  lease('state', 'owner', 'DOC_WRITTEN');
  lease('next-gen', 'owner');
  check(hook('PreCompact', {env: claude}).status === 0, 'reservation cannot reset predecessor budget');
  lease('attest', 'owner', 'candidate');
  lease('transfer', 'owner', 'candidate', '0');
  r = hook('Preflight');
  check(JSON.parse(r.stdout).phase === 'SUPERSEDED', 'predecessor superseded after real transfer');
  r = hook('SessionStart', {input: {session_id: 'candidate'}});
  check(r.stdout.includes('Read'), 'successor receives orientation');
  r = hook('Preflight', {input: {session_id: 'candidate'}});
  check(r.stdout.includes('OWNED'), 'transferred successor told to take over');
  lease('state', 'candidate', 'OWNED');
  r = hook('PreCompact', {env: claude, input: {session_id: 'candidate', context_signal: {...signal(), session_id: 'candidate'}}});
  check(r.status === 2, 'new owner generation gets separate bounded budget');
  check((statSync(join(dir, '.enforce-state.json')).mode & 0o777) === 0o600, 'bookkeeping is private');
  writeFileSync(join(dir, '.hook-budget.lock'), 'held', {mode: 0o600});
  r = hook('PreCompact', {env: claude, input: {session_id: 'candidate'}});
  check(r.status === 0, 'unavailable serialization fails open without waiting');
  rmSync(join(dir, '.hook-budget.lock'));
  rmSync(join(dir, '.enforce-state.json'));
  const outside = join(temp, 'outside');
  writeFileSync(outside, 'preserve');
  symlinkSync(outside, join(dir, '.enforce-state.json'));
  r = hook('PreCompact', {env: claude, input: {session_id: 'candidate'}});
  check(r.status === 0 && readFileSync(outside, 'utf8') === 'preserve', 'bookkeeping symlink not overwritten');
  rmSync(join(dir, '.enforce-state.json'));
  const fifo = spawnSync('mkfifo', [join(dir, '.enforce-state.json')], {encoding: 'utf8'});
  assert.equal(fifo.status, 0, fifo.stderr);
  r = hook('PreCompact', {env: claude, input: {session_id: 'candidate'}});
  check(r.status === 0, 'bookkeeping FIFO cannot block the hook');
  rmSync(join(dir, '.enforce-state.json'));
  writeFileSync(join(dir, '.enforce-state.json'), '{broken', {mode: 0o600});
  r = hook('PreCompact', {env: claude, input: {session_id: 'candidate'}});
  check(r.status === 0, 'corrupt bookkeeping cannot reset the block budget');
  writeFileSync(join(dir, '.enforce-state.json'), 'x'.repeat(65537));
  r = hook('PreCompact', {env: claude, input: {session_id: 'candidate'}});
  check(r.status === 0, 'oversized bookkeeping fails open');
  check(hook('Preflight', {raw: '{broken'}).status === 1, 'invalid hook input not silently accepted');
  console.log(checks + ' hook integration checks passed');
} finally { rmSync(temp, {recursive: true, force: true}); }
