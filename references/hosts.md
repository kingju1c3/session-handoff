# Host capabilities and verification

Documentation checked on 2026-09-07. These are source-backed host semantics, not live integration
certifications. Recheck the installed host when configuring automation: a hosted app, CLI, IDE
extension, and API can expose different capabilities even when they use the same model.

## The portable contract

Separate five capabilities:

| Capability | Evidence needed |
| --- | --- |
| Measure | Current context occupancy in known units, its timestamp, and what the count includes |
| Predict | The earliest applicable compaction boundary and bounded cost of the next action |
| Pause | A verified way to stop the next request or compaction while preserving the checkpoint |
| Create | An authorized fresh session, or a fork with verified remaining context |
| Attest | Host evidence identifying the successor and showing its actual status |

Implement only what the host supports. A command named `PreCompact` is not evidence that it can
cancel compaction. A new session ID is not evidence of a fresh context. A successful process
launch is not evidence that the successor read the checkpoint or accepted ownership.

Use the [context signal contract](context-signal.md) for budgeting. Do not infer a boundary from
a model's advertised maximum, a default in another product, or a community-reported percentage.
If an input is missing or stale, checkpoint and rotate early. Without a usable preflight/control
surface, automatic transfer before compaction cannot be guaranteed by a skill.

## Claude Code

The [skills documentation](https://code.claude.com/docs/en/skills) lists
`~/.claude/skills/<skill-name>/SKILL.md` for personal skills and
`.claude/skills/<skill-name>/SKILL.md` for project skills. It also documents `/skill-name`
invocation. Do not treat installation as hook registration.

The current [PreCompact reference](https://code.claude.com/docs/en/hooks#precompact) documents
both exit code `2` and JSON `decision: "block"` as compaction vetoes. It distinguishes two cases:

- When automatic compaction is proactive, blocking it skips compaction and allows the
  conversation to continue without compaction.
- When compaction is recovering from an API context-limit error, blocking it exposes that error
  and the request fails.

The same reference says `systemMessage` and `continue` are discarded for `PreCompact`.
Therefore a generic instruction to stop, or a `continue: false` response, is not a verified veto.
Blocking a late compaction also does not manufacture enough context to write a handoff.

For this repository's Claude adapter, enable compaction blocking only after a disposable-session
test confirms the installed version's behavior. The adapter choice and veto capability are
explicit configuration; neither is inferred from a model name. Other hosts must translate the
portable decision into their own supported schema.

Read the host's status/configuration signal before relying on a boundary. A token counter alone
does not establish when that host will compact. Preserve room for tool output and the handoff
itself, and check before issuing the next action.

## Codex

Local `codex --help` and `codex fork --help` were inspected during this revision before consulting
the official documentation. They expose new-session invocation and `fork`/`resume`; CLI help by
itself does not establish context accounting or a compaction veto.

The [Codex skill documentation](https://developers.openai.com/codex/skills/create-skill/) lists
`~/.agents/skills` for personal skills and `.agents/skills` in repository scopes. It explicitly
supports symlinked skill directories. Use the available skill picker or the host's documented
invocation mechanism.

The [app-server documentation](https://developers.openai.com/codex/app-server) distinguishes
`thread/start`, which starts a new conversation, from `thread/fork`, which copies stored history
into a new thread. A fork can limit history to a specified completed turn, but inherited history
still needs to be accounted for. Prefer a new session with the checkpoint for context relief;
use a fork only after measuring its usable remaining context.

Desktop tools, CLI commands, and app-server APIs are different execution surfaces. Use only
the tools exposed by the current environment, respect their creation/approval requirements,
and attest the actual successor ID they return. This repository does not claim that a generic
Codex compaction hook is installed or that fork creation is a verified automatic handoff.

## Cursor

The official [hooks reference](https://cursor.com/docs/hooks#precompact) describes `preCompact`
as observational: it cannot block or modify compaction. Its input includes current usage
percentage, token count, and context-window size; its output can display a user message.

That information arrives at the compaction event. It does not by itself provide an earlier
threshold signal or time for an LLM to prepare and verify a new checkpoint. Use it for
notification or already-prepared state, and obtain earlier telemetry/control separately before
claiming automatic pre-compaction transfer. Do not attach the Claude response schema and assume
that an exit code or `decision: "block"` will veto Cursor's compaction.

## Gemini CLI

The official [hooks reference](https://geminicli.com/docs/hooks/reference/#precompress) says
`PreCompress` runs asynchronously before compression and is advisory. It cannot block or modify
compression; flow-control output is ignored. It can display `systemMessage` to the user.

Use that event for notification/state preservation only. A just-in-time LLM-generated handoff
is not guaranteed to complete before an asynchronous compression event. Keep the checkpoint
current, obtain earlier telemetry where available, and verify session creation in the installed
host. Do not assume these semantics apply to another Google product or a successor CLI.

## Other hosts, APIs, and local models

Start with the plain-text workflow in [SKILL.md](../SKILL.md). Supply the instructions, checkpoint
after meaningful changes, save or copy the result, and open a fresh conversation manually when
the host does not expose session creation. A user-controlled API wrapper can implement a
preflight gate, but must include all context sent to the provider and reserve output/headroom
using that wrapper's actual policy.

Do not claim automatic integration for an untested host. Model choice alone establishes none
of the five capabilities. Hidden context, automatic provider behavior, or unbounded tool output
requires conservative checkpointing; a universal fixed percentage cannot solve those gaps.

## Minimum host smoke test

Use a disposable task with no private data and no production writes:

1. Record the host/version, signal source, units, freshness, boundary, and permissions.
2. Feed a small safe action and confirm the preflight permits it with adequate reserve.
3. Test a budget that would cross the boundary and confirm the next action is stopped before
   dispatch. Test absent/stale input and failed checkpoint writing too.
4. If claiming compaction blocking, trigger the real event and verify whether it is actually
   cancelled. An advisory hook or a successful script exit does not satisfy this check.
5. Start the intended new session/fork and measure its initial context. Verify the checkpoint,
   goal, work location, and next action from the successor's real host record.
6. Transfer ownership only to that successor. Confirm the previous owner cannot write, and
   a failed launch leaves the source checkpoint and ownership recoverable.

Report each layer separately: local script tests, documented host capability, installed hook
test, session creation, context relief, successor verification, and completed ownership transfer.

## Community triangulation

A targeted [Reddit discussion about manual context resets](https://www.reddit.com/r/ClaudeAI/comments/1rdnhdv/i_keep_having_to_clear_my_claude_code_context/)
contains user reports of checkpoint files and manual fresh-session workflows. It is anecdotal
support for the workflow's usefulness, not authority for thresholds, tool behavior, or reliability.
Technical behavior above is grounded in the official sources linked beside each claim.
