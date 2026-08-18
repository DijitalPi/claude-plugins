# scope-guard

**Catches writes that land outside the project you are actually working in.**

Written for a specific, unglamorous failure: several terminals open, one per
client or service, and an edit meant for one of them goes to another. Nothing
warns you, because every individual action is legal. You find out later, in the
wrong repository's `git status`.

---

## How it decides

The project boundary is the enclosing **git repository** when there is one, and
the **working directory** otherwise. A write inside that boundary is silent. A
write outside it gets a confirmation prompt naming both paths — and if the
target is inside a *different* git repository, it says so explicitly, because
that is the case that quietly pollutes someone else's working tree.

Always permitted, because writing there is routine: `~/.claude`, `/tmp`,
`/private/tmp`, `/var/folders`.

Relative paths resolve against the working directory, so they are inside by
construction and never questioned.

---

## Ask, don't block

The default is **ask**, not refuse. Writing outside the project is often
correct — a global config, a scratch file, a sibling repo you genuinely meant to
touch. The point is that it should be a decision rather than an accident.

If you want it refused outright:

```json
{ "outsideProject": "deny" }
```

---

## Install

```bash
/plugin marketplace add DijitalPi/claude-plugins
/plugin install scope-guard@dijitalpi
```

**Requirements:** Node 14+. No dependencies, no network access.

---

## Configure

`~/.claude/scope-guard.json` globally, or `.scope-guard.json` per project.

```json
{
  "enabled": true,
  "outsideProject": "ask",
  "allowPaths": ["~/.claude", "/tmp", "/private/tmp", "/var/folders"],
  "extraRoots": []
}
```

| Key | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Off without uninstalling. |
| `outsideProject` | `"ask"` | `"ask"` prompts, `"deny"` refuses, `"off"` disables the check while leaving the plugin installed. |
| `allowPaths` | temp dirs + `~/.claude` | Prefixes that are always fine. `~` is expanded. |
| `extraRoots` | `[]` | Directories to treat as part of this project — a sibling repo you work across, a shared assets folder. |

Working across two repos on purpose? Put the second one in `extraRoots` for that
project and the prompts stop, without weakening the check anywhere else.

---

## If something goes wrong

Fails open: malformed input, unreadable config, a path it cannot resolve — the
write proceeds. To disable: `{ "enabled": false }`.

```bash
/plugin uninstall scope-guard@dijitalpi
```

---

MIT — see [LICENSE](../../LICENSE). Built by [DijitalPi](https://dijitalpi.com).
🇹🇷 [Türkçe](README.tr.md)
