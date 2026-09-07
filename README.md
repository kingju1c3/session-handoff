# session-handoff

**Continue the work in a fresh session before context compaction.**

A portable skill for carrying the task, decisions, evidence, and unfinished work into the next
session. Use it with a different model, a different agent, or a new session in the same app.
The outgoing session checkpoints; the successor verifies the handoff; one session owns the work.

[Install](#install) · [Use](#use) · [How it works](#how-it-works) ·
[Compatibility](#compatibility) · [Verify](#verify)

```text
Work → check available context before the next action
                      │
            headroom uncertain or insufficient
                      ↓
       checkpoint → review → fresh session → verify → transfer
                                                       │
                                             old session stops
```

**The protocol is portable; automatic timing depends on the host.** No skill can guarantee rotation
before compaction when an app hides its boundary or can compact without giving the skill control.
This skill handles that limit explicitly: checkpoint immediately when telemetry is missing, keep
the checkpoint current, and move to a new session early. It never substitutes a guessed model
percentage for a verified host limit.

## Install

The repository is the skill. Review its files before enabling executable hooks.

For [Codex's personal skill directory](https://developers.openai.com/codex/skills/create-skill/):

```sh
git clone https://github.com/kingju1c3/session-handoff ~/.agents/skills/session-handoff
cd ~/.agents/skills/session-handoff
sh scripts/selftest.sh
node scripts/watchdog.test.mjs
```

For [Claude Code's personal skill directory](https://code.claude.com/docs/en/skills), use this
destination instead:

```sh
git clone https://github.com/kingju1c3/session-handoff ~/.claude/skills/session-handoff
cd ~/.claude/skills/session-handoff
sh scripts/selftest.sh
node scripts/watchdog.test.mjs
```

If a destination already exists, inspect and update that installation instead of cloning over it.
Reload the host's skill list or start a new session, then confirm that `session-handoff` appears.
Installation alone does not register hooks or prove automatic rotation.

The scripts require Node.js, Python 3, and a POSIX shell. Use WSL or an appropriate POSIX environment
on Windows; native PowerShell execution is not claimed. The plain-text protocol needs none of these.

For other agents, place this repository in the host's documented skill directory. In a chat app
without skill installation, supply [SKILL.md](SKILL.md) as instructions and use the
[handoff template](HANDOFF-TEMPLATE.md) as text you can save and paste into a new chat.

## Use

In Claude Code:

```text
/session-handoff
Keep this task moving across sessions. Checkpoint before compaction and use a fresh session
when the next action no longer fits safely. Preserve my goal, constraints, and unfinished work.
```

In Codex, select `session-handoff` from the skill picker or mention it in the task. In any other
host, load the skill and give the same instruction in plain language.

To hand off immediately:

```text
Use session-handoff now. Save and verify the current checkpoint, then continue in a fresh
session. A fork is acceptable only if the host proves it leaves enough usable context.
```

The skill uses only capabilities and permissions available in the current host. When it cannot
create a session, it produces the checkpoint and a ready-to-paste continuation prompt for you.

## How it works

1. **Discover the host's capabilities.** Identify current context usage, the earliest applicable
   compaction boundary, session creation, and independent successor status. Unknown stays unknown.
2. **Budget before the next action.** Include the next request, possible tool output, and room to
   finish the handoff. Start transferring while that work still fits.
3. **Save the continuation.** Preserve the goal, constraints, decisions and their reasons, exact
   work locations, verified results, uncertainty, and the next concrete actions.
4. **Review the checkpoint.** Check it against source evidence. Mark missing or unavailable
   independent review honestly; a self-check is not an independent review.
5. **Start the successor.** Prefer a fresh session carrying the checkpoint. A fork qualifies only
   when its inherited history and resulting headroom have been verified.
6. **Verify, transfer, stop.** Verify the actual successor through the host, transfer the single
   writer lease where available, and stop the outgoing session's writes.

The preflight rule is deliberately independent of model names:

```text
current occupancy + next-action upper bound + handoff reserve < compaction boundary
```

Equality is already too late to start more work. Missing or stale inputs cannot authorize more
work on the assumption that there is room. If the boundary is unknown, save a checkpoint now and
refresh it after meaningful changes; use short work segments and early session changes.

See the [context signal contract](references/context-signal.md) for the machine-readable inputs
and [host notes](references/hosts.md) for the distinction between a warning hook and a blocking hook.

## Compatibility

| Environment | Available approach | Evidence boundary |
| --- | --- | --- |
| An LLM chat that accepts instructions | Plain-text checkpoint and manual new chat | Portable workflow; no hidden-threshold guarantee |
| A tool-using agent with filesystem access | Checkpoint files, budget check, ownership lease | Requires the supplied runtimes and integration with the host |
| Claude Code | Skill plus optional Claude hook adapter | Current docs support a `PreCompact` veto; verify the installed host before enabling it |
| Codex | Skill; fresh task/session through the available host tools | Forking copies history, so a fork alone does not prove context relief |
| Cursor | Skill/manual transfer; documented `preCompact` notification | The notification cannot block or modify compaction |
| Gemini CLI | Skill/manual transfer; documented `PreCompress` notification | The notification is asynchronous and cannot block compression |
| Other hosts and models | Start with the plain-text protocol; add verified capabilities | No automatic adapter or live compatibility claim is implied |

Host behavior is documented in [references/hosts.md](references/hosts.md), with primary sources.
The skill does not contain a model-to-percentage table: the same model can be used by hosts with
different context policies, and those policies can change.

## Verify

Run the local checks from the repository root:

```sh
sh scripts/selftest.sh
node scripts/watchdog.test.mjs
```

These checks exercise the local scripts and synthetic inputs. They are not live end-to-end
tests of every host. To claim an automatic integration works, also demonstrate in the installed
host that the signal arrives early enough, the successor starts with sufficient headroom, its
checkpoint is verified, and the old writer stops. Test missing telemetry and failed successor
creation as well as the successful path.

No automatic hook registration, model calls, or session creation is needed for the plain-text
workflow. Review [SKILL.md](SKILL.md) before configuring an adapter.

## Why keep a checkpoint outside the conversation?

A checkpoint gives the next session a reviewable starting point: what was requested, why choices
were made, what actually passed, and what remains. It also makes gaps visible before a summary
silently becomes the new source of truth. It is not a promise of perfect memory or a verbatim
archive of every message. Preserve source references and attachments when exact detail matters.

Keep secrets and unnecessary personal data out of handoffs. Preserve the original task's access
boundaries; moving to another model or service does not grant permission to send it private files.

## License

[MIT](LICENSE).
