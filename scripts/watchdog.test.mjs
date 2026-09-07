#!/usr/bin/env node
// Run: node scripts/watchdog.test.mjs — isolated files, no services or network.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate } from './watchdog.mjs';

const dir = mkdtempSync(join(tmpdir(), 'session-handoff-policy-'));
const now = Date.now();
const sessionId = 'policy-test-owner';
const base = {
  session_id: sessionId, observed_at: new Date(now).toISOString(),
  source: { kind: 'host', name: 'test-host' },
  used_pct: 10, compaction_pct: 80, next_step_pct: 0, reserve_pct: 1,
};
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
function run(changes = {}, options = {}) {
  return evaluate({ dir, sessionId, env: {}, now, signal: { ...base, ...changes }, ...options });
}
function unknown(changes = {}, options = {}) {
  const result = run(changes, options);
  check(result.phase === 'CHECKPOINT_NOW' && !result.enforce && !result.compactionVeto, result.note);
  check(result.note.includes('durable checkpoint now'), 'unknown measurements must request a checkpoint');
  return result;
}
const lease = { chainId: 'test', ownerSessionId: sessionId, generation: 1, fork: 1, state: 'OWNED' };
function putLease(changes = {}) { writeFileSync(join(dir, 'LEASE.json'), JSON.stringify({ ...lease, ...changes })); }

try {
  check(run().phase === 'NOLEASE', 'unarmed stays dormant');
  putLease();
  for (const compaction of [1, 5, 10, 20, 60, 80, 95]) {
    const reserve = compaction / 8;
    const inputs = { compaction_pct: compaction, reserve_pct: reserve };
    const result = run({ ...inputs, used_pct: 0 });
    check(0 < result.soft && result.soft < result.hard && result.hard < compaction, 'every deadline precedes compaction');
    check(result.phase === 'DORMANT' && result.enforce && !result.compactionVeto, 'known idle signal');
    check(run({ ...inputs, used_pct: result.soft - reserve }).phase === 'SOFT', 'soft boundary');
    check(run({ ...inputs, used_pct: result.hard - reserve }).phase === 'HARD', 'hard boundary');
    check(run({ ...inputs, used_pct: compaction - reserve }).phase === 'CEILING', 'compaction boundary');
  }
  check(run({ used_pct: 70, next_step_pct: 2, reserve_pct: 3 }).phase === 'HARD', 'reserve advances handoff');
  check(run({ used_pct: 1, next_step_pct: 100, reserve_pct: 2 }).phase === 'CEILING', 'huge next action stops early');
  const capped = run({}, { env: { HANDOFF_COMPACTION_PCT: '60' } });
  check(capped.compactionPct === 60 && capped.compactionSource === 'config-cap', 'config may move handoff earlier');
  check(run({}, { env: { HANDOFF_COMPACTION_PCT: '95' } }).compactionPct === 80, 'config cannot delay host threshold');
  unknown({ compaction_pct: undefined }, { env: { HANDOFF_COMPACTION_PCT: '60' } });
  unknown({}, { signal: undefined });
  unknown({}, { signal: null });
  unknown({}, { signal: [] });
  unknown({ used_pct: undefined });
  unknown({ next_step_pct: undefined });
  unknown({ reserve_pct: undefined });
  unknown({ reserve_pct: 0 });
  unknown({ session_id: 'other' });
  unknown({}, { sessionId: null });
  unknown({ observed_at: new Date(now - 60001).toISOString() });
  unknown({ observed_at: new Date(now + 1).toISOString() });
  unknown({ observed_at: undefined });
  unknown({ observed_at: 'not-a-date' });
  unknown({ observed_at: '2026-02-30T12:00:00Z' }, { now: Date.parse('2026-03-02T12:00:00Z') });
  unknown({ observed_at: '2026-09-06T24:00:00Z' }, { now: Date.parse('2026-09-07T00:00:00Z') });
  unknown({ source: { kind: 'estimate', name: 'guess' } });
  unknown({ source: undefined });
  check(run({ observed_at: new Date(now - 60000).toISOString() }).phase === 'DORMANT', 'freshness boundary inclusive');
  unknown({ observed_at: new Date(now - 1001).toISOString() }, { env: { HANDOFF_SIGNAL_MAX_AGE_MS: '1000' } });
  for (const field of ['used_pct', 'compaction_pct', 'next_step_pct', 'reserve_pct', 'window_tokens']) {
    for (const invalid of [true, false, '', '10', null, -1, NaN, Infinity]) unknown({ [field]: invalid });
  }
  unknown({ window_tokens: 0 });
  unknown({ compaction_pct: 0 });
  unknown({ compaction_pct: 101 });
  unknown({ used_tokens: 100 });
  unknown({ used_pct: Number.MAX_VALUE, next_step_pct: Number.MAX_VALUE });
  for (const value of ['', ' ', 'true', 'NaN', '-1', '0', '101', 80, true]) {
    unknown({}, { env: { HANDOFF_COMPACTION_PCT: value } });
  }
  const tokens = {
    window_tokens: 100000, used_tokens: 10000, compaction_tokens: 80000,
    next_step_tokens: 0, reserve_tokens: 1000,
  };
  check(run(tokens).phase === 'DORMANT', 'consistent dual representation allowed');
  const tokensOnly = run({ ...tokens, used_pct: undefined, compaction_pct: undefined,
    next_step_pct: undefined, reserve_pct: undefined });
  check(tokensOnly.pct === 10 && tokensOnly.compactionPct === 80, 'token-only signal');
  for (const key of ['used', 'compaction', 'next_step', 'reserve']) {
    unknown({ ...tokens, [`${key}_tokens`]: tokens[`${key}_tokens`] + 1000 });
    unknown({ ...tokens, [`${key}_tokens`]: '10' });
  }
  putLease({ ownerSessionId: 'successor', state: 'TRANSFERRED' });
  check(run().phase === 'SUPERSEDED', 'old owner stops even after transfer');
  putLease({ ownerSessionId: sessionId, state: 'TRANSFERRED' });
  check(run().phase === 'DORMANT', 'terminal chain state idle');
  putLease({ ownerSessionId: null });
  unknown();
  writeFileSync(join(dir, 'LEASE.json'), '{');
  unknown();
  putLease();

  const signalPath = join(dir, 'signal.json');
  writeFileSync(signalPath, JSON.stringify(base));
  check(run({}, { signal: undefined, signalPath }).phase === 'DORMANT', 'signal file argument');
  check(run({}, { signal: undefined, env: { HANDOFF_CONTEXT_SIGNAL: signalPath } }).phase === 'DORMANT', 'explicit signal environment path');
  unknown({}, { signal: undefined, signalPath: join(dir, 'missing.json') });
  writeFileSync(signalPath, ' '.repeat(65537));
  unknown({}, { signal: undefined, signalPath });
  writeFileSync(signalPath, JSON.stringify({ ...base, observed_at: new Date().toISOString() }));
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('./watchdog.mjs', import.meta.url)),
    '--dir', dir, '--session', sessionId, '--signal', signalPath], { encoding: 'utf8', env: {} });
  check(cli.status === 0 && JSON.parse(cli.stdout).phase === 'DORMANT', 'CLI --signal real invocation');
  if (process.platform !== 'win32') {
    const fifo = join(dir, 'signal.fifo');
    check(spawnSync('mkfifo', [fifo]).status === 0, 'create isolated FIFO fixture');
    const fifoResult = spawnSync(process.execPath, [fileURLToPath(new URL('./watchdog.mjs', import.meta.url)),
      '--dir', dir, '--session', sessionId, '--signal', fifo], { encoding: 'utf8', env: {}, timeout: 2000 });
    check(!fifoResult.error && fifoResult.status === 0 && JSON.parse(fifoResult.stdout).phase === 'CHECKPOINT_NOW', 'FIFO rejected without blocking');
  }

  const transcript = join(dir, 'transcript.jsonl');
  const adapterEnv = { HANDOFF_WINDOW_TOKENS: '100000', CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80',
    HANDOFF_NEXT_STEP_PCT: '2', HANDOFF_RESERVE_PCT: '5' };
  const row = { type: 'assistant', sessionId, timestamp: base.observed_at,
    message: { model: 'unlisted-model', usage: { input_tokens: 1000, cache_read_input_tokens: 20000,
      cache_creation_input_tokens: 9000, output_tokens: 900000 } } };
  function putRows(rows) { writeFileSync(transcript, rows.map(value => JSON.stringify(value)).join('\n') + '\n'); }
  function adapter() { return run({}, { signal: undefined, transcript, env: adapterEnv }); }
  putRows([row, row, { ...row, sessionId: 'sidechain', isSidechain: true }]);
  const measured = adapter();
  check(measured.used === 30000 && measured.pct === 30 && measured.projectedPct === 37, 'latest input plus each cache field once; output and sidechain excluded');
  check(measured.window === 100000 && measured.model === 'unlisted-model', 'explicit window supports any model name');
  delete adapterEnv.HANDOFF_WINDOW_TOKENS;
  check(adapter().phase === 'CHECKPOINT_NOW', 'adapter never invents a model window');
  adapterEnv.HANDOFF_WINDOW_TOKENS = '100000';
  delete adapterEnv.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  adapterEnv.HANDOFF_COMPACTION_PCT = '70';
  check(adapter().phase === 'CHECKPOINT_NOW', 'adapter never guesses host compaction');
  adapterEnv.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '80';
  putRows([{ ...row, sessionId: 'other' }]);
  check(adapter().phase === 'CHECKPOINT_NOW', 'adapter wrong session');
  putRows([{ ...row, timestamp: new Date(now - 60001).toISOString() }]);
  check(adapter().phase === 'CHECKPOINT_NOW', 'adapter stale timestamp');
  putRows([row, { ...row, message: { usage: null } }]);
  check(adapter().phase === 'CHECKPOINT_NOW', 'latest incomplete usage cannot reuse an older record');
  putRows([{ ...row, message: { usage: { input_tokens: '1000' } } }]);
  check(adapter().phase === 'CHECKPOINT_NOW', 'adapter rejects token coercion');
  writeFileSync(transcript, JSON.stringify(row) + '\n' + 'x'.repeat(524289));
  check(adapter().phase === 'CHECKPOINT_NOW', 'bounded tail cannot reuse a record outside the window');
  writeFileSync(transcript, 'x'.repeat(524289) + '\n' + JSON.stringify(row) + '\n');
  check(adapter().used === 30000, 'bounded tail reads the latest complete record');
  console.log(`${checks} watchdog checks passed`);
} finally { rmSync(dir, { recursive: true, force: true }); }
