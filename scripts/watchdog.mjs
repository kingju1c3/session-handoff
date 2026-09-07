#!/usr/bin/env node
// Host-neutral context policy. A valid measurement can guide a handoff; it
// cannot veto compaction or prove that the host will wait for the next hook.
// node scripts/watchdog.mjs --dir .handoff --session ID --signal signal.json

import { openSync, readSync, closeSync, fstatSync, constants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAIL_BYTES = 512 * 1024;
const SIGNAL_BYTES = 64 * 1024;
const TERMINAL_STATES = ['TRANSFERRED', 'RELEASED', 'BLOCKED'];
export const IN_FLIGHT_STATES = ['WINDING_DOWN', 'DOC_WRITTEN', 'REVIEWED', 'SPAWN_REQUESTED', 'ATTESTED'];

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${name} must be an object`);
  return value;
}

function number(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw Error(`${name} must be a finite nonnegative number`);
  }
  return value;
}

// Environment variables are strings by definition. Parse only an explicit
// decimal representation, never JS coercions such as empty strings or true.
function envNumber(env, key) {
  if (env[key] === undefined) return undefined;
  const value = env[key];
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    throw Error(`${key} must be an explicit nonnegative decimal`);
  }
  return number(Number(value), key);
}

function present(value) { return value !== undefined; }
function same(a, b) { return Math.abs(a - b) <= 16 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)); }

function percent(signal, key, window) {
  const tokens = signal[`${key}_tokens`];
  const pct = signal[`${key}_pct`];
  if (!present(tokens) && !present(pct)) {
    throw Error(`missing ${key} measurement or budget`);
  }
  let fromTokens;
  if (present(tokens)) {
    number(tokens, `${key}_tokens`);
    if (!window) throw Error(`${key}_tokens requires window_tokens`);
    fromTokens = number(tokens / window * 100, `${key} percentage`);
  }
  if (present(pct)) number(pct, `${key}_pct`);
  if (present(fromTokens) && present(pct) && !same(fromTokens, pct)) {
    throw Error(`contradictory ${key}_tokens and ${key}_pct`);
  }
  return present(pct) ? pct : fromTokens;
}

function timestamp(value, name) {
  const fields = typeof value === 'string' && /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!fields) {
    throw Error(`${name} must be an ISO timestamp with timezone`);
  }
  const [year, month, day, hour, minute, second] = fields.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) {
    throw Error(`${name} is invalid`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw Error(`${name} is invalid`);
  return parsed;
}

// Bounded reads, including the transcript adapter. An oversized single record
// is unavailable telemetry, rather than permission to read an unbounded file.
function readBounded(path, maximum, tail = false) {
  // O_NONBLOCK lets fstat reject a FIFO without hanging while waiting for its
  // writer. Explicit symlink paths are allowed; their target must be regular.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw Error('input is not a regular file');
    if (!tail && stat.size > maximum) throw Error('input exceeds size limit');
    const length = Math.min(stat.size, maximum);
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, stat.size - length);
    let text = buffer.subarray(0, read).toString('utf8');
    if (tail && stat.size > maximum) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline < 0 ? '' : text.slice(firstNewline + 1);
    }
    return text;
  } finally { closeSync(fd); }
}

function claudeSignal(path, sessionId, env) {
  const lines = readBounded(path, TAIL_BYTES, true).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let row;
    try { row = JSON.parse(lines[i]); } catch { throw Error('malformed transcript tail; usage may be incomplete'); }
    if (row.isSidechain === true || row.type !== 'assistant') continue;
    if (row.sessionId !== sessionId) throw Error('transcript session does not match caller');
    const usage = row.message?.usage;
    object(usage, 'transcript usage');
    // Claude's input_tokens excludes cache reads/creation. Add each once from
    // the latest assistant request only; never sum requests or output_tokens.
    let used = number(usage.input_tokens, 'transcript input_tokens');
    for (const key of ['cache_read_input_tokens', 'cache_creation_input_tokens']) {
      if (present(usage[key])) used += number(usage[key], `transcript ${key}`);
    }
    number(used, 'transcript total input tokens');
    return {
      session_id: row.sessionId, observed_at: row.timestamp,
      source: { kind: 'host', name: 'claude-transcript' },
      used_tokens: used,
      window_tokens: envNumber(env, 'HANDOFF_WINDOW_TOKENS'),
      compaction_pct: envNumber(env, 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'),
      next_step_tokens: envNumber(env, 'HANDOFF_NEXT_STEP_TOKENS'),
      next_step_pct: envNumber(env, 'HANDOFF_NEXT_STEP_PCT'),
      reserve_tokens: envNumber(env, 'HANDOFF_RESERVE_TOKENS'),
      reserve_pct: envNumber(env, 'HANDOFF_RESERVE_PCT'),
      model: typeof row.message?.model === 'string' ? row.message.model : null,
    };
  }
  throw Error('no assistant usage in bounded transcript tail');
}

export function evaluate({ dir = '.handoff', sessionId = null, transcript = null,
  signal = undefined, signalPath = null, env = process.env, now = Date.now() } = {}) {
  const out = {
    phase: 'CHECKPOINT_NOW',
    pct: null, used: null, window: null, windowSource: null, model: null,
    compactionPct: null, compactionSource: null, soft: null, hard: null,
    nextStepPct: null, reservePct: null, projectedPct: null,
    source: null, observedAt: null,
    // Compatibility field: true means measured policy is eligible for host
    // enforcement of ordinary actions. It never means compaction is vetoable.
    enforce: false, compactionVeto: false,
    dir, chainId: null, label: null, generation: null, fork: null, state: null,
    note: null,
  };
  try {
    object(env, 'environment');
    number(now, 'now');
    if (typeof dir !== 'string' || !dir) throw Error('handoff directory missing');
    let lease;
    try { lease = JSON.parse(readBounded(join(dir, 'LEASE.json'), SIGNAL_BYTES)); }
    catch (error) {
      if (error.code === 'ENOENT') {
        out.phase = 'NOLEASE';
        out.note = 'no lease — chain not armed; watchdog is dormant';
        return out;
      }
      throw Error('lease unreadable or invalid');
    }
    object(lease, 'lease');
    out.chainId = lease.chainId ?? null;
    out.generation = lease.generation ?? null;
    out.fork = lease.fork ?? null;
    out.label = lease.label ?? (lease.generation != null ? `${lease.generation}.${lease.fork ?? 1}` : null);
    out.state = lease.state ?? null;
    const sid = sessionId ?? env.HANDOFF_SESSION_ID ?? env.CLAUDE_CODE_SESSION_ID;
    if (typeof sid !== 'string' || !sid.trim()) throw Error('caller session ID required');
    if (typeof lease.ownerSessionId === 'string' && lease.ownerSessionId !== sid) {
      out.phase = 'SUPERSEDED';
      out.note = 'caller is not the lease owner; stop mission work';
      return out;
    }
    if (TERMINAL_STATES.includes(out.state)) {
      out.phase = 'DORMANT';
      out.note = `lease state ${out.state} — this session no longer drives the chain`;
      return out;
    }
    if (typeof lease.ownerSessionId !== 'string' || !lease.ownerSessionId.trim()) throw Error('lease owner missing');

    let measurement = signal;
    const path = signalPath ?? env.HANDOFF_CONTEXT_SIGNAL;
    if (!present(measurement) && present(path) && path !== null) {
      if (typeof path !== 'string' || !path) throw Error('context signal path missing');
      try { measurement = JSON.parse(readBounded(path, SIGNAL_BYTES)); }
      catch { throw Error('context signal file unreadable or invalid'); }
    }
    const transcriptPath = transcript ?? env.HANDOFF_TRANSCRIPT;
    if (!present(measurement) && transcriptPath) measurement = claudeSignal(transcriptPath, sid, env);
    object(measurement, 'context signal');
    if (measurement.session_id !== sid) throw Error('signal session does not match active owner');
    const source = object(measurement.source, 'signal source');
    if (source.kind !== 'host' || typeof source.name !== 'string' || !source.name.trim()) {
      throw Error('signal source requires kind host and a nonempty name');
    }
    out.source = { kind: source.kind, name: source.name, trust: 'caller-reported; not authenticated' };
    const observed = timestamp(measurement.observed_at, 'observed_at');
    const maximumAge = envNumber(env, 'HANDOFF_SIGNAL_MAX_AGE_MS') ?? 60_000;
    if (observed > now) throw Error('context signal timestamp is in the future');
    if (now - observed > maximumAge) throw Error('context signal is stale');
    out.observedAt = measurement.observed_at;
    if (present(measurement.window_tokens)) {
      out.window = number(measurement.window_tokens, 'window_tokens');
      if (out.window === 0) throw Error('window_tokens must be positive');
      out.windowSource = source.name === 'claude-transcript' ? 'config' : 'signal';
    }
    out.pct = percent(measurement, 'used', out.window);
    out.used = present(measurement.used_tokens) ? measurement.used_tokens : null;
    out.model = typeof measurement.model === 'string' ? measurement.model : null;
    const hostCompaction = percent(measurement, 'compaction', out.window);
    if (hostCompaction <= 0 || hostCompaction > 100) throw Error('compaction percentage must be greater than 0 and at most 100');
    const configured = envNumber(env, 'HANDOFF_COMPACTION_PCT');
    if (present(configured) && (configured <= 0 || configured > 100)) throw Error('HANDOFF_COMPACTION_PCT must be greater than 0 and at most 100');
    out.compactionPct = present(configured) ? Math.min(hostCompaction, configured) : hostCompaction;
    out.compactionSource = present(configured) && configured < hostCompaction ? 'config-cap' : 'host-signal';
    // Preserve familiar 15/5-point margins when space permits; scale them down
    // for hosts that compact early. Both deadlines always precede compaction.
    const c = out.compactionPct;
    out.soft = c - Math.min(15, c * 0.25);
    out.hard = c - Math.min(5, c * 0.10);
    if (!(0 < out.soft && out.soft < out.hard && out.hard < c)) throw Error('compaction threshold too small to represent safe margins');
    out.nextStepPct = percent(measurement, 'next_step', out.window);
    out.reservePct = percent(measurement, 'reserve', out.window);
    if (out.reservePct === 0) throw Error('handoff reserve must be positive');
    out.projectedPct = number(out.pct + out.nextStepPct + out.reservePct, 'projected usage');
    out.enforce = true;
    if (out.projectedPct >= c) out.phase = 'CEILING';
    else if (out.projectedPct >= out.hard) out.phase = 'HARD';
    else if (out.projectedPct >= out.soft) out.phase = 'SOFT';
    else out.phase = 'DORMANT';
    out.note = 'policy uses current usage plus the declared next-action and handoff reserve; host timing is not guaranteed';
  } catch (error) {
    out.phase = 'CHECKPOINT_NOW';
    out.enforce = false;
    out.note = `${error.message}; write a durable checkpoint now and use a fresh session when available (best effort)`;
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const argOf = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1] ?? ''; };
  const result = evaluate({
    dir: argOf('--dir') ?? '.handoff', sessionId: argOf('--session'),
    transcript: argOf('--transcript'), signalPath: argOf('--signal'),
  });
  if (args.includes('--human')) {
    console.log(`${result.phase} — ${result.pct === null ? 'unmeasured' : `${result.pct}% used, ${result.projectedPct ?? '?'}% budgeted`} · ${result.note}`);
  } else console.log(JSON.stringify(result, null, 2));
}
