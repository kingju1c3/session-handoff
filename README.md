<h1 align="center">session-handoff</h1>

<p align="center">
  <strong>Fresh session. Same goal.</strong><br>
  Carry your decisions, evidence, and unfinished work into the next AI chat.<br>
  One self-contained skill for desktop and browser assistants.
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/kingju1c3/session-handoff/main/assets/session-handoff-hero.png" alt="A cobalt ribbon passes through translucent window frames, carrying a continuous path from one frame to the next." width="960">
</p>

<p align="center">
  <a href="https://github.com/kingju1c3/session-handoff/releases/latest/download/session-handoff.zip"><strong>Download the skill</strong></a>
  &nbsp; · &nbsp;
  <a href="#quickstart">Quickstart</a>
  &nbsp; · &nbsp;
  <a href="#install-once">Install once</a>
  &nbsp; · &nbsp;
  <a href="#how-it-works">How it works</a>
  &nbsp; · &nbsp;
  <a href="#development">Development</a>
</p>

<br>

## Quickstart

Stay in the same app, switch models, or continue with another assistant.

1. **Load the skill.** Download [SKILL.md](https://raw.githubusercontent.com/kingju1c3/session-handoff/main/SKILL.md)
   and attach it to your current chat, or paste its complete contents. The workflow and
   continuation template are included. If your app rejects Markdown attachments, paste the text.
2. **Activate it for your task.**

   ```text
   Use session-handoff for this task.
   Keep a current checkpoint.
   Move to a fresh session before
   compaction. Preserve my goal,
   constraints, decisions, evidence,
   and unfinished work.
   Use this app's available tools.
   If needed, give me the full handoff
   and resume prompt for a new chat.
   ```

3. **Keep working.** The assistant checks what your app can do and prepares the continuation
   using the capabilities available in that session.

**With the required native tools**, it can create and verify a successor through the host's
authorized controls.
**With manual transfer**, it delivers a complete checkpoint and resume prompt. Open a fresh chat,
provide the skill, continuation, and required source files, then send that prompt. The successor
checks the handoff before taking over. Confirm that the old session has stopped and the fresh
chat owns the task before work resumes.

This route needs no API key, command line, or separate skill. Use your app's attachment control
or paste the full skill into the composer. File-upload help:
[ChatGPT](https://help.openai.com/en/articles/8555545-file-uploads-faq) ·
[Claude](https://support.claude.com/en/articles/8241126-upload-files-to-claude).

## Install once

Download the [skill ZIP](https://github.com/kingju1c3/session-handoff/releases/latest/download/session-handoff.zip)
and install it through your app. Native installation makes `session-handoff` available without
attaching its instructions each time.

- **ChatGPT:** **Plugins → Skills → Create → Upload from your computer**. Availability depends
  on your account, workspace, and app surface.
  [Official guide](https://help.openai.com/en/articles/20001066-skills-in-chatgpt).
- **Claude:** **Customize → Skills → + → Create skill → Upload a skill**. Upload the ZIP and
  enable it. Native skills require **Code execution and file creation**.
  [Official guide](https://support.claude.com/en/articles/12512180-use-skills-in-claude).
- **Other desktop agents:** use the app's documented skill installation path, then select or
  mention `session-handoff`. [SKILL.md](SKILL.md) is the same entry point.

The [source build](#development) produces `dist/session-handoff.skill` and
`dist/session-handoff.zip`: identical packages with different extensions. Use the ZIP wherever
an uploader requests it. `dist/session-handoff.md` contains the complete instructions for
attaching or pasting.

## How it works

1. **Keep the goal intact.** Record the task, constraints, permissions, and current owner.
2. **Checkpoint early.** Preserve decisions and their reasons, work locations, actual results,
   open questions, and the next concrete action. Keep the source material accessible.
3. **Review the continuation.** Compare it with the available evidence. Record independent
   review when available and identify unresolved gaps.
4. **Verify the successor.** Confirm that the new session received the right checkpoint and
   can access the material it needs before changing the work.
5. **Transfer and stop.** The successor continues; the outgoing session stops working on the
   task. Automated handoff requires an observable acknowledgment and coordinated ownership.

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
platform APIs and runs from the same source in Node.js and a browser, with no third-party
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
