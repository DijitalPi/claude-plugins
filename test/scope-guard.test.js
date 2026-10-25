'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { hook, sandbox, config, run } = require('./helpers');

const SCRIPT = hook('scope-guard');

/** A directory that looks like a git repository to the guard. */
function repo(sb, name) {
  const dir = path.join(sb.base, name);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

/**
 * The default allowPaths include the OS temp directory prefixes, and every
 * sandbox lives under one — so tests that care about the boundary have to clear
 * the list, or macOS would allow everything through /var/folders.
 */
function attempt(sb, target, cfg = {}, tool = 'Write') {
  return run(
    SCRIPT,
    { tool_name: tool, cwd: sb.cwd, tool_input: { file_path: target, content: 'x' } },
    {
      sandbox: sb,
      env: { SCOPE_GUARD_CONFIG: config(sb, 'scope-guard', { allowPaths: [], ...cfg }) },
    }
  );
}

test('a write inside the project passes without comment', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const r = attempt(sb, path.join(sb.cwd, 'src', 'index.js'));
  assert.ok(r.silent, `expected silence, got: ${r.stdout}`);
});

test('a write outside the project asks, and names both paths', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const other = repo(sb, 'other-client');
  const target = path.join(other, 'wp-config.php');

  const r = attempt(sb, target);
  assert.equal(r.decision, 'escalate');
  assert.ok(r.reason.includes(target), 'the reason should name the target');
  assert.ok(r.reason.includes(sb.cwd), "the reason should name this session's project");
});

test('names the other repository explicitly — the case that pollutes someone else’s tree', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const other = repo(sb, 'other-client');
  const r = attempt(sb, path.join(other, 'index.php'));
  assert.match(r.reason, /different git repository/);
});

test('outsideProject:"deny" refuses instead of asking', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const other = repo(sb, 'other-client');
  const r = attempt(sb, path.join(other, 'index.php'), { outsideProject: 'deny' });
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /Refusing the write/);
});

test('outsideProject:"off" disables the boundary', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const other = repo(sb, 'other-client');
  const r = attempt(sb, path.join(other, 'index.php'), { outsideProject: 'off' });
  assert.ok(r.silent);
});

test('extraRoots admits a sibling repo you work across on purpose', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const other = repo(sb, 'shared-assets');
  const r = attempt(sb, path.join(other, 'logo.svg'), { extraRoots: [other] });
  assert.ok(r.silent, `expected silence, got: ${r.stdout}`);
});

test('allowPaths expands ~', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const r = attempt(sb, path.join(sb.home, '.claude', 'settings.json'), {
    allowPaths: ['~/.claude'],
  });
  assert.ok(r.silent, `expected silence, got: ${r.stdout}`);
});

test('a relative path is inside the project by construction', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const r = attempt(sb, 'src/index.js');
  assert.ok(r.silent);
});

test('without a git repository the working directory is the boundary', () => {
  const sb = sandbox();
  const inside = attempt(sb, path.join(sb.cwd, 'notes.md'));
  assert.ok(inside.silent);

  const outside = attempt(sb, path.join(sb.base, 'elsewhere', 'notes.md'));
  assert.equal(outside.decision, 'escalate');
});

test('the boundary is the repository root, not the working directory', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const nested = path.join(sb.cwd, 'packages', 'api');
  fs.mkdirSync(nested, { recursive: true });

  // Working inside a subdirectory, writing to a sibling subdirectory: still the
  // same repository, so nothing to say.
  const r = run(
    SCRIPT,
    {
      tool_name: 'Write',
      cwd: nested,
      tool_input: { file_path: path.join(sb.cwd, 'packages', 'web', 'app.js'), content: 'x' },
    },
    { sandbox: sb, env: { SCOPE_GUARD_CONFIG: config(sb, 'scope-guard', { allowPaths: [] }) } }
  );
  assert.ok(r.silent, `expected silence, got: ${r.stdout}`);
});

test('applies to Edit and NotebookEdit, ignores everything else', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const other = repo(sb, 'other-client');

  for (const tool of ['Edit', 'NotebookEdit']) {
    const r = run(
      SCRIPT,
      {
        tool_name: tool,
        cwd: sb.cwd,
        tool_input:
          tool === 'NotebookEdit'
            ? { notebook_path: path.join(other, 'a.ipynb'), new_source: 'x' }
            : { file_path: path.join(other, 'a.js'), new_string: 'x' },
      },
      { sandbox: sb, env: { SCOPE_GUARD_CONFIG: config(sb, 'scope-guard', { allowPaths: [] }) } }
    );
    assert.equal(r.decision, 'escalate', `${tool} is covered`);
  }

  for (const tool of ['Bash', 'Read', 'Grep']) {
    const r = attempt(sb, path.join(other, 'a.js'), {}, tool);
    assert.ok(r.silent, `${tool} should be ignored`);
  }
});

test('enabled:false turns it off completely', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const other = repo(sb, 'other-client');
  const r = attempt(sb, path.join(other, 'a.js'), { enabled: false });
  assert.ok(r.silent);
});

test('never answers "allow"', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.git'), { recursive: true });
  const other = repo(sb, 'other-client');
  for (const target of [path.join(sb.cwd, 'a.js'), path.join(other, 'a.js')]) {
    const r = attempt(sb, target);
    assert.notEqual(r.decision, 'allow');
  }
});

test('fails open on unparsable stdin and on a call with no target', () => {
  const sb = sandbox();
  for (const bad of ['', 'not json', 'null']) {
    const r = run(SCRIPT, bad, { sandbox: sb });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), '');
  }
  const noTarget = run(SCRIPT, { tool_name: 'Write', cwd: sb.cwd, tool_input: {} }, { sandbox: sb });
  assert.ok(noTarget.silent);
});
