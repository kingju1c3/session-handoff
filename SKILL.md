---
name: session-handoff
description: Preserve a mission before context compaction or truncation, then continue in a fresh session or a verified context-saving fork. Use when the user says session handoff, fork before compaction, continue in a new session, or keep this mission going across context windows; also at each preflight while an explicitly armed handoff is active. Adapts to host capabilities and real context limits rather than model names or one fixed percentage. Produces a durable checkpoint and resume prompt even in a plain chat with no tools. Installing, reviewing, or improving this skill does not arm it or authorize spawning sessions.
compatibility: Instructions work as text with any assistant that can follow them. Optional local helpers require Node.js, Python 3, and a POSIX shell; automated rotation requires host telemetry and session controls.
---

# Session Handoff

Preserve the work **before** compaction, give the successor room to work, and transfer one owner's responsibility. This is a continuity protocol, not a promise that every host exposes control over its context window.

## 1. Discover capabilities and arm within the user's scope

Read the current task, governing instructions, and available tools. An explicit request to keep a mission going through handoffs authorizes that workflow within the existing environment and permissions. Installation or a long conversation alone does not. Never create a goal, schedule, terminal, task, cloud session, or fork merely because the skill was loaded.

Record this capability inventory in the checkpoint:

| Capability | Evidence to collect |
| --- | --- |
| Detect | Active session ID, current resident context, effective window, actual earliest compaction/truncation boundary, observation time and source |
| Preflight | Can the host check **before** every model/tool action and bound its output? |
| Checkpoint | Shared private files, downloadable artifact, or a copyable text document |
| Continue | Available fresh-session tool; native fork semantics; target environment and access |
| Attest | Host-created session identity/status and successor acknowledgment of the exact checkpoint |
| Enforce | Which installed hook can delay a request/compaction, its return schema, and an observed smoke test |

Use [host notes](references/hosts.md) only for the selected host. Inspect current tool schemas/help before choosing an API; tool names and availability differ between apps using the same model. Record unsupported or unknown capabilities honestly. Do not infer a model's effective window from its name or marketing context size.

With shared local files, create a private `.handoff/` directory and save the user's mission, constraints, accepted corrections, and concrete completion criteria. Preserve non-secret mission wording; replace secrets with named requirements for secure re-provisioning. Keep runtime artifacts out of version control. Resolve helper paths from **this skill directory**, not the project's working directory.

```sh
# Replace uppercase placeholders with verified values. PID 0 means unavailable.
sh /ABSOLUTE/SKILL/DIR/scripts/lease.sh init /ABSOLUTE/PROJECT/.handoff SESSION_ID 0 5
```

The default chain cap is five total generations. Honor explicit user limits; do not reset a chain to evade a cap. Before every mission write, read the lease and verify ownership. Stop superseded writers. If multiple hosts cannot share an atomic lease, use an existing coordinator or explicit user-mediated transfer; a copied lease is a snapshot, not a distributed lock.

Without filesystem/tools, start a copyable checkpoint immediately and state that rotation is user-mediated. Do not invent a token count or claim automatic monitoring.

## 2. Budget before the next action

Check at the start of every active turn, **before** a potentially large tool response, before spawning a batch, and after each result. A post-tool warning cannot protect the action that already overflowed the window.

Use the earliest boundary the host may apply, including tool/model routing changes and output reservations. Refresh telemetry when the model, host, or settings change. Count current resident context, not cumulative billed tokens. Cap large results, save them externally, and budget the bounded result plus reasoning/output and handoff work.

The optional [signal contract](references/context-signal.md) feeds the same policy from any host:

```sh
node /ABSOLUTE/SKILL/DIR/scripts/watchdog.mjs \
  --dir /ABSOLUTE/PROJECT/.handoff --session SESSION_ID \
  --signal /ABSOLUTE/PRIVATE/context.json --human
```

The policy derives margins from the measured boundary, including very small boundaries; it has no universal 70%, 85%, or guessed model window. Configured safety caps move handoff earlier, never later than a reported boundary. Reserve enough for checkpoint writing, one bounded review if feasible, successor bootstrap, acknowledgment, and transfer. A default margin is a policy choice, not proof that those operations fit.

| Result | Action |
| --- | --- |
| `NOLEASE` | Unarmed; no automatic action |
| `DORMANT` | Continue only the bounded next step; keep the checkpoint current |
| `SOFT` | Stop expanding. Drain existing work within the remaining budget and checkpoint |
| `HARD` | Stop convergence. Save partial work and perform the transfer now |
| `CEILING` | Boundary reached or next action would exhaust the reserved budget. Skip optional review, checkpoint and rotate; report a late trigger if already over the actual boundary |
| `CHECKPOINT_NOW` | Missing, inconsistent, wrong-session, stale telemetry, unknown boundary, or missing output budget: checkpoint **now**, before more work |
| `SUPERSEDED` | Stop mission work; only the current owner may continue |

When a reading is unavailable, use an explicitly labeled **best-effort mode**: checkpoint on activation and after every meaningful change, before large input/output and before model switches. Prefer a fresh session immediately after that checkpoint; if neither telemetry nor fresh-session controls exist, show the resume artifact and stop for the user to open a new chat. Do not wait for a guessed percentage or claim a turn-count heuristic guarantees safety. Unknown status never means plenty of room.

Use a pre-compaction hook only as a last warning. It may be asynchronous, advisory, non-vetoable, or too late to bootstrap a successor. Report enforcement only when the installed host supports the specific event's return schema and a local smoke test confirms it. Hook registration and a passing unit test do not prove a live rotation.

## 3. Freeze and write the continuation

Stop new workstreams. Account for each in-flight process and worker: finished, cancelled, or still active with exact identity and a bounded next step. Stop or quiesce writers before transfer; never kill unrelated work. Preserve dirty files, staged state, untracked files and unsaved artifacts. A new worktree, branch, cloud session or fork may not inherit them.

For a local lease, mark the freeze before writing the checkpoint:

```sh
sh /ABSOLUTE/SKILL/DIR/scripts/lease.sh state /ABSOLUTE/PROJECT/.handoff SESSION_ID WINDING_DOWN
```

Write a dated, versioned continuation using [HANDOFF-TEMPLATE.md](HANDOFF-TEMPLATE.md), with a small resume prompt at the top. Save and re-read it before trusting it. Include:

- Mission, user corrections, constraints, approvals and completion criteria.
- Verified state versus assumptions, with evidence paths, commands/results and timestamps.
- Exact project/workspace identity and relevant files. For Git projects record branch, HEAD, dirty/staged/untracked state; for other tasks use artifact identifiers and versions.
- Decisions and reasons, failed approaches, known risks, active workers and partial work.
- Literal next actions, blockers, missing access and things the successor must not change.
- Capability inventory, telemetry provenance, safety budgets, mode (new/fork/manual), chain owner and candidate identities.
- Transferred artifact manifest and verification results. After freezing the final checkpoint bytes, compute its digest and put that digest in a **separate** control/manifest artifact and the successor's bootstrap message. Do not embed a whole-file digest inside the file it hashes. A hash detects a change; it does not prove truth or completeness.

Do not copy secret-bearing environment dumps, auth tokens, private keys, or unrelated personal data. A handoff preserves necessary task state, not every token of a transcript. Never promise mathematical losslessness from a summary. Preserve relevant source artifacts and explicit omissions so missing detail is recoverable.

## 4. Review while there is room

If a separate reviewer is available within the measured reserve, provide the checkpoint plus a concise inventory of actual session work. Keep review read-only and bounded. Check mission fidelity, executable next steps, evidence accuracy, omissions, dirty-work preservation, permissions/secrets, and unresolved risk. Save objections and resolutions. Recheck the checkpoint hash and file state afterward; changes invalidate the review of that version.

At the hard boundary allow at most one review round. If review would delay rotation, skip it, record why, and make the successor's first task verify unresolved items. Missing approval is never treated as approval. A review can assess content; it cannot attest to session liveness.

After saving and re-reading the checkpoint, mark it written:

```sh
sh /ABSOLUTE/SKILL/DIR/scripts/lease.sh state /ABSOLUTE/PROJECT/.handoff SESSION_ID DOC_WRITTEN
```

Mark `REVIEWED` only after completed review. The lease permits candidate reservation from either state so review cannot force a late handoff. Any checkpoint revision requires a fresh detached digest and renewed acknowledgment of that version.

## 5. Choose a fresh session or a fork

**Prefer a fresh session** seeded with the minimal resume prompt and accessible checkpoint. It must have the project files, artifacts and sufficient measured headroom to resume. Use only a currently callable host tool or verified CLI argument vector, preserving the current or explicitly chosen model, permissions, approvals, billing limits and target environment. Do not weaken trust settings to launch it or pass mission/secrets through shell interpolation or process arguments.

**A native fork is eligible only if it gives verified usable context headroom.** Many forks copy conversation history. A fork of a full session can therefore remain full. Check the host's semantics and the candidate's actual context. If history is retained or relief is unknown, use a fresh session; if neither is available, deliver the manual resume artifact. Forking and then compacting is not a pre-compaction handoff. A subagent is not automatically a durable successor, and resume of the old session is not a fresh context.

For a native fork, finish the checkpoint and current turn before the fork if the host copies completed history only. Do not assume the in-progress message is included. Pass the exact checkpoint through a verified follow-up path if needed. A new checkout/remote target must receive required dirty and untracked artifacts through an authorized mechanism before acknowledgment.

Reserve one candidate **before** launch:

```sh
sh /ABSOLUTE/SKILL/DIR/scripts/lease.sh next-gen /ABSOLUTE/PROJECT/.handoff SESSION_ID
```

This records `SPAWN_REQUESTED` and a pending label atomically. A native fork uses the same next-generation reservation. It does not create an extra mission owner. Parallel workers need distinct assigned scopes; `next-fork` does not grant overlapping ownership.

If launch fails definitively with no created session, record `spawn-failed … confirmed-absent`. If it times out or the outcome is uncertain, inspect the host before retrying and record `spawn-failed … unknown` meanwhile. Keep the reservation and predecessor ownership; never create a second candidate blindly. At the chain cap, deliver the checkpoint and stop automatic spawning.

## 6. Attest, transfer, and stop the predecessor

The successor's bootstrap is read-only: load the checkpoint, compare artifacts and project state, verify uncertain claims, and wait for ownership before mission edits. It should acknowledge the checkpoint hash, workspace identity, exact candidate/session identity, usable context headroom and literal first action. Use host-reported identity/status independently of the successor's narrative. A create response alone means requested/created, not ready.

When both checks succeed, the predecessor records the exact candidate:

```sh
sh /ABSOLUTE/SKILL/DIR/scripts/lease.sh attest /ABSOLUTE/PROJECT/.handoff SESSION_ID CANDIDATE_ID
sh /ABSOLUTE/SKILL/DIR/scripts/lease.sh transfer /ABSOLUTE/PROJECT/.handoff SESSION_ID CANDIDATE_ID 0
```

The lease verifies ordering and candidate binding. It cannot query a remote host or authenticate the caller's attestation; record external evidence separately. Stop the predecessor's recurring loop and account for its writers before transfer. The successor re-reads ownership, changes its `TRANSFERRED` state to `OWNED`, and resumes only after it owns the lease; the predecessor reports the result and performs no more mission edits.

If acknowledgment, context headroom or artifact access is missing, retain ownership and report the exact blocker. Recovery requires fresh evidence that the expected old owner is stopped, plus the guarded `recover` command; never steal from a live owner or reuse a released chain. With no shared coordinator, the user explicitly confirms old-session stop and new-session takeover.

## 7. Report the observed outcome

Distinguish **checkpoint saved**, **spawn requested**, **candidate ready**, **ownership transferred**, and **manual action required**. Link the checkpoint and successor when available. Report incomplete checks. An unexpected compaction means prevention failed: reopen the last checkpoint and lease, reconcile current state, and disclose the gap before continuing. Never relabel recovery after compaction as successful prevention.

Installing this skill does not register every host's hooks, start a daemon, or make it resident in an already running model. Use the host's reload mechanism and verify discovery. Keep automated launch conditional on available, tested host capabilities. The text protocol remains usable when none are available.
