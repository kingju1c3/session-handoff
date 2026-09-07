<h1 align="center">session-handoff</h1>

<p align="center">
  <strong>Fresh session. Same goal.</strong><br>
  Help your next AI chat pick up where this one leaves off.<br>
  For AI apps on your desktop or in your browser.
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

A **skill** is a set of instructions for an AI. This one helps it prepare notes for your next
chat: your goal, the choices you made, what is finished, and what still needs doing.

Long chats can get shortened by the app, leaving the AI with less of the conversation to read.
A **handoff** means giving those notes and any needed files to a fresh chat so it can continue
the work.

The notes also preserve what did not work and why. The next chat can start with a short guide
to the full notes, then confirm it has read the needed files and name its first step before
continuing.

## What it keeps intact

Session Handoff helps a fresh chat recover the information that usually gets lost when a long
conversation ends:

- The exact goal, scope, permissions, and work still unfinished.
- Decisions, failed attempts, open questions, and the reason for each next step.
- The files and artifacts the new chat must read before it starts changing work.
- One clear owner, so the old and new chats do not both continue the same task.

It can use a small preview to orient the new chat, but the full checkpoint remains the source of
truth. A preview never proves that the new chat has enough context, has access to every file, or
owns the task.

## Quickstart

1. Open the [instructions file](https://raw.githubusercontent.com/kingju1c3/session-handoff/main/SKILL.md)
   and attach it to your current chat. You can also copy all its text and paste it into the chat.
   If the app will not accept the file, use the copy-and-paste option.
2. Send this message:

   ```text
   Use session-handoff.
   Keep notes for this task:
   my goal, rules, decisions,
   files, progress, and next steps.
   Set up automatic moves if this
   app supports them. Open a fresh task
   before this one gets too long.
   If you cannot open a new chat,
   give me the notes and a message
   to paste into one.
   ```

3. The AI checks the app's controls and prepares the setup and notes. If automatic moves need
   your review, it explains that step. It must not call setup ready until the app's check has
   actually run.

You do not need to run code. For help attaching a file, see the guides for
[ChatGPT](https://help.openai.com/en/articles/8555545-file-uploads-faq) or
[Claude](https://support.claude.com/en/articles/8241126-upload-files-to-claude).

## Install once

If your app supports skills, you can install this one instead of attaching the instructions
each time. Download the [skill ZIP](https://github.com/kingju1c3/session-handoff/releases/latest/download/session-handoff.zip)
and follow your app's upload guide:

- [Install a skill in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt).
- [Install a skill in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude).

The option may depend on your account or organization. For a different app, follow its own
skill-installation guide. If installation is unavailable, use the Quickstart above.

**Automatic moves need a connection to the app.** Installing instructions alone does not make
that connection. The Codex setup adds checks before tool use and before a chat is shortened.
Codex requires you to review new checks before they can run; the AI cannot approve them for you.
See [Codex's guide](https://developers.openai.com/codex/hooks). If those checks cannot run, the AI
can still open a task now when the app allows it, but cannot promise a later automatic move.

## How it works

1. **Write the notes.** The AI records your goal, decisions and their reasons, completed work,
   missing information, and the next steps. It checks the notes against the work available.
2. **Move to a fresh chat.** If the app lets the AI open and check a new chat, it can handle
   the move using those tools when you ask. A working automatic check tells it when to start.
   Otherwise, open a new chat and add the full skill instructions,
   notes, needed files, and the message the AI gives you.
3. **Check what arrived.** The new chat reads the notes and checks that it can open the files
   it needs. When a required reading list is provided, it confirms each file and the recorded
   first step before it edits anything. Old attachments may not follow automatically, so you may
   need to add them again.
4. **Continue in one place.** Stop work in the old chat before the new one continues. For a
   manual move, tell the new chat that the old one has stopped and it can take over.

When the app shows how much room is left, the AI checks before large steps. When that
information is hidden, it saves notes early. No skill can guarantee finishing the move before
an app shortens a chat without warning. Keep a copy of the notes and move early.

Prefer a fresh chat when you need more room. A branch may carry over the same long history;
use one only when the app can check that it has enough room to continue.

Keep passwords and secret keys out of the notes. Only move files to another app when you have
permission to share them there.

## Works with your app, not around it

The skill works in text-only chats, desktop apps, and browser AI tools. It uses an app's native
new-task and file controls when they are actually available. For Codex, the optional hook adapter
can ask for a handoff before a large next step or compaction, but it must be separately trusted
and observed in the app. A configured hook is not proof that automatic handoff timing works.

## Development

<details>
<summary>Technical details and local checks</summary>

[session-handoff.mjs](session-handoff.mjs) is the single JavaScript engine. The same source runs
in Node.js and a browser using standard platform APIs, with no third-party runtime dependencies.
It validates the handoff sequence; the app supplies tools for files, sessions, and coordinated
state updates. [SKILL.md](SKILL.md) contains the full instructions for the AI.

Optional structured continuation records ordered actions, required artifacts, decision reasons,
failed approaches and open questions inside the checkpoint digest. `continuationBundle` provides
a preview with a UTF-8 byte limit and explicit omissions; the successor still reads the full
checkpoint and required sources before readiness. A preview is not a context-token measurement
or an ownership transfer. See the [API contract](SKILL.md#optional-structured-continuation).

This independently implemented design draws inspiration from Engram's
[staged startup](https://github.com/staticroostermedia-arch/engram/blob/4203062b33d4a5ca14a4f7ffefc20fb1478dc2f7/grok-plugin-engram/skills/engram-wake-up/SKILL.md),
[decision and failure records](https://github.com/staticroostermedia-arch/engram/blob/4203062b33d4a5ca14a4f7ffefc20fb1478dc2f7/grok-plugin-engram/skills/engram-working-memory/SKILL.md),
and [session-end records](https://github.com/staticroostermedia-arch/engram/blob/4203062b33d4a5ca14a4f7ffefc20fb1478dc2f7/grok-plugin-engram/skills/engram-session-end/SKILL.md).
No Engram code or prose is included, and no Engram backend is required.

The same module exports `evaluateCodexHook` and provides a Node-only `--codex-hook` entry point.
The [Codex setup recipe](SKILL.md#codex-automatic-setup-connect-the-trigger-and-task-controls)
connects event feedback to native task creation. It preserves existing hooks, requires user
trust, and arms only a named session. A `PreCompact` block alone does not open a task or prove
that the AI will resume; the earlier tool check is the normal signal to prepare the handoff.

Run these commands from the repository root:

```sh
node --test tests/*.test.mjs
node build.mjs
```

The build produces `dist/session-handoff.skill` and `dist/session-handoff.zip`, identical
packages with different extensions, plus `dist/session-handoff.md` for attaching or pasting.
Each package contains `SKILL.md`, `session-handoff.mjs`, this README, and the license.

Keep verification results separate: local engine/CLI tests, an observed trusted hook event,
native task creation with file and permission checks, and a complete handoff triggered before
compaction. A successful new-task test proves only the part it exercised. Automatic timing
still needs a complete test in the actual app; it is not guaranteed across desktop or browser apps.

</details>

## License

[MIT](LICENSE).
