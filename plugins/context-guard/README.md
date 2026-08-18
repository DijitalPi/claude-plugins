# claude-context-guard

[![Release](https://img.shields.io/github/v/release/DijitalPi/claude-plugins?color=8A63D2)](https://github.com/DijitalPi/claude-plugins/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A63D2)](https://claude.com/claude-code)

**A Claude Code plugin that warns you before the context window fills up — while
there is still room to save your work and start a clean session.**

🇹🇷 [Türkçe dokümantasyon →](README.tr.md)

Long sessions end one of two ways. Either you notice in time, write down what
matters, and clear — or you don't notice, the window fills, and the conversation
gets auto-compacted around you. Compaction is lossy in a way that is hard to
predict: it usually keeps the shape of the work and drops the detail you were
about to need.

This plugin watches the window and speaks up at a threshold you choose, early
enough that wrapping up is still a calm two-minute job.

---

## What it looks like

At 80% (default), on your next prompt, you see:

```
⚠️  Context 84% full — wrapping up (/save will run), then clear the conversation.
```

Claude gets a matching instruction and finishes the current request, runs
whatever you told it to run to persist state, and ends with an explicit
"you can clear now". It cannot clear the conversation itself — only you can —
so that last line matters.

Below the threshold it stays completely silent.

---

## Install

```bash
/plugin marketplace add DijitalPi/claude-plugins
/plugin install context-guard@dijitalpi
```

Then restart Claude Code.

**Requirements:** Node 14 or newer on your `PATH`. No npm install, no dependencies.

---

## Set `saveCommand` — this is the one that matters

Out of the box the plugin warns you and asks Claude to summarize what is still
open. That is useful, but the real value comes from wiring it to whatever you
already use to persist a session:

```json
{ "saveCommand": "/save" }
```

Now hitting the threshold means: finish this request → run `/save` → tell the
user to clear. The warning becomes a workflow instead of a nag.

If you don't have such a command yet, this plugin ships `/wrap-up` (below), and
`{ "saveCommand": "/wrap-up" }` is a reasonable place to start.

---

## The `/wrap-up` command

Sometimes you know you're done before the meter says so — end of the day, or
you're about to switch to something unrelated.

```
/wrap-up
/wrap-up also note the staging credentials are rotated
```

It stops the current work at a clean point, records what matters wherever your
project already keeps such things, and prints a short handoff: what was done,
what is open, what the next session needs. Then it tells you it's safe to clear.

It deliberately does not invent a place to write notes. If your project has no
memory directory, no `CLAUDE.md`, nowhere obvious, it says so and prints the
summary instead of scattering a file somewhere you won't look for it again.

---

## How it measures the window

Worth understanding, because it affects your config.

Claude Code does not tell hooks how full the context window is. It does tell the
*statusline*. So there are two paths, and the plugin uses whichever is available:

**1. Transcript estimate (default, zero setup).** Every assistant turn in the
transcript records its token usage, and the most recent one is the current size
of the window. Dividing by `contextLimit` gives the percentage.

⚠️ **This is why `contextLimit` must match your model.** The default is `200000`.
If you are on a 1M-context model and leave it at the default, the plugin will
think you are at 100% when you're at 20%, and warn constantly. Set it:

```json
{ "contextLimit": 1000000 }
```

**2. Statusline helper (exact, optional).** Claude Code hands the statusline a
real `context_window.used_percentage`. The included helper records that number
where the hook looks — and when it's present, the hook uses it and ignores
`contextLimit` entirely. No guessing, no per-model config.

The helper does **not** replace your statusline. Pipe your existing statusline's
input through it and place the badge where you want:

```bash
#!/bin/bash
input=$(cat)
plugin="$HOME/.claude/plugins/cache/dijitalpi/context-guard"
ctx=$(echo "$input" | node "$plugin"/*/statusline/context-percent.js --badge)

# ...your existing statusline, plus:
echo "$(your_line_here) | $ctx"
```

Prints `🟢 ctx 34%` / `🟡 ctx 67%` / `🔴 ctx 88%`. Drop `--badge` and it prints
nothing at all, just quietly records the number for the hook.

---

## Configure

Optional. Create `~/.claude/context-guard.json` for all projects, or
`.context-guard.json` in a project root for just that one. Project config wins.

```json
{
  "enabled": true,
  "threshold": 80,
  "contextLimit": 200000,
  "saveCommand": "",
  "extraInstructions": "",
  "showSystemMessage": true,
  "repeatEvery": 1
}
```

| Key | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Set `false` to switch off without uninstalling. |
| `threshold` | `80` | Percentage at which to start warning. |
| `contextLimit` | `200000` | Your model's window size. **Only used for the transcript estimate** — ignored when the statusline helper is installed. |
| `saveCommand` | `""` | The command Claude should run to persist the session. The setting that turns this from a warning into a workflow. |
| `extraInstructions` | `""` | Appended to the warning verbatim. Your workflow, your words. |
| `showSystemMessage` | `true` | Also show the one-line warning in your terminal, not just to Claude. |
| `repeatEvery` | `1` | Once over threshold, warn every N prompts. `0` = warn once and then stay quiet. |

A worked example — 1M model, a save command, and an extra step:

```json
{
  "threshold": 75,
  "contextLimit": 1000000,
  "saveCommand": "/save",
  "extraInstructions": "Also push any uncommitted work to the current branch.",
  "repeatEvery": 3
}
```

---

## When it re-arms

Once you clear (or Claude Code compacts), usage drops below the threshold, and
the plugin resets itself — the next time you climb back up you get the full
warning again, not a stale reminder. Nothing to reset by hand.

---

## Cost

The warning is about 120 tokens, and only when you are over the threshold. Below
it, the hook writes nothing at all: zero tokens, no context cost. The work of
checking happens outside the model.

---

## If something goes wrong

The hook fails open. Bad config, unreadable transcript, missing temp directory,
malformed input — every path exits `0` with no output. It cannot block a prompt
or break a session. Worst case, warnings quietly stop appearing.

To turn it off without uninstalling, set `"enabled": false`.

To remove it:

```bash
/plugin uninstall context-guard@dijitalpi
```

---

## Contributing

Issues and PRs welcome. Especially:

- Context limits for models you use, if the defaults are wrong for you.
- Reports of the estimate drifting from the real number over long sessions.

---

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 DijitalPi.

Built by **[DijitalPi](https://dijitalpi.com)** — a solo studio building AI and
automation tooling for small teams. We write these for our own work first and
open-source the ones that survive contact with real clients.

See also: **[claude-explain-simply](https://github.com/DijitalPi/claude-explain-simply)** —
appends a plain-language summary to long Claude Code answers.

🇹🇷 Türkçe: [README.tr.md](README.tr.md)
