# install-guard

**Checks packages against their registry before they get installed.**

Language models occasionally invent package names. The name sounds right, the
install command looks ordinary, and the package does not exist. This is common
enough that attackers watch for the names models invent most often, register
them, and wait — you get a real package, from a real registry, containing
whatever they put in it.

The fix is one lookup before the command runs.

---

## What it does

| Situation | What happens |
| --- | --- |
| Package does not exist in the registry | **Blocked.** Nothing legitimate is lost — the name is a typo or invented. |
| Package exists but is very new, or barely downloaded | **You're asked**, with the numbers. New packages are not bad, they're just where trouble starts. |
| Anything else | **Silence.** The normal permission flow continues untouched. |

It never returns "allow". Widening permissions is not a guard's job — the most
it does is stay out of the way.

Covers `npm` / `pnpm` / `yarn` / `bun` and `pip` / `uv pip`. Git URLs, local
paths, and bare `npm install` / `npm ci` restoring a lockfile are ignored — there
is no registry name to check.

---

## Install

```bash
/plugin marketplace add DijitalPi/claude-plugins
/plugin install install-guard@dijitalpi
```

**Requirements:** Node 14+. No dependencies. Needs network access to
`registry.npmjs.org`, `api.npmjs.org`, and `pypi.org` — and when it can't reach
them, it gets out of the way rather than blocking your work.

---

## Configure

`~/.claude/install-guard.json` globally, or `.install-guard.json` in a project.

```json
{
  "enabled": true,
  "minAgeDays": 90,
  "minWeeklyDownloads": 1000,
  "blockUnknown": true,
  "timeoutMs": 3000,
  "allowlist": []
}
```

| Key | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Off without uninstalling. |
| `minAgeDays` | `90` | Ask about packages first published more recently than this. |
| `minWeeklyDownloads` | `1000` | Ask about npm packages below this many weekly downloads. PyPI publishes no download counts, so this is npm-only. |
| `blockUnknown` | `true` | Block packages the registry has never heard of. Turning this off reduces the plugin to advice. |
| `timeoutMs` | `3000` | Per-request timeout. On timeout the check is skipped, not failed. |
| `allowlist` | `[]` | Names to never question — internal packages, private registries. |

Working behind a private registry, or on a team with a lot of internal
packages? `allowlist` is the pressure valve; `blockUnknown: false` is the bigger
hammer.

---

## Two things worth knowing

**The age check is best-effort on huge packages.** Publication date only exists
in npm's full package document, which for something like `react` is megabytes of
version history and will not download inside a hook's timeout. So the age check
is skipped for packages already pulling >100k weekly downloads — which is fine,
because "is this brand new" is not a question worth asking about a package with
a hundred million downloads. Existence and download counts always come from
small, fast endpoints and are checked for everything.

**Results are cached for 24 hours**, so a run of installs is not a run of
network requests.

---

## If something goes wrong

Fails open, on every path: offline, registry down, timeout, malformed config,
unparseable command. The install proceeds. A guard that blocks work when the
network hiccups gets uninstalled by lunchtime.

To disable: `{ "enabled": false }`. To remove:

```bash
/plugin uninstall install-guard@dijitalpi
```

---

MIT — see [LICENSE](../../LICENSE). Built by [DijitalPi](https://dijitalpi.com).
🇹🇷 [Türkçe](README.tr.md)
