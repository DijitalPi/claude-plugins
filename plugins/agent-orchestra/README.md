# agent-orchestra

Puts your Claude Code sessions on stage in the **Agent Orchestra**: a live orchestra in the
browser where every machine running coding agents is a musician. When your agents work, your
seat lights up with your country's flag and the music picks up. Countries compete in a live
league; everyone listening hears the same notes at the same moment.

Watch and listen: https://orchestra.dijitalpi.com

## What leaves your machine

About once a second while your agents work, and a heartbeat every 10 seconds while they think:

| Sent | Never sent |
|---|---|
| How many steps your agents took (a number) | Code, diffs, file names |
| Whether they are working; how many sessions are open | Prompts, replies, tool output |
| "Shipped" (a git commit or push) and "tests passed" signals | Commands, project or repo names |
| A random machine id (kept in `~/.claude/agent-orchestra/id`) | Your IP (the server turns it into a country flag and does not store it) |

The plugin reads a Bash command only to answer "was this a git commit or push?", and its
output only to answer "did tests pass?". Neither is stored or sent.

## How it stays out of the way

Each hook call appends one short line to `~/.claude/agent-orchestra/spool.log` and returns:
no network on Claude's path. A small sender process, started on demand, posts the spool in
batches and exits after a minute of quiet. Every error path exits 0 with no output; if the
orchestra is down, nothing changes for you.

## Install

```
/plugin marketplace add DijitalPi/claude-plugins
/plugin install agent-orchestra@dijitalpi
```

The first session shows a one-line notice. After that it is silent. `/orchestra` shows your
seat and the link.

## Configure

Global config, `~/.claude/agent-orchestra.json`:

```json
{ "enabled": true, "server": "https://orchestra.dijitalpi.com" }
```

Switch it off for one project with `.claude/agent-orchestra.json` in that project:

```json
{ "enabled": false }
```

A project can only switch the plugin off. It cannot change the server, so a repository you
clone cannot redirect anything.

| Environment variable | Use |
|---|---|
| `AGENT_ORCHESTRA_URL` | Point at another server (for example a local `http://localhost:4480`) |
| `AGENT_ORCHESTRA_CONFIG` | Use a different global config file |

## If something goes wrong

- Not on stage: run `/orchestra`. It joins only while your agents work.
- To stop completely: `/plugin uninstall agent-orchestra@dijitalpi`, then delete
  `~/.claude/agent-orchestra/`.
