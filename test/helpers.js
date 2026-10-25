'use strict';
/**
 * Test harness for the guards.
 *
 * Every guard is a small program: JSON on stdin, JSON or nothing on stdout,
 * always exit 0. So the tests run the real file in a real subprocess and assert
 * on what comes back. No mocking, no requiring the hook into the test process —
 * these files call main() at load and read fd 0, so importing them would hang.
 *
 * Each test gets a throwaway HOME and TMPDIR. That matters more than it looks:
 * every guard falls back to ~/.claude/<name>.json for config and uses the temp
 * directory for state, so without the sandbox the suite would read whatever the
 * developer running it happens to have configured.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');

/** Path to a plugin's hook script. */
function hook(plugin, file) {
  return path.join(REPO, 'plugins', plugin, 'hooks', file || `${plugin}.js`);
}

/**
 * A disposable HOME + TMPDIR + project directory.
 *
 * realpath matters on macOS, where os.tmpdir() is a symlink into /private and
 * the guards compare resolved paths as strings.
 */
function sandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-')));
  const home = path.join(base, 'home');
  const tmp = path.join(base, 'tmp');
  const cwd = path.join(base, 'project');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  return { base, home, tmp, cwd };
}

/** Write a config file and return its path, for use with the *_CONFIG env var. */
function config(sb, name, obj) {
  const file = path.join(sb.base, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
}

/**
 * Run a hook.
 *
 * The environment is built from scratch rather than inherited, so a developer
 * with SECRET_GUARD_CONFIG exported cannot change what the suite sees.
 */
function run(script, input, opts = {}) {
  const sb = opts.sandbox;
  if (!sb) throw new Error('run() needs a sandbox');

  const res = spawnSync(process.execPath, [script, ...(opts.args || [])], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    timeout: opts.timeout || 20000,
    env: {
      PATH: process.env.PATH,
      HOME: sb.home,
      USERPROFILE: sb.home,
      TMPDIR: sb.tmp,
      TMP: sb.tmp,
      TEMP: sb.tmp,
      ...(opts.env || {}),
    },
  });

  if (res.error) throw res.error;

  let json = null;
  if (res.stdout && res.stdout.trim()) {
    try {
      json = JSON.parse(res.stdout);
    } catch {
      json = null;
    }
  }

  const out = json && json.hookSpecificOutput ? json.hookSpecificOutput : {};
  return {
    code: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    json,
    /** 'deny' | 'escalate' | undefined */
    decision: out.permissionDecision,
    reason: out.permissionDecisionReason || '',
    context: out.additionalContext || '',
    systemMessage: json ? json.systemMessage : undefined,
    /** A guard with nothing to say says nothing at all. */
    silent: res.status === 0 && res.stdout.trim() === '',
  };
}

/** Recursively collect files under dir, skipping .git. */
function walk(dir, ext, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, found);
    else if (entry.name.endsWith(ext)) found.push(full);
  }
  return found;
}

module.exports = { REPO, hook, sandbox, config, run, walk };
