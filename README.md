# session-handoff

**Keep long-running work moving across desktop and browser AI chats.**

One self-contained skill carries your goal, decisions, evidence, and unfinished work into a fresh
session. Stay in the same app, change models, or move to another assistant. The outgoing session
saves the checkpoint; the successor checks it and takes over.

[Get the skill](SKILL.md) · [Quickstart](#quickstart) · [Install once](#install-once) ·
[How it works](#how-it-works) · [Development](#development)

```text
Current chat → checkpoint → review → fresh chat → verify → continue
                                                       └→ old chat stops
```

## Quickstart

1. Open [SKILL.md](SKILL.md). Download it and attach it to your current desktop or browser chat,
   or paste its complete contents. The workflow and continuation template are included in that
   one file. If your app does not accept Markdown attachments, paste the text.
2. Send this instruction:

   ```text
   Use session-handoff for this task. Keep a current checkpoint and move to a fresh session
   before context becomes tight. Preserve my goal, constraints, decisions, evidence, and
   unfinished work. Use this app's available tools to complete the handoff; otherwise give me
   the complete continuation and resume prompt to paste into a new chat.
   ```

3. Keep working. The assistant checks what the current app can do. Where authorized native
   tools support session creation and verification, it uses them. Otherwise, it gives you a
   complete continuation and a ready-to-paste resume prompt. Open a new chat, provide the skill,
   continuation, and required source files, then send that prompt.

This route needs no API key, command line, or separate skill. Chat attachments are documented for
[ChatGPT](https://help.openai.com/en/articles/8555545-file-uploads-faq) and
[Claude](https://support.claude.com/en/articles/8241126-upload-files-to-claude); use the attachment
control available in your app, or paste the full skill into the composer.

## Install once

If your app supports native skills, install the package so you can invoke `session-handoff`
without attaching its instructions each time.

- **ChatGPT:** open **Plugins → Skills → Create → Upload from your computer**. Availability
  depends on the account, workspace, and app surface. See
  [Skills in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt).
- **Claude:** open **Customize → Skills → + → Create skill → Upload a skill**, upload the ZIP,
  and enable it. Claude requires **Code execution and file creation** for native skills. See
  [Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude).
- **Other desktop agents:** use the app's documented skill installation path, then select or
  mention `session-handoff`. The same [SKILL.md](SKILL.md) remains the entry point.

The source build below produces `dist/session-handoff.skill` and `dist/session-handoff.zip`:
identical packages with different extensions. Use the ZIP wherever an uploader requests it.
It also produces `dist/session-handoff.md` for attaching or pasting the complete instructions.

## How it works

1. **Keep the goal intact.** Record the task, constraints, permissions, and current owner.
2. **Checkpoint early.** Save decisions and their reasons, work locations, actual results,
   open questions, and the next concrete action. Keep required source material accessible.
3. **Review the continuation.** Compare it with the available evidence. Record independent
   review when available and identify unresolved gaps.
4. **Verify the successor.** Confirm that the new session received the right checkpoint and
   can access the material it needs before it starts changing the work.
5. **Transfer and stop.** Let the successor continue; the outgoing session stops working on
   the task. Automated handoff requires an observable acknowledgment and coordinated ownership.

The skill uses measured context headroom when the host exposes it. When an app hides its
compaction boundary, no skill can guarantee a handoff before compaction. It checkpoints early
and refreshes that checkpoint after meaningful changes instead of inventing a context percentage.

Prefer a fresh chat for context relief. ChatGPT's documented
[web branching feature](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)
starts a conversation from an existing message; branching alone does not establish available
headroom. A branch qualifies only when the host can verify that it has enough room.

Keep credentials out of continuations. Moving to another app does not expand the original
permission to share files or perform actions.

## Development

[session-handoff.mjs](session-handoff.mjs) is the single JavaScript engine. It uses standard
platform APIs and runs from the same source in Node.js and a browser. There are no third-party
runtime dependencies. The engine validates the handoff sequence; the host supplies tools for
files, sessions, and coordinated state updates.

From the repository root:

```sh
node --test tests/*.test.mjs
node build.mjs
```

The packages contain `SKILL.md`, `session-handoff.mjs`, this README, and the license. Local tests
check the engine and package; they do not establish that every vendor's desktop or browser app
can perform an automatic handoff. Verify the available tools in the actual host.

## License

[MIT](LICENSE).
