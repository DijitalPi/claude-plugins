'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { hook, sandbox, config, run } = require('./helpers');

const SCRIPT = hook('install-guard');

/**
 * The registry lookup is cached in the temp directory, and the sandbox owns the
 * temp directory — so seeding the cache is enough to make every decision path
 * testable without touching the network. Anything not seeded falls through to a
 * request that cannot succeed inside the 1ms timeout below, which is the
 * fail-open path: no opinion, no output.
 */
function seed(sb, ecosystem, name, value) {
  const dir = path.join(sb.tmp, 'claude-install-guard');
  fs.mkdirSync(dir, { recursive: true });
  const key = `${ecosystem}:${name}`.replace(/[^\w.@-]/g, '_');
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(value));
}

const ESTABLISHED = { exists: true, ageDays: 3000, weeklyDownloads: 5000000 };
const MISSING = { exists: false };

function bash(sb, command, cfg = {}) {
  return run(
    SCRIPT,
    { tool_name: 'Bash', cwd: sb.cwd, tool_input: { command } },
    {
      sandbox: sb,
      env: { INSTALL_GUARD_CONFIG: config(sb, 'install-guard', { timeoutMs: 1, ...cfg }) },
    }
  );
}

test('denies a package the registry has never heard of', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'react-datepicker-pro', MISSING);
  const r = bash(sb, 'npm install react-datepicker-pro');
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /does not exist in the registry/);
  assert.match(r.reason, /react-datepicker-pro/);
});

test('lists every missing package at once', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'ghost-one', MISSING);
  seed(sb, 'npm', 'ghost-two', MISSING);
  const r = bash(sb, 'npm i ghost-one ghost-two');
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /these packages do not exist/);
  assert.match(r.reason, /ghost-one, ghost-two/);
});

test('escalates a package that was published days ago', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'brand-new-thing', { exists: true, ageDays: 3, weeklyDownloads: 5000000 });
  const r = bash(sb, 'npm i brand-new-thing');
  assert.equal(r.decision, 'escalate');
  assert.match(r.reason, /first published 3 days ago/);
});

test('escalates a package almost nobody downloads', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'lonely-pkg', { exists: true, ageDays: 3000, weeklyDownloads: 12 });
  const r = bash(sb, 'npm i lonely-pkg');
  assert.equal(r.decision, 'escalate');
  assert.match(r.reason, /12 downloads last week/);
});

test('says nothing about an established package', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'react', ESTABLISHED);
  const r = bash(sb, 'npm install react');
  assert.ok(r.silent, `expected silence, got: ${r.stdout}`);
});

test('sees through shell separators', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'ghost-pkg', MISSING);
  for (const cmd of [
    'cd app && npm i ghost-pkg',
    'echo hi; npm install ghost-pkg',
    'npm ci || npm install ghost-pkg',
  ]) {
    const r = bash(sb, cmd);
    assert.equal(r.decision, 'deny', `should have caught: ${cmd}`);
  }
});

test('covers npm, pnpm, yarn, bun, pip and uv', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'ghost-pkg', MISSING);
  seed(sb, 'pypi', 'ghost-pkg', MISSING);
  const commands = [
    'npm install ghost-pkg',
    'npm i ghost-pkg',
    'npm add ghost-pkg',
    'pnpm add ghost-pkg',
    'bun add ghost-pkg',
    'yarn add ghost-pkg',
    'pip install ghost-pkg',
    'pip3 install ghost-pkg',
    'uv pip install ghost-pkg',
  ];
  for (const cmd of commands) {
    const r = bash(sb, cmd);
    assert.equal(r.decision, 'deny', `should have caught: ${cmd}`);
  }
});

test('strips version specifiers before looking a package up', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'ghost-pkg', MISSING);
  seed(sb, 'npm', '@scope/ghost-pkg', MISSING);
  seed(sb, 'pypi', 'ghost-pkg', MISSING);
  for (const cmd of [
    'npm i ghost-pkg@1.2.3',
    'npm i ghost-pkg@^2',
    'npm i @scope/ghost-pkg@1.0.0',
    'pip install ghost-pkg==1.2',
    'pip install ghost-pkg>=1.0',
    'pip install ghost-pkg[extra]',
  ]) {
    const r = bash(sb, cmd);
    assert.equal(r.decision, 'deny', `should have caught: ${cmd}`);
  }
});

test('ignores commands that do not install from a registry', () => {
  const sb = sandbox();
  for (const cmd of [
    'npm ci',
    'npm install',
    'npm install --production',
    'yarn',
    'npm i ./local-package',
    'npm i ../sibling',
    'npm i file:../thing',
    'npm i git+https://github.com/someone/thing.git',
    'npm i github:someone/thing',
    'pip install -r requirements.txt',
    'npm run build',
    'npm test',
  ]) {
    const r = bash(sb, cmd);
    assert.ok(r.silent, `should have ignored: ${cmd} — got ${r.stdout}`);
  }
});

test('allowlist skips the check entirely', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'internal-thing', MISSING);
  const r = bash(sb, 'npm i internal-thing', { allowlist: ['internal-thing'] });
  assert.ok(r.silent, `expected silence, got: ${r.stdout}`);
});

test('blockUnknown:false downgrades the missing-package deny', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'ghost-pkg', MISSING);
  const r = bash(sb, 'npm i ghost-pkg', { blockUnknown: false });
  assert.notEqual(r.decision, 'deny');
});

test('thresholds are configurable', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'smallish', { exists: true, ageDays: 200, weeklyDownloads: 500 });
  assert.ok(bash(sb, 'npm i smallish', { minWeeklyDownloads: 100 }).silent);
  assert.equal(bash(sb, 'npm i smallish', { minWeeklyDownloads: 1000 }).decision, 'escalate');
  assert.equal(bash(sb, 'npm i smallish', { minAgeDays: 365 }).decision, 'escalate');
});

test('checks at most ten packages per command — a documented bound, not a silent one', () => {
  const sb = sandbox();
  const names = [];
  for (let i = 0; i < 12; i++) {
    const name = `pkg-${i}`;
    names.push(name);
    seed(sb, 'npm', name, i === 11 ? MISSING : ESTABLISHED);
  }
  const r = bash(sb, `npm i ${names.join(' ')}`);
  assert.ok(r.silent, 'the 12th package is past the bound, so it is not inspected');

  const reordered = bash(sb, `npm i ${names[11]} ${names.slice(0, 11).join(' ')}`);
  assert.equal(reordered.decision, 'deny', 'the same package inside the bound is caught');
});

test('ignores tools other than Bash', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'ghost-pkg', MISSING);
  for (const tool of ['Write', 'Read', 'Edit']) {
    const r = run(
      SCRIPT,
      { tool_name: tool, cwd: sb.cwd, tool_input: { command: 'npm i ghost-pkg' } },
      { sandbox: sb }
    );
    assert.ok(r.silent, `${tool} should be ignored`);
  }
});

test('enabled:false turns it off completely', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'ghost-pkg', MISSING);
  const r = bash(sb, 'npm i ghost-pkg', { enabled: false });
  assert.ok(r.silent);
});

test('never answers "allow"', () => {
  const sb = sandbox();
  seed(sb, 'npm', 'react', ESTABLISHED);
  seed(sb, 'npm', 'ghost-pkg', MISSING);
  for (const cmd of ['npm i react', 'npm i ghost-pkg', 'npm ci']) {
    assert.notEqual(bash(sb, cmd).decision, 'allow', cmd);
  }
});

test('fails open when the registry cannot be reached', () => {
  const sb = sandbox();
  // Nothing seeded and a 1ms timeout: the lookup cannot succeed, and the
  // command has to proceed anyway.
  const r = bash(sb, 'npm i some-package-nobody-seeded');
  assert.ok(r.silent, `expected silence, got: ${r.stdout}`);
});

test('fails open on unparsable stdin and on an empty command', () => {
  const sb = sandbox();
  for (const bad of ['', 'not json', 'null']) {
    const r = run(SCRIPT, bad, { sandbox: sb });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), '');
  }
  assert.ok(run(SCRIPT, { tool_name: 'Bash', tool_input: {} }, { sandbox: sb }).silent);
});
