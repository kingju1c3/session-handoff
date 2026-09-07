#!/usr/bin/env node
// context-check.mjs — report how full a Claude Code session's context window is.
//
// Usage:
//   node context-check.mjs                    # uses $CLAUDE_CODE_SESSION_ID
//   node context-check.mjs <session-id>
//   node context-check.mjs --transcript <path.jsonl>
//   node context-check.mjs --json
//
// Prints (human):  15.51% full — 155,077 of 1,000,000 tokens (claude-opus-5)
// Prints (--json): {transcript, model, contextTokens, windowTokens, percent, breakdown}
//
// Exit codes — FAIL CLOSED. A handoff must never fire on a guessed number.
//   0  reading succeeded
//   2  no transcript found / not readable
//   3  transcript has no usage data yet
//   4  a session id was given but no transcript exists for it   (never falls back)
//   5  the model is unknown, so the window size would be a guess (never guesses)
//   6  the session id matches transcripts in MORE THAN ONE project — ambiguous,
//      so it refuses to guess; pass --transcript to disambiguate
//
// Method: sums input_tokens + cache_read_input_tokens + cache_creation_input_tokens
// from the MOST RECENT assistant turn. output_tokens is excluded — it is generation,
// not resident context. Deliberately the last turn, not an aggregate: aggregate usage
// across a transcript double-counts cache reads and badly overstates fullness.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Auto-compaction windows per model — the point at which the harness itself
// intervenes, which is what a handoff should be measured against.
// Verified 2026-08-15: claude-opus-5 reported 156.8k/1m by /context while this
// script computed 155,077 — agreement within rounding.
const WINDOWS = {
  'claude-opus-5': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-fable-5': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
};

const args = process.argv.slice(2);
const asJson = args.includes('--json');

function die(code, obj, human) {
  console.error(asJson ? JSON.stringify(obj) : human);
  process.exit(code);
}

function findTranscript(sessionId) {
  const root = join(homedir(), '.claude', 'projects');
  if (!existsSync(root)) return null;
  const matches = [];
  for (const proj of readdirSync(root)) {
    const p = join(root, proj, `${sessionId}.jsonl`);
    if (existsSync(p)) {
      let m = 0;
      try { m = statSync(p).mtimeMs; } catch { /* ignore */ }
      matches.push({ p, m });
    }
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    // FAIL CLOSED: two projects claiming the same session id means we cannot
    // know which conversation we are measuring — and measuring the wrong one
    // fires (or suppresses) a handoff against the wrong session. Refuse and
    // make the caller disambiguate explicitly.
    die(6,
      { error: 'session id matches multiple transcripts — refusing to guess', sessionId, paths: matches.map((x) => x.p) },
      `session id ${sessionId} matches ${matches.length} transcripts across projects — refusing to guess:\n` +
      matches.map((x) => `  ${x.p}`).join('\n') +
      `\nPass --transcript <path> to pick one explicitly.`);
  }
  return matches[0].p;
}

function newestTranscript() {
  const root = join(homedir(), '.claude', 'projects');
  if (!existsSync(root)) return null;
  let best = null;
  for (const proj of readdirSync(root)) {
    let entries;
    try { entries = readdirSync(join(root, proj)); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const p = join(root, proj, f);
      let m;
      try { m = statSync(p).mtimeMs; } catch { continue; }
      if (!best || m > best.m) best = { p, m };
    }
  }
  return best?.p ?? null;
}

// Walk backwards — the newest usage record wins and transcripts get large.
function lastUsage(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.isSidechain === true) continue;
    if (d.type !== 'assistant') continue;
    const msg = d.message;
    if (msg?.usage && (msg.usage.cache_read_input_tokens != null || msg.usage.input_tokens != null)) {
      return { usage: msg.usage, model: msg.model ?? null };
    }
  }
  return null;
}

let transcript = null;
const tIdx = args.indexOf('--transcript');
if (tIdx !== -1) transcript = args[tIdx + 1];

if (!transcript) {
  // Positional args only. Never treat the value of --transcript as a session id.
  const positional = args.filter((a, i) => !a.startsWith('--') && !(tIdx !== -1 && i === tIdx + 1));
  const sid = positional[0] || process.env.CLAUDE_CODE_SESSION_ID;
  if (sid) {
    transcript = findTranscript(sid);
    // Never silently fall back to another session — reporting the wrong session's
    // fullness would fire a handoff against the wrong conversation.
    if (!transcript) {
      die(4, { error: 'no transcript for session id', sessionId: sid },
          `no transcript for session id: ${sid}`);
    }
  } else {
    transcript = newestTranscript();
  }
}

if (!transcript || !existsSync(transcript)) {
  die(2, { error: 'transcript not found' },
      'transcript not found — pass a session id or --transcript <path>');
}

const found = lastUsage(transcript);
if (!found) {
  die(3, { error: 'no usage data in transcript', transcript },
      `no usage data yet in ${transcript}`);
}

const u = found.usage;
const used =
  (u.input_tokens ?? 0) +
  (u.cache_read_input_tokens ?? 0) +
  (u.cache_creation_input_tokens ?? 0);

const model = found.model ?? 'unknown';
const windowTokens = WINDOWS[model];

// FAIL CLOSED: an unknown model means an unknown window, which means the
// percentage would be fiction. Refuse rather than hand off on a guess.
if (!windowTokens) {
  die(5, { error: 'unknown model — refusing to guess window size', model, contextTokens: used },
      `unknown model '${model}' — refusing to guess a context window. ` +
      `Add it to WINDOWS in ${import.meta.url.replace('file://', '')}`);
}

// The real auto-compaction point, when the harness exposes it. This is the number every
// handoff threshold should be derived from; a hardcoded 85% was observed to sit ABOVE an
// actual 80% compaction point, which defeats the whole skill. null means unknown — the
// caller must fall back to conservative defaults, not assume.
const autocompactRaw = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
const autocompactPct = autocompactRaw !== undefined && autocompactRaw !== '' && !Number.isNaN(Number(autocompactRaw))
  ? Number(autocompactRaw)
  : null;

const out = {
  transcript,
  model,
  contextTokens: used,
  windowTokens,
  percent: Number(((used / windowTokens) * 100).toFixed(2)),
  autocompactPct,
  breakdown: {
    input: u.input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheCreation: u.cache_creation_input_tokens ?? 0,
  },
};

console.log(
  asJson
    ? JSON.stringify(out, null, 2)
    : `${out.percent}% full — ${used.toLocaleString()} of ${windowTokens.toLocaleString()} tokens (${model})`
);
