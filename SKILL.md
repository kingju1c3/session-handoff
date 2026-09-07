---
name: session-handoff
description: Carry a mission into a fresh session before context compaction or truncation in a desktop or browser AI app. Use when the user asks for session handoff, a fresh session, fork before compaction, or continued work across context windows; also check before each substantial action while explicitly armed. This self-contained skill includes its complete checkpoint, review, successor startup, and ownership protocol. Use native host controls when available, otherwise deliver a complete copyable handoff. Installing, reading, or editing the skill does not arm it.
compatibility: The complete skill works as instructions in desktop and browser AI apps. Its bundled single-file JavaScript runtime uses standard ECMAScript and Web Crypto, with no third-party runtime dependencies.
---

# Session Handoff

Continue the same mission in a session with room to work. Save the context **before** compaction, verify what arrived, and let only one session own the mission.

Everything needed for the workflow is in this file. The bundled `session-handoff.mjs` implements the same lifecycle for hosts that can execute JavaScript. Never require a companion skill, a shell, a particular vendor, or a private path to use this skill.

## 1. Activate and establish the owner

Activate only for a user's handoff/continuity request or an already armed mission. Keep the user's original objective and accepted corrections. Do not replace their mission with the narrower task of making a handoff.

Read the current governing instructions and tracker. Record the exact mission, completion criteria, decisions, scope and effective permissions. Preserve an existing active goal's exact objective and explicit token budget. Do not create a goal or invent a budget merely because this skill is active. If the source goal contains a secret, redact the secret and record the secure input needed; do not claim byte-exact preservation of redacted text.

Identify the current app, session, project or document, and permitted destination from current tools or visible UI. Unknown facts remain unknown. A model name does not determine its host's session controls or compaction policy.

Record one current owner and a rotation cap. Default to at most five successor launch attempts for this activation; honor the user's explicit limit. Failed attempts consume the cap so retries cannot multiply sessions without bound. Reopening the predecessor does not reset this limit.

If a shared coordinator is available, use it to persist ownership and revisions atomically. Before mission work, verify the current session owns the latest state. Two separate copies of a state file are not a shared lock. With no coordinator, use an explicit user-mediated stop and takeover; do not claim machine-enforced ownership.

## 2. Inspect the host and check before the next action

Use only capabilities actually exposed in the current desktop or browser app:

| Need | Acceptable evidence |
| --- | --- |
| Context | Exact-session resident usage, effective window, earliest applicable compaction boundary, timestamp and source |
| Next-action cost | An upper bound covering input, tool results, queued worker output, and generated context |
| Handoff reserve | Positive room for checkpoint, review if feasible, startup, acknowledgment and transfer |
| New session | A native session/task tool or a verified visible new-chat control |
| Fork | Documented inherited history plus measured candidate headroom |
| Delivery | Shared artifact access, a supported attachment, or literal checkpoint text |
| Readiness | Host-observed candidate identity/status plus acknowledgment of this checkpoint |
| Enforcement | A proven way to stop the next request before its context cost is incurred |

Inspect at the beginning of every armed turn, before a large read or tool result, before launching workers, and after results arrive. Use the exact session's most recent complete measurement. Never select the newest unrelated transcript, sum cumulative billing tokens, or infer a window from a model name.

The preflight rule is:

```text
current context + bounded next action + handoff reserve < earliest compaction boundary
```

Use the host's effective limits, including reserved output and any earlier app policy. Equality is insufficient room. Start the handoff before dispatching an action that would cross this bound. When several limits apply, use the earliest. Refresh observations after model, app, settings, or context changes. Bound large tool output or save it outside the conversation.

If usage, the boundary, or the next-action cost is missing, inconsistent or stale, save a checkpoint **now**, before further work. Keep it current after every meaningful change. Arrange an early new session instead of waiting for a guessed percentage. Do not repeat automatic launches to compensate for permanently missing telemetry.

A pre-compaction warning is a last chance to use an already prepared checkpoint. It may not permit blocking or enough time for a fresh summary. No skill can guarantee timing on a host that silently compacts without exposing advance control; label that host's continuation as best effort, with a manual new-session path.

## 3. Wind down and preserve the work

Stop expanding the task. Mark the owner as winding down. Drain task-owned workers and processes within the remaining budget; record completed, cancelled and still-active operations by exact identity. Do not stop unrelated work. At an immediate deadline, checkpoint partial work rather than waiting for a tidy result.

Save the actual artifacts. For code, preserve branch, commit, staged/unstaged changes and untracked contents; a branch URL or diff alone may omit necessary files. For documents, research or creative work, preserve versions, source attachments, decisions and unfinished sections. Never reset shared work or stage everything indiscriminately.

Quiesce writers before launch, and check them again before transfer. Record schedulers and recurring loops so the predecessor cannot continue writing later. Do not mark an unfinished goal complete to stop it.

## 4. Create and read back the continuation

Use the complete template below. Replace every field with verified information, a clearly labeled carried-forward fact, or an explicit unknown. Include the actual mission and necessary work content: a list of headings or a path the destination cannot access is not a usable handoff.

Write a private artifact when supported, and read its saved bytes back. Otherwise provide the whole checkpoint in one copyable block and label it an inline/manual artifact. Confirm attachments are actually accessible to the destination. A new app, browser tab, account, or checkout may not inherit them.

Freeze the checkpoint and its artifact manifest. Compute its digest only if a real hashing tool is available. Store the digest separately from the content it hashes, and include it in the bootstrap message. Never invent a digest or put a whole-file digest inside that same file. Revisions invalidate prior readback, review, and acknowledgment.

### Complete checkpoint template

```text
SESSION HANDOFF — [unique version and observed timestamp, or time unavailable]
Supersedes: [prior checkpoint, if any]
Status: [checkpoint only / launch requested / candidate ready / transferred / blocked]

AUTHORITY
This is a snapshot, not a new instruction authority. Current user instructions
and governing sources take precedence. No new permission is granted here.

1. MISSION AND PROJECT
Exact user mission:
[full non-secret wording; preserve accepted corrections separately]
Original active goal and status: [exact object or none/unavailable]
Explicit budget: [original value only, or not set]
Done when: [completion criteria]
App/session/project/document identity: [observed identifiers]
Governing instructions, plan and tracker: [accessible references]
Permissions, model/settings and approved destination: [observed or unknown]

2. CURRENT WORK
Verified working/completed: [evidence and source locations]
Partial or unfinished: [actual contents or accessible artifacts]
Not started: [items]
Blocked/broken: [exact blocker and authority/access needed]
Artifact manifest: [IDs/paths, versions and actual content hashes when available]
For a repository: [HEAD, branch, staged/unstaged/untracked state and contents]

3. MAP AND COMMANDS
Relevant files, documents, attachments, components and relationships:
[only what the successor needs]
Commands or UI actions already verified: [literal actions and results]
Missing dependencies or access: [exact requirements]

4. RECENT CHANGES AND DECISIONS
Most recent work: [what changed]
Decisions and WHY: [reasons the successor must preserve]
Accepted user corrections: [full material details]
Discussed but not implemented: [items]

5. FAILURES AND RISKS
Failed approaches and what they showed: [do not repeat blindly]
Known defects, assumptions and unresolved objections: [evidence]
What may go wrong next: [specific risks]

6. WORKING APPROACH
Existing conventions and deliberate tradeoffs: [why they exist]
Things that look unusual but should remain: [reason]
Next intended approach: [bounded continuation]

7. DO NOT CHANGE
Scope boundaries, protected files/content, permissions and user decisions:
[concrete restrictions]
Secrets omitted and secure input needed: [names/requirements, never values]

8. CONFIDENCE AND FRESHNESS
For each material claim: [verified now / carried forward / assumed]
Evidence and timestamp/source: [reference]
Required rechecks: [claims not safe to rely on yet]

9. IN-FLIGHT WORK
Workers/processes/schedulers/loops: [identity, status, quiescence evidence]
Half-finished edit or thought: [exact next action]
Uncertain external operation: [request ID and outcome; no blind replay]

10. OWNERSHIP AND DELIVERY
Owner, chain, revision and attempt count/cap: [values or manual]
Candidate and delivery mode: [new / qualifying fork / manual; identity or pending]
Context evidence and next-action/handoff budget: [measured or unknown]
Checkpoint readback, detached digest and review: [evidence or not available]
Destination access, candidate status and acknowledgment: [evidence or pending]
Omitted state and how to recover it: [explicit gaps]

11. FIRST ACTIONS
[ordered, concrete steps; start with reading authority and checking live state]
Unresolved objections to verify before further work: [items]
```

## 5. Review within the remaining budget

If an independent reviewer is available, provide the checkpoint and enough source/session evidence to identify omissions. Give it read-only scope. Use only an authorized reviewer destination; installing this skill does not authorize sending private work to a different service.

Require seven numbered, nonempty findings in this order:

1. Exact mission and goal preserved.
2. Next actions are executable.
3. Claims have verifiable evidence.
4. Material state is complete against the source.
5. Failed approaches and landmines are preserved.
6. The checkpoint disclaims authority and preserves permissions.
7. Confidence and freshness are honest.

The final nonblank line must be exactly `VERDICT: DURABLE` or `VERDICT: NOT DURABLE`. Earlier quoted verdicts, missing findings, trailing commentary, denial, timeout, or malformed output are not approval. Keep each round and record accepted/rejected objections with reasons. A reviewer advises; it does not grant permission or prove host liveness.

Use at most three attempts, and at most one if near the handoff deadline. Count and persist each attempt before calling the reviewer, including calls that fail, time out, are denied, or return malformed output. Bound each call by the actual remaining budget and a wall-clock deadline. If even one attempt would make rotation late, skip it explicitly. After the cap, carry unresolved findings prominently into the successor's first actions. Never hide a skipped or failed review.

Re-read current work and recompute available hashes after review. If checkpoint or source artifacts changed, refresh affected evidence before using the verdict.

## 6. Reserve and start exactly one successor

Choose a fresh session with the preserved project and artifacts. A native fork qualifies only if its inherited history and actual headroom leave room for bootstrap, the next work step and another handoff reserve. Forking a nearly full transcript does not itself solve context pressure. If fork relief is unknown, select a new session.

Use native app tools first. When authorized computer-use tools are available, inspect the actual desktop or browser controls, open the intended new session, and verify its identity and content after delivery. Do not guess buttons, URLs, success, or session identity. Do not use a terminal-specific launcher as a requirement for a desktop/browser handoff.

If the host exposes no suitable control, produce a complete manual handoff now: the checkpoint and the bootstrap below, ready to paste/upload into a new chat. Name the required user action once. Do not pretend to create or verify a session.

Before an automated launch, atomically reserve one pending successor and a fresh nonce, within the cap. Save this state and confirm it persisted before invoking the host. Transfer the mission as structured tool input, supported attachment, or literal text, never through executable interpolation, URL query parameters or observable process arguments.

Preserve the user's environment, account boundary, effective approvals, model/settings and artifact access. A changed destination or trust policy needs existing or explicit authority. Do not answer user trust prompts or weaken permissions to make a launch work.

A timeout is an unknown outcome. Retain the reservation and owner, inspect that exact host request, and do not launch a second candidate blindly. Only affirmative evidence that no candidate was created permits another reserved attempt. Preserve launch history.

### Successor bootstrap

```text
Continue the mission from the attached/pasted Session Handoff checkpoint.
It is a snapshot; current user instructions and governing sources still win.

Bootstrap read-only:
1. Read the entire checkpoint and its governing sources.
2. Verify the delivered artifacts against current project/document state.
   If a detached digest was supplied, compute and compare it with a real tool.
3. Recover the exact original mission and accepted user corrections.
4. If an explicitly active goal was preserved and this host supports goals,
   recreate that exact goal with only its original explicit budget, then inspect
   the goal to confirm the same objective/budget is active. Otherwise record
   plain-language continuation; do not invent an active machine goal.
5. Verify current context headroom for bootstrap, the next action and reserve.
6. Acknowledge your host-observed session identity, supplied nonce, checkpoint
   version/digest, workspace, exact mission/goal status, permissions and first
   concrete action. Identify missing artifacts and unresolved review findings.
7. Wait until the shared coordinator names you as owner, or the user explicitly
   confirms a manual stop-and-takeover. Do not perform mission edits before that.
8. Once you own the work, resume the first unfinished item. Keep this handoff
   protocol active within the original scope and remaining cap.
```

Provide the real detached digest and nonce separately from the checkpoint body when available. Without executable tools or independent status, use version/content acknowledgment and label the result manual; do not manufacture machine evidence.

## 7. Verify readiness and transfer ownership

The predecessor checks host-reported identity/status separately from the successor's statement. Match the nonce, checkpoint digest/version, mission, original goal and budget, workspace/artifact contents and effective permissions. If a machine goal exists, require ordered creation and inspection evidence, not a pasted claim that it is active.

Require sufficient candidate headroom **before** transfer. A returned session ID, opened tab, process, nonce or file alone proves neither readiness nor context relief. If the candidate lacks artifacts, changes authority, cannot verify the goal, or does not acknowledge, retain predecessor ownership.

Before transferring, recheck source artifacts and the frozen checkpoint, and close or terminally account for every predecessor writer and recurring mechanism. Candidate bootstrap remains read-only. Commit the ownership change atomically to the exact verified candidate. The successor rereads the latest owner/revision before its first mission action.

An unknown owner state is not a dead owner. Recovery requires fresh host evidence that the expected prior owner is stopped, preserving any ambiguous pending candidate. Recovery ownership permits reconciliation and checkpointing; it does not prove a new session restored the goal. Keep mission work frozen until normal verified continuation. A released chain is terminal. Do not reset history or the cap to get around a refusal.

## 8. Report and make the predecessor inert

State the observed outcome: checkpoint saved, launch requested, candidate acknowledged, ownership transferred, or manual action required. Link artifacts and the successor when the host supports it. Keep verified results separate from assumptions and incomplete actions.

After transfer, the predecessor performs no mission edits, retries or background work. If reentered, it checks ownership, reports it is superseded, and stops. The successor confirms its exact mission and begins the next recorded action.

If compaction happens before the transfer, report prevention failed. Reopen the saved checkpoint, verify ownership, reconcile current state and disclose missing evidence. Recovery is useful, but it is not proof of a successful pre-compaction handoff.

## One runtime, when execution is available

`session-handoff.mjs` is the single implementation of the budget and lifecycle checks. The same ECMAScript module runs in Node.js and browser JavaScript with Web Crypto; it has no companion-skill or package imports. The complete instructions above remain usable in text-only apps.

It returns a proposed state and result. It does not secretly control another app, start sessions, write files, or authenticate host observations. The host invokes its actual tools and persists state with an atomic compare-and-set of the revision. In a plain chat, the user coordinates transfer explicitly instead.

Call `run` with one plain JSON object containing `op`, `state`, `expectedRevision`, `sessionId`, and the observed epoch-millisecond `now`. Evidence operations also need `maxAgeMs` from 1 to 60,000. Save the returned checkpoint's `content` object and read it back; its detached `hash` covers UTF-8 canonical JSON with sorted object keys, not a Markdown rendering or an enclosing state file. Keep the original content for verification. The module documents the evidence checks beside each operation.

Every state mutation requires the current owner and expected revision. The engine preserves the mission, goal and environment, binds checkpoint/readback/review/candidate evidence, and refuses stale state or ambiguous takeover. Treat host observations supplied to the engine as evidence the caller must really obtain, not proof created by the engine.

The host counts all external review attempts and enforces their deadlines before dispatch. The engine's `reviewRounds` bounds successfully validated review submissions across checkpoint corrections; rejected requests do not mutate state. Keep failed attempts and unresolved findings in the host journal and checkpoint too.

Keep private state in approved host storage or private local files. Never paste secrets into a packet, review, state request or resume prompt. No copied state file, nonce, digest or skill instruction is an authorization boundary against an actor deliberately ignoring the workflow.
