#!/usr/bin/env node
// watchdog.mjs — the shared brain behind every session-handoff hook.
//
// Answers one question, cheaply and repeatedly: "given where this session's
// context actually is, and what the lease says, what phase is the handoff in?"
//
// Importable  : import { evaluate } from './watchdog.mjs'
// Runnable    : node watchdog.mjs --dir .handoff [--session <id>] [--transcript <p>]
//               (always prints JSON, always exits 0 — a watchdog that crashes a
//                hook is worse than a watchdog that says "I don't know")
//
// PHASES
//   NOLEASE  — the chain was never armed. Every hook stays silent. This is
//              what "sits dormant" means: installed, inert, zero noise.
//   UNKNOWN  — armed, but context could not be measured. Silent (fail open).
//   DORMANT  — armed and measured, below the soft trigger. Silent.
//   SOFT     — start converging. Hooks inject an advisory.
//   HARD     — the successor must exist by now. Hooks escalate and enforce.
//   CEILING  — compaction is imminent or overdue. Maximum urgency.
//
// THE THRESHOLD RULE (the universal part — see README "Trigger policy")
//   Thresholds are DERIVED from the platform's real compaction point, never
//   hardcoded:
//       soft trigger  = compactionPct - 15 points
//       hard deadline = compactionPct -  5 points
//   A percentage chosen in the abstract is how the first version of this tool
//   shipped a "hard deadline" of 85% into a session that compacted at 80%.
//
// FAIL-SAFE DIRECTION
//   Unknown model -> assume the SMALLEST plausible window (200k). That makes
//   the measured percentage read HIGHER, which triggers EARLIER. Early costs
//   money; late costs the mission. But an assumed window only ever raises an
//   advisory: `enforce` stays false, so nothing blocks compaction or a stop on
//   a number that was guessed.

import { readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const WINDOWS = {
  'claude-opus-5': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-fable-5': 1_000_000,
  'claude-fable-5-1': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
};
const ASSUMED_MIN_WINDOW = 200_000;
const TAIL_BYTES = 512 * 1024;

// Chain states that mean this session is no longer the one driving the handoff.
const TERMINAL_STATES = ['TRANSFERRED', 'RELEASED', 'BLOCKED'];
// Chain states that mean a handoff is genuinely mid-flight right now.
export const IN_FLIGHT_STATES = ['WINDING_DOWN', 'DOC_WRITTEN', 'REVIEWED', 'SPAWN_REQUESTED', 'ATTESTED'];

function findTranscript(sessionId) {
  const root = join(homedir(), '.claude', 'projects');
  if (!existsSync(root)) return null;
  let projects;
  try { projects = readdirSync(root); } catch { return null; }
  const hits = [];
  for (const proj of projects) {
    const p = join(root, proj, `${sessionId}.jsonl`);
    if (existsSync(p)) hits.push(p);
  }
  // Ambiguity means we might be measuring a conversation that isn't ours.
  // Refuse rather than act on the wrong session's fullness.
  return hits.length === 1 ? hits[0] : null;
}

// Read only the tail. This runs on every tool call; slurping a 40MB transcript
// each time would make the hook itself the performance problem.
function tail(path) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const len = Math.min(size, TAIL_BYTES);
    if (len === 0) return '';
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const text = buf.toString('utf8');
    return len < size ? text.slice(text.indexOf('\n') + 1) : text;   // drop partial first line
  } finally { closeSync(fd); }
}

function lastUsage(path) {
  let lines;
  try { lines = tail(path).split('\n'); } catch { return null; }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.isSidechain === true) continue;          // subagent traffic isn't our context
    if (d.type !== 'assistant') continue;
    const u = d.message?.usage;
    if (u && (u.cache_read_input_tokens != null || u.input_tokens != null)) {
      return { usage: u, model: d.message?.model ?? null };
    }
  }
  return null;
}

export function evaluate({ dir = '.handoff', sessionId = null, transcript = null, env = process.env } = {}) {
  const out = {
    phase: 'UNKNOWN',
    pct: null, used: null, window: null, windowSource: null, model: null,
    compactionPct: null, compactionSource: null, soft: null, hard: null,
    enforce: false,
    dir, chainId: null, label: null, generation: null, fork: null, state: null,
    note: null,
  };

  // ------------------------------------------------------------ lease
  const leasePath = join(dir, 'LEASE.json');
  if (!existsSync(leasePath)) {
    out.phase = 'NOLEASE';
    out.note = 'no lease — chain not armed; watchdog is dormant';
    return out;
  }
  let lease;
  try {
    lease = JSON.parse(readFileSync(leasePath, 'utf8'));
  } catch {
    out.note = 'lease unreadable';
    return out;
  }
  out.chainId = lease.chainId ?? null;
  out.generation = lease.generation ?? null;
  out.fork = lease.fork ?? null;
  out.label = lease.label ?? (lease.generation != null ? `${lease.generation}.${lease.fork ?? 1}` : null);
  out.state = lease.state ?? null;

  if (TERMINAL_STATES.includes(out.state)) {
    out.phase = 'DORMANT';
    out.note = `lease state ${out.state} — this session no longer drives the chain`;
    return out;
  }

  // ------------------------------------------------- compaction point
  // 1. explicit config (the universal knob — any platform, any adapter)
  // 2. the platform telling us directly
  // 3. a deliberately conservative assumption
  const cfg = Number(env.HANDOFF_COMPACTION_PCT);
  const platform = Number(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
  if (Number.isFinite(cfg) && cfg > 0 && cfg <= 100) {
    out.compactionPct = cfg; out.compactionSource = 'config';
  } else if (Number.isFinite(platform) && platform > 0 && platform <= 100) {
    out.compactionPct = platform; out.compactionSource = 'platform';
  } else {
    // 70 is a compromise, not a measurement: under Claude Code's own default
    // auto-compact, under Copilot CLI's ~95%, at the top of Gemini CLI's
    // configurable compression range. Set HANDOFF_COMPACTION_PCT if your
    // platform compacts earlier than this.
    out.compactionPct = 70; out.compactionSource = 'assumed';
  }
  out.soft = Math.max(20, out.compactionPct - 15);
  out.hard = Math.max(25, out.compactionPct - 5);

  // -------------------------------------------------------- transcript
  let tpath = transcript;
  if (!tpath) {
    const sid = sessionId || env.CLAUDE_CODE_SESSION_ID;
    if (sid) tpath = findTranscript(sid);
  }
  if (!tpath || !existsSync(tpath)) {
    out.note = 'no readable transcript — cannot measure context';
    return out;
  }
  const found = lastUsage(tpath);
  if (!found) {
    out.note = 'no usage record in transcript tail';
    return out;
  }

  // Resident context = what gets re-sent every turn. output_tokens is
  // generation, not residency. Deliberately the LAST turn, never an aggregate:
  // summing usage across a transcript double-counts cache reads and wildly
  // overstates fullness.
  const u = found.usage;
  out.used = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  out.model = found.model ?? 'unknown';

  const envWindow = Number(env.HANDOFF_WINDOW_TOKENS);
  if (Number.isFinite(envWindow) && envWindow > 0) {
    out.window = envWindow; out.windowSource = 'config';
  } else if (WINDOWS[out.model]) {
    out.window = WINDOWS[out.model]; out.windowSource = 'known';
  } else {
    out.window = ASSUMED_MIN_WINDOW; out.windowSource = 'assumed-min';
  }

  out.pct = Number(((out.used / out.window) * 100).toFixed(2));

  // Enforcement (blocking compaction, blocking a stop) requires a number we
  // actually trust. A guessed window may warn; it may never block.
  out.enforce = out.windowSource !== 'assumed-min';

  if (out.pct >= out.compactionPct) out.phase = 'CEILING';
  else if (out.pct >= out.hard) out.phase = 'HARD';
  else if (out.pct >= out.soft) out.phase = 'SOFT';
  else out.phase = 'DORMANT';

  return out;
}

// ------------------------------------------------------------------ CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const argOf = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1] ?? null; };
  const r = evaluate({
    dir: argOf('--dir') || '.handoff',
    sessionId: argOf('--session'),
    transcript: argOf('--transcript'),
  });
  if (args.includes('--human')) {
    console.log(
      r.pct == null
        ? `${r.phase} — ${r.note ?? 'no measurement'}`
        : `${r.phase} — ${r.pct}% (${(r.used ?? 0).toLocaleString()}/${(r.window ?? 0).toLocaleString()}, ${r.windowSource}) · ` +
          `soft ${r.soft} / hard ${r.hard} / compaction ${r.compactionPct} (${r.compactionSource}) · ` +
          `chain ${r.label ?? '?'} state ${r.state ?? '?'} · enforce=${r.enforce}`
    );
  } else {
    console.log(JSON.stringify(r, null, 2));
  }
  process.exit(0);
}
