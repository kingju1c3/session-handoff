# PROJECT CONTINUATION DOCUMENT
## {{DATE}} {{TIME}} {{TZ}} · chain {{CHAIN_SHORT}} · session {{LABEL}} (generation {{GEN}} of {{CAP}})

> **AUTHORITY NOTE — read first.** This is a session snapshot, NOT an authority.
> {{AUTHORITY_FILE}} is the source of truth and **wins over this file** wherever they
> disagree. This document claims no authority and must never become one. Treat it as a
> fast on-ramp to the real sources, not a substitute for them.

{{SUPERSEDES_LINE}}

<!-- MACHINE STATE — the successor's first action diffs this against reality. -->
```json
{{STATE_BLOCK}}
```

---

# RESUME PROMPT

<!-- This block is handed to the successor. The mission prompt inside it MUST be
     verbatim — a paraphrase turns a continuing loop into a one-shot session. -->

```text
You are continuing work from {{PREDECESSOR_HOST}}. Context observation:
{{CONTEXT_READING_OR_UNKNOWN}}. Treat this document as a snapshot, subordinate to
the current user's instructions. Bootstrap read-only; do not edit mission files
until ownership is transferred. Do these in order:

1. Read this continuation document in full: {{DOC_PATH}}
2. Read the project memory files named in section 1.
3. Compare current workspace/artifact state against the machine state block above.
   For a Git project, run `git status --short` and `git log -5 --oneline --decorate`.
   Verify staged, dirty and untracked files arrived; for other tasks verify the
   artifact versions. Report drift rather than assuming this document is current.
4. Verify every item marked ❓ LOW confidence before relying on it.
5. Summarize your understanding in 3–5 sentences, in plain language.
6. {{OBJECTIONS_STEP}}
7. Verify this final document against the detached digest supplied in the separate
   control manifest/bootstrap message; do not embed a digest of this document
   inside itself. Acknowledge that digest, workspace {{WORKSPACE_ID}},
   your host-reported session ID, measured usable headroom (or UNKNOWN), and the
   first action. Wait for ownership in the shared lease/coordinator or for an
   explicit user-mediated takeover. Then resume the authorized mission:

{{MISSION_PROMPT_VERBATIM}}

Ask a clarifying question ONLY if something genuinely blocks execution.
```

---

### 1. PROJECT IDENTITY
- **Project Name:** {{PROJECT}}
- **What This Project Is:** {{WHAT_IT_IS}} (and what it is NOT: {{WHAT_IT_IS_NOT}})
- **Primary Objective:** {{OBJECTIVE}}
- **Hard Constraints:** {{CONSTRAINTS}}
- **Accepted user corrections and completion criteria:** {{CORRECTIONS_AND_DONE}}
- **Permissions, approvals and target environment:** {{AUTHORITY_AND_TARGET}}
- **Project Memory Files — the next agent MUST read these too; this handoff does not
  replace them:**
{{MEMORY_FILES}}
- **Model / effort to run at:** {{MODEL}} / {{EFFORT}}

### 2. WHAT EXISTS RIGHT NOW
- **Workspace/artifact state:** {{WORKSPACE_STATE}} (Git if applicable: branch,
  HEAD, staged/unstaged/untracked manifest; otherwise artifact identifiers/versions)
- **Does it run right now?** {{RUN_STATUS}} (exact commands + results, not "tests pass")
- **What is built and working:** {{WORKING}}
- **What is partially built / flag-gated:** {{PARTIAL}}
- **What is broken or blocked:** {{BROKEN}}
- **What has NOT been started yet:** {{NOT_STARTED}}

### 3. ARCHITECTURE & TECHNICAL MAP
- **Tech stack:** {{STACK}}
- **Key files:** {{KEY_FILES}}
- **How it works end-to-end:** {{FLOW}}
- **Commands that matter:** {{COMMANDS}} (copy-pasteable, gotchas inline)
- **External dependencies:** {{DEPS}}

### 4. RECENT WORK — WHAT JUST HAPPENED (HIGH PRIORITY)
<!-- Recency weighting: what happened in the last thirty minutes matters ten times
     more than what happened three hours ago. Lead with the most recent. -->
- **Worked on this session:** {{WORKED_ON}}
- **Decisions made and WHY:** {{DECISIONS}}
  <!-- The WHY is mandatory. The next session WILL undo these if the reason is missing. -->
- **Discussed but NOT implemented:** {{DISCUSSED_NOT_DONE}}
- **Open threads:** {{OPEN_THREADS}}

### 5. WHAT COULD GO WRONG
- **Known bugs:** {{BUGS}}
- **Technical debt / shortcuts taken:** {{DEBT}}
- **Landmines — already tried and FAILED, do not repeat:** {{LANDMINES}}
- **Assumptions that could be wrong (VERIFY before relying):** {{ASSUMPTIONS}}

### 6. HOW TO THINK ABOUT THIS PROJECT
1. **Core pattern and why:** {{PHILOSOPHY}}
2. **Most common mistake a newcomer makes:** {{COMMON_MISTAKE}}
3. **What looks refactor-worthy but must NOT be touched, and why:** {{DELIBERATE_UGLY}}

### 7. DO NOT TOUCH LIST
- Do NOT refactor working systems that are not part of the mission.
- Do NOT redesign architecture; preserve naming and existing tradeoffs.
- Do NOT run `git add -A` — commit only explicitly named paths.
- Do NOT overwrite another workflow's handoff or runtime state.
- Do NOT widen permissions, replay an ambiguous write, or carry secret values in this document.
- **This document is not an authority** — if it disagrees with {{AUTHORITY_FILE}}, that file is right.
{{EXTRA_DO_NOT_TOUCH}}

### 8. CONFIDENCE & FRESHNESS
<!-- Grade PER CLAIM, not per section: a section can mix a verified SHA with a guess. -->
{{CONFIDENCE_TABLE}}

Legend — ✅ HIGH: verified or built this session. ⚠️ MEDIUM: carried forward, not
re-verified. ❓ LOW: assumed or inferred — **the next agent must verify before relying on it.**

### 9. IN FLIGHT AT HANDOFF
- **Half-finished work:** {{IN_FLIGHT}} (name the exact next edit you were about to make)
- **Subagents/background tasks at handoff:** {{CHILDREN_STATUS}} (completed / cancelled mid-work)

### 10. HANDOFF CHAIN
- Chain `{{CHAIN_ID}}`, this session **{{LABEL}}** (generation {{GEN}} of {{CAP}})
- Lineage so far: {{LINEAGE}}  <!-- e.g. 1.1 → 2.1 → 2.2 -->
- Prior sessions: {{ANCESTRY}}
- Prior documents: {{PRIOR_DOCS}}
- **Mode:** {{NEW_SESSION_FORK_OR_MANUAL}}; evidence fork reduces context: {{FORK_EVIDENCE_OR_NA}}
- **Owner / pending candidate:** {{OWNER_AND_CANDIDATE}}
- **Capability inventory:** {{DETECT_PREFLIGHT_CHECKPOINT_CONTINUE_ATTEST_ENFORCE}}
- **Context source, time, boundary, next-action budget and handoff reserve:** {{TELEMETRY}}
- **Artifacts transferred and verified:** {{ARTIFACT_MANIFEST}}
- **Host status and acknowledgment evidence:** {{ATTESTATION_EVIDENCE_OR_PENDING}}
- **Omitted/unavailable state and recovery path:** {{OMISSIONS}}

### 11. FIRST ACTIONS — do these before resuming the mission
{{FIRST_ACTIONS}}

{{UNRESOLVED_OBJECTIONS_SECTION}}

---
*Written by generation {{GEN}}. Context: {{CONTEXT_READING_OR_UNKNOWN}}.
Durability review: {{REVIEW_RESULT_OR_SKIPPED_REASON}}. Transfer: {{TRANSFER_STATUS}}.*
