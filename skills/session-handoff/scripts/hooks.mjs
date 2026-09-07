#!/usr/bin/env node
// hooks.mjs — one entry point for every session-handoff hook event.
//
// Wired from the skill's own frontmatter (or from settings.json — see SKILL.md
// "Install"). Dispatches on `hook_event_name` from the JSON the harness writes
// to stdin, so four hook registrations share one file and one code path.
//
//   PostToolUse / UserPromptSubmit -> watch    : advisory injection, debounced
//   PreCompact                     -> intercept: BLOCKS auto-compaction while a
//                                                handoff is armed and unfinished
//   Stop                           -> hold     : BLOCKS stopping mid-handoff
//   SessionStart                   -> orient   : re-injects chain state
//
// WHY THIS EXISTS
//   Everything else in this skill is an instruction to a model, and a model
//   under load can miss an instruction. These hooks are run by the harness,
//   not by the model, so the trigger stops being a hope. PreCompact is the
//   important one: it fires when compaction is ACTUALLY about to happen, which
//   makes "hand off before compaction" true regardless of what percentage any
//   given platform compacts at, and regardless of whether we measured it right.
//
// EVERY BLOCK IS BOUNDED AND FAILS OPEN
//   A hook that blocks forever wedges the session it was meant to protect: a
//   full context that can never compact cannot do anything else either. Each
//   block has a small budget per generation; once spent, compaction proceeds
//   and the hook instead injects instructions to preserve the mission through
//   the summary. Refusing to be late is worth two attempts, not infinite ones.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate, IN_FLIGHT_STATES } from './watchdog.mjs';

const MAX_PRECOMPACT_BLOCKS = Number(process.env.HANDOFF_MAX_PRECOMPACT_BLOCKS ?? 2);
const MAX_STOP_BLOCKS = Number(process.env.HANDOFF_MAX_STOP_BLOCKS ?? 2);
const ADVISORY_DEBOUNCE_MS = Number(process.env.HANDOFF_ADVISORY_DEBOUNCE_MS ?? 60_000);

const DIR = process.env.HANDOFF_DIR || '.handoff';

// ------------------------------------------------------------------ io

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* tolerate */ }

const event = input.hook_event_name || process.argv[2] || 'PostToolUse';
const sessionId = input.session_id || null;

const ok = (obj) => {
  if (obj) process.stdout.write(JSON.stringify(obj));
  process.exit(0);
};
const silent = () => process.exit(0);
const block = (msg) => { process.stderr.write(msg); process.exit(2); };
const context = (text) => ok({
  hookSpecificOutput: { hookEventName: event, additionalContext: text },
});

// ------------------------------------------------------- enforcement state
// Budgets are per generation: each new generation of the chain gets a fresh
// pair of attempts, so a long chain is not penalised for an earlier one's.

const statePath = join(DIR, '.enforce-state.json');
function loadState(generation) {
  try {
    const s = JSON.parse(readFileSync(statePath, 'utf8'));
    if (s.generation === generation) return s;
  } catch { /* fall through */ }
  return { generation, precompactBlocks: 0, stopBlocks: 0, lastPhase: null, lastEmitAt: 0 };
}
function saveState(s) {
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    writeFileSync(statePath, JSON.stringify(s));
  } catch { /* a hook must never fail on bookkeeping */ }
}

// ------------------------------------------------------------- evaluate

const w = evaluate({
  dir: DIR,
  sessionId,
  // Explicit override for setups where the transcript isn't discoverable from
  // the session id alone (and for the selftest, which uses a synthetic one).
  transcript: process.env.HANDOFF_TRANSCRIPT || null,
});

// Not armed at all -> every hook is inert. This is the dormancy contract:
// install the hooks once, they cost nothing until a chain is actually armed.
if (w.phase === 'NOLEASE') silent();

const st = loadState(w.generation);
const chain = `chain ${w.chainId ?? '?'} · session ${w.label ?? '?'} · state ${w.state ?? '?'}`;
const reading = w.pct == null
  ? `context: unmeasured (${w.note ?? 'no reading'})`
  : `context: ${w.pct}% of ${(w.window ?? 0).toLocaleString()} (${w.windowSource}); ` +
    `soft ${w.soft}% · hard ${w.hard}% · compaction ${w.compactionPct}% (${w.compactionSource})`;

// The successor's label is always the next generation, first fork.
const nextLabel = w.generation != null ? `${w.generation + 1}.1` : 'N+1.1';

// ---------------------------------------------------------------- events

switch (event) {

  // -------------------------------------------------- PreCompact: the guarantee
  case 'PreCompact': {
    const auto = String(input.compaction_reason ?? 'auto').toLowerCase() !== 'manual';
    const unfinished = !['TRANSFERRED', 'RELEASED', 'BLOCKED'].includes(w.state);

    // A human typing /compact is a decision, not an accident. Never block it.
    if (!auto) {
      context(
        `[session-handoff] Manual compaction — not blocked. ${chain}. ` +
        `The mission prompt in ${DIR}/mission.txt and the lease in ${DIR}/LEASE.json ` +
        `survive on disk; re-read them after compaction before doing any mission work.`
      );
    }

    if (unfinished && st.precompactBlocks < MAX_PRECOMPACT_BLOCKS) {
      st.precompactBlocks += 1;
      saveState(st);
      block(
        `AUTO-COMPACTION BLOCKED by session-handoff ` +
        `(attempt ${st.precompactBlocks} of ${MAX_PRECOMPACT_BLOCKS}).\n\n` +
        `${chain}\n${reading}\n\n` +
        `Compaction is what this chain exists to get ahead of, and it was about to fire. ` +
        `Do the handoff NOW, in this turn, before doing anything else:\n` +
        `  1. Stop expanding. Checkpoint in place (commit or describe the dirty state precisely).\n` +
        `  2. Write the continuation document from HANDOFF-TEMPLATE.md — mission prompt VERBATIM.\n` +
        `  3. Skip the durability review if you must; the deadline outranks it now.\n` +
        `  4. lease.sh next-gen ${DIR} <your-session-id>   (successor will be ${nextLabel})\n` +
        `  5. lease.sh state ${DIR} <your-session-id> SPAWN_REQUESTED, then call create_session ` +
        `with title "<mission> — ${nextLabel}".\n` +
        `  6. Attest via get_session on the new id, stop your loop, then lease.sh transfer.\n\n` +
        `After ${MAX_PRECOMPACT_BLOCKS} attempts this block will NOT be granted again and ` +
        `compaction will proceed — losing the fidelity this chain was armed to protect.`
      );
    }

    // Budget spent, or the chain is already finished: let compaction through,
    // but aim the summariser at what actually has to survive it.
    context(
      `[session-handoff] Auto-compaction proceeding` +
      (unfinished ? ` — block budget (${MAX_PRECOMPACT_BLOCKS}) exhausted; the handoff did NOT complete.` : `.`) +
      `\n${chain}\n${reading}\n\n` +
      `PRESERVE THROUGH THIS SUMMARY, VERBATIM AND IN FULL: the mission prompt ` +
      `(${DIR}/mission.txt), the lease state, the current branch and uncommitted work, ` +
      `and any continuation document path. After compaction, re-read ${DIR}/LEASE.json ` +
      `before touching the mission — if this session is not the owner, stop.`
    );
    break;
  }

  // ------------------------------------------------------- Stop: don't stop mid-handoff
  case 'Stop': {
    const midHandoff = IN_FLIGHT_STATES.includes(w.state);
    const pastDeadline = w.enforce && (w.phase === 'HARD' || w.phase === 'CEILING');

    if ((midHandoff || pastDeadline) && st.stopBlocks < MAX_STOP_BLOCKS) {
      st.stopBlocks += 1;
      saveState(st);
      block(
        `STOP BLOCKED by session-handoff (attempt ${st.stopBlocks} of ${MAX_STOP_BLOCKS}).\n\n` +
        `${chain}\n${reading}\n\n` +
        (midHandoff
          ? `A handoff is mid-flight — lease state is ${w.state}, not TRANSFERRED. Stopping here ` +
            `leaves the chain with no live owner and the mission half-written. Finish it: ` +
            `document -> next-gen -> create_session (title "<mission> — ${nextLabel}") -> attest -> transfer.`
          : `You are past the hard deadline (${w.hard}%) and the handoff has not started. ` +
            `Begin it now rather than ending the turn: wind down, write the continuation document, ` +
            `spawn ${nextLabel}, attest, transfer.`) +
        `\n\nIf the handoff genuinely cannot proceed, say so explicitly and run ` +
        `lease.sh state ${DIR} <your-session-id> BLOCKED — a failed handoff must be loud, not silent. ` +
        `That releases this hook.`
      );
    }
    silent();
    break;
  }

  // ------------------------------------------- SessionStart: orient a fresh context
  case 'SessionStart': {
    const doc = existsSync(join(DIR, 'CONTINUATION.md')) ? `${DIR}/CONTINUATION.md` : null;
    context(
      `[session-handoff] An armed handoff chain exists in ${DIR}.\n` +
      `${chain}\n${reading}\n` +
      `Mission prompt: ${DIR}/mission.txt` + (doc ? `\nContinuation document: ${doc}` : '') + `\n\n` +
      `THE ONE RULE: read ${DIR}/LEASE.json before any mission work. If ownerSessionId is not ` +
      `this session, you are superseded — say so and stop, do not edit the same repository as ` +
      `the current owner.`
    );
    break;
  }

  // ---------------------------------------- PostToolUse / UserPromptSubmit: advisory
  default: {
    if (!['SOFT', 'HARD', 'CEILING'].includes(w.phase)) silent();

    // Debounce: repeat the same phase at most once a minute, but never swallow
    // an escalation — the first HARD after a SOFT always gets through.
    const now = Date.now();
    const escalated = w.phase !== st.lastPhase;
    if (!escalated && now - (st.lastEmitAt ?? 0) < ADVISORY_DEBOUNCE_MS) silent();
    st.lastPhase = w.phase;
    st.lastEmitAt = now;
    saveState(st);

    const head = {
      SOFT: `[session-handoff] SOFT TRIGGER — start converging.`,
      HARD: `[session-handoff] HARD DEADLINE — the successor must exist and be attested NOW.`,
      CEILING: `[session-handoff] CEILING — compaction is imminent or overdue. You are late.`,
    }[w.phase];

    const body = {
      SOFT: `Start nothing new. Drain in-flight work to a checkpoint, then write the continuation ` +
            `document from HANDOFF-TEMPLATE.md (mission prompt VERBATIM) and run the durability ` +
            `review. Successor will be ${nextLabel}.`,
      HARD: `Stop converging and checkpoint in place. At most one review round. ` +
            `next-gen -> create_session (title "<mission> — ${nextLabel}") -> attest -> stop your ` +
            `loop -> transfer.`,
      CEILING: `Skip the review entirely. Write the document, spawn ${nextLabel}, attest, transfer. ` +
            `If you cannot, set the lease to BLOCKED and tell the user plainly.`,
    }[w.phase];

    context(`${head}\n${chain}\n${reading}\n\n${body}`);
  }
}

silent();
