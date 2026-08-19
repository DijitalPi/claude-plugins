# DijitalPi plugins for Claude Code

[![CI](https://github.com/DijitalPi/claude-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/DijitalPi/claude-plugins/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code plugins](https://img.shields.io/badge/Claude%20Code-marketplace-8A63D2)](https://claude.com/claude-code)

**Small, single-purpose plugins. Each one does one thing, ships as a single
dependency-free file, and fails open.**

🇹🇷 [Türkçe dokümantasyon →](README.tr.md)

```bash
/plugin marketplace add DijitalPi/claude-plugins
```

Then install whichever you want:

```bash
/plugin install context-guard@dijitalpi
/plugin install install-guard@dijitalpi
/plugin install secret-guard@dijitalpi
/plugin install scope-guard@dijitalpi
/plugin install explain-simply@dijitalpi
```

Restart Claude Code afterwards. Everything here needs Node 14+ on your `PATH`
and nothing else.

---

## What's in here

### [context-guard](plugins/context-guard) — don't get caught by a full window

Warns at a threshold you choose, early enough that wrapping up is still a calm
two-minute job rather than an auto-compaction happening around you. Point
`saveCommand` at whatever you use to persist a session and the warning becomes a
workflow instead of a nag. Ships an optional statusline badge and a `/wrap-up`
command.

### [install-guard](plugins/install-guard) — check the package is real

Models occasionally invent package names, and attackers register the ones that
get invented often. This checks the registry before the install runs: blocks
names that do not exist, asks about packages that are brand new or barely
downloaded, and stays silent otherwise. npm, pnpm, yarn, bun, pip, uv.

### [secret-guard](plugins/secret-guard) — keep keys out of files

Blocks writes containing a live credential: AWS keys, GitHub tokens, provider
API keys, PEM private key blocks. Deliberately narrow — no generic
`password = "..."` matching, because a guard that cries wolf gets switched off.
`.env` files are left alone, since that is where a key is supposed to go.

### [scope-guard](plugins/scope-guard) — write to the right repo

For when several projects are open at once and an edit meant for one goes to
another. The boundary is the enclosing git repository; writes outside it get a
confirmation naming both paths. Asks by default, blocks if you tell it to.

### [explain-simply](https://github.com/DijitalPi/claude-explain-simply) — say it in plain words

Appends a short, jargon-free summary to long answers, for the people who didn't
write the code. Lives in its own repository; installable from here.

---

## The shape of these

Same decisions across all of them, on purpose:

- **One file, no dependencies.** Node built-ins only. Nothing to install, nothing
  to keep up to date, nothing to audit but the file itself.
- **Fail open, always.** Bad config, no network, malformed input, unreadable
  temp directory — every error path exits quietly and lets your work proceed. A
  guard that blocks you when something unrelated breaks gets uninstalled by
  lunchtime, and then it protects nothing.
- **Never widens permissions.** The guards can stay silent, ask, or refuse.
  None of them ever answers "allow" — suppressing a prompt you would otherwise
  have seen is not a thing a safety tool should do.
- **Configurable per project.** A file in the project root beats the one in
  `~/.claude`, so a repo can tighten or loosen the rules for itself.
- **Quiet by default.** If a plugin has nothing to say, it says nothing and
  costs no tokens.

---

## Tests

```bash
node --test test/*.test.js
```

Nothing to install here either — the suite uses Node's built-in test runner the
same way the guards use Node's built-in modules. The runner needs Node 18+; the
guards themselves still run on Node 14+.

Each guard is exercised as a subprocess, exactly the way Claude Code runs it:
JSON in, JSON or silence out. Every test gets a throwaway `HOME` and `TMPDIR`, so
the suite reads its own config instead of yours, and install-guard's registry
answers are seeded into its cache, so the tests never reach the network.

What actually gets pinned down: that a guard stays silent when it has nothing to
say, that none of them ever answers `allow`, and that all of them fail open on a
broken config or unparsable input. Those are the three promises this repository
makes, so those are the ones worth a test.

---

## Contributing

Issues and PRs welcome. The most useful reports are the boring ones: a false
positive that made you turn something off, a package ecosystem that isn't
covered, a credential format that slipped through.

---

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 DijitalPi.

Built by **[DijitalPi](https://dijitalpi.com)** — a solo studio building AI and
automation tooling for small teams. We write these for our own work first and
open-source the ones that survive contact with real clients.
