# PROJECT CONTINUATION DOCUMENT
## {{DATE}} {{TIME}} {{TZ}} · chain {{CHAIN_SHORT}} · generation {{GEN}} of {{CAP}}

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
You are continuing work from a previous Claude Code session that handed off at
{{PCT}}% context. Do these in order, before anything else:

1. Read this continuation document in full: {{DOC_PATH}}
2. Read the project memory files named in section 1.
3. GROUND YOURSELF BEFORE TRUSTING THIS DOCUMENT. Run `git status --short` and
   `git log -5 --oneline --decorate`. Compare against the machine state block above.
   Flag any drift to Jordan rather than assuming the document is current.
4. Verify every item marked ❓ LOW confidence before relying on it.
5. Summarize your understanding in 3–5 sentences, in plain language.
6. {{OBJECTIONS_STEP}}
7. Then resume the mission by re-arming it exactly as written:

{{MISSION_PROMPT_VERBATIM}}

Ask a clarifying question ONLY if something genuinely blocks execution.
```

---

### 1. PROJECT IDENTITY
- **Project Name:** {{PROJECT}}
- **What This Project Is:** {{WHAT_IT_IS}} (and what it is NOT: {{WHAT_IT_IS_NOT}})
- **Primary Objective:** {{OBJECTIVE}}
- **Hard Constraints:** {{CONSTRAINTS}}
- **Project Memory Files — the next agent MUST read these too; this handoff does not
  replace them:**
{{MEMORY_FILES}}
- **Model / effort to run at:** {{MODEL}} / {{EFFORT}}
  <!-- Stated explicitly because a session CANNOT read its own effort from settings.
       When effort comes from a launch flag it lives only in $CLAUDE_EFFORT. -->

### 2. WHAT EXISTS RIGHT NOW
- **Repo state:** branch `{{BRANCH}}`, HEAD `{{HEAD_SHA}}` — {{HEAD_SUBJECT}}; tree {{CLEAN_OR_DIRTY}}
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
- Do NOT touch `.loop/HANDOFF.md` — that belongs to Claude-Loop, not this chain.
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
- Chain `{{CHAIN_ID}}`, generation **{{GEN}} of {{CAP}}**
- Prior sessions: {{ANCESTRY}}
- Prior documents: {{PRIOR_DOCS}}

### 11. FIRST ACTIONS — do these before resuming the mission
{{FIRST_ACTIONS}}

{{UNRESOLVED_OBJECTIONS_SECTION}}

---
*Written by generation {{GEN}} at {{PCT}}% context. Durability review: {{REVIEW_RESULT}}.*
