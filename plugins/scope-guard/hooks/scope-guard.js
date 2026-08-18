#!/usr/bin/env node
/**
 * scope-guard — PreToolUse hook (Write / Edit / NotebookEdit)
 *
 * Catches writes that land outside the project you are actually working in.
 *
 * Written for a specific, unglamorous failure: several terminals open, one per
 * client or service, and an edit meant for one of them goes to another. Nothing
 * warns you, because every individual action is legal. You find out later, in
 * the wrong repository's git status.
 *
 * The project boundary is the enclosing git repository when there is one, and
 * the working directory otherwise.
 *
 * Default is to ask, not to block. Writing outside the project is often correct
 * — a global config, a scratch file, a sibling repo you genuinely meant. The
 * point is that it should be a decision rather than an accident. Set
 * `outsideProject: "deny"` if you want it refused outright.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  enabled: true,
  // "ask" | "deny" | "off"
  outsideProject: 'ask',
  // Always-permitted prefixes. ~ is expanded. Temp dirs and Claude's own
  // config are here because writing there is routine and rarely a mistake.
  allowPaths: ['~/.claude', '/tmp', '/private/tmp', '/var/folders'],
  // Extra directories treated as inside the project — a sibling repo you are
  // legitimately working across, a shared assets folder.
  extraRoots: [],
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadConfig(cwd) {
  const candidates = [
    process.env.SCOPE_GUARD_CONFIG,
    cwd ? path.join(cwd, '.scope-guard.json') : null,
    path.join(os.homedir(), '.claude', 'scope-guard.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    const found = readJson(file);
    if (found) return { ...DEFAULTS, ...found };
  }
  return { ...DEFAULTS };
}

function expand(p) {
  const s = String(p || '');
  if (s === '~') return os.homedir();
  if (s.startsWith('~/')) return path.join(os.homedir(), s.slice(2));
  return s;
}

/** Nearest enclosing git repository, or null. */
function gitRoot(from) {
  try {
    let dir = path.resolve(from);
    for (let i = 0; i < 40; i++) {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** True when child is inside parent (or is parent). */
function contains(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function main() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8')) || {};
  } catch {
    process.exit(0);
  }

  if (!['Write', 'Edit', 'NotebookEdit'].includes(input.tool_name)) process.exit(0);

  const cfg = loadConfig(input.cwd);
  if (!cfg.enabled) process.exit(0);
  const mode = String(cfg.outsideProject || 'ask').toLowerCase();
  if (mode === 'off') process.exit(0);

  const ti = input.tool_input || {};
  const target = ti.file_path || ti.notebook_path;
  if (!target) process.exit(0);

  const cwd = input.cwd || process.cwd();
  // A relative path is resolved against cwd, so it is inside by construction.
  if (!path.isAbsolute(target)) process.exit(0);

  const resolved = path.resolve(target);
  const root = gitRoot(cwd) || path.resolve(cwd);

  if (contains(root, resolved)) process.exit(0);

  for (const allowed of [...(cfg.allowPaths || []), ...(cfg.extraRoots || [])]) {
    const a = path.resolve(expand(allowed));
    if (contains(a, resolved)) process.exit(0);
  }

  // Writing into another git repository is the case worth naming explicitly —
  // it is the one that silently pollutes someone else's working tree.
  const otherRepo = gitRoot(path.dirname(resolved));
  const where = otherRepo
    ? `inside a different git repository (${otherRepo})`
    : 'outside the current project';

  const reason =
    `scope-guard: ${resolved} is ${where}. This session's project is ${root}. ` +
    (mode === 'deny'
      ? `Refusing the write. If it is intended, add the path to extraRoots in .scope-guard.json, or open that project in its own session.`
      : `If that is intended, go ahead — this is a confirmation, not an accusation. If it is not, the edit probably belongs in ${root}. Paths you cross into often belong in extraRoots in .scope-guard.json.`);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: mode === 'deny' ? 'deny' : 'escalate',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0);
}
