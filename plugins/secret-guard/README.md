# secret-guard

**Stops a live credential from being written into a file.**

The failure this prevents is mundane. A key gets pasted into a config file to
make something work, the file gets committed, and now the key is public.
Rotating it is the easy part — noticing is the hard part.

---

## What it catches

AWS access key IDs, GitHub tokens (classic and fine-grained), Anthropic and
OpenAI keys, Google API keys, Slack tokens and webhooks, Stripe live keys,
SendGrid keys, npm tokens, and PEM private key blocks.

Runs on `Write`, `Edit`, and `NotebookEdit`. A match blocks the write and
explains what was found — showing only the first few characters, never the key.

---

## What it deliberately does not catch

**Generic `password = "..."` patterns.** Those fire on test fixtures, on
documentation, on the word "password" in a comment. A guard that cries wolf gets
switched off, and a switched-off guard protects nothing. Every pattern here has
a recognizable shape that prose does not accidentally produce.

**Anything in a `.env` file.** That is where a key is *supposed* to live. The
plugin leaves `.env`, `.env.local`, `.env.production` and friends alone.

**Obvious placeholders.** A line containing `your-api-key`, `example`,
`replace-me`, `xxxx`, `<...>`, `${...}` is treated as documentation, not a leak.
The one exception is a PEM private key block, which is never a placeholder worth
pasting in full.

---

## Install

```bash
/plugin marketplace add DijitalPi/claude-plugins
/plugin install secret-guard@dijitalpi
```

**Requirements:** Node 14+. No dependencies, no network access — everything is
local pattern matching, and nothing about your files leaves the machine.

---

## Configure

`~/.claude/secret-guard.json` globally, or `.secret-guard.json` per project.

```json
{
  "enabled": true,
  "allowFiles": [".env", ".env.local", ".env.production"],
  "extraPatterns": [],
  "disablePatterns": []
}
```

| Key | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Off without uninstalling. |
| `allowFiles` | `.env` family | Filenames permitted to contain credentials. Matched on basename, so `.env.staging` works via the `.env` entry. |
| `extraPatterns` | `[]` | Additional regex sources for credential formats specific to you — an internal token prefix, a vendor key shape. |
| `disablePatterns` | `[]` | Pattern names to switch off, e.g. `["openai-key"]`, when one is noisy in your codebase. |

Pattern names, for `disablePatterns`: `aws-access-key-id`, `github-token`,
`github-pat-fine`, `anthropic-key`, `openai-key`, `google-api-key`,
`slack-token`, `stripe-live-key`, `sendgrid-key`, `npm-token`, `private-key`,
`slack-webhook`.

---

## If it blocks something it shouldn't

It tells you which pattern fired. Three ways out, in order of preference: make
the placeholder obviously fake, move the value to a `.env` file, or add the
pattern name to `disablePatterns` for that project.

Fails open on error — bad config, malformed input, unreadable anything: the
write proceeds. To disable entirely: `{ "enabled": false }`.

```bash
/plugin uninstall secret-guard@dijitalpi
```

---

MIT — see [LICENSE](../../LICENSE). Built by [DijitalPi](https://dijitalpi.com).
🇹🇷 [Türkçe](README.tr.md)
