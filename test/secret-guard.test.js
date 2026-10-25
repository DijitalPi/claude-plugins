'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { hook, sandbox, config, run } = require('./helpers');

const SCRIPT = hook('secret-guard');

/**
 * Key-shaped strings are assembled at runtime rather than written out, so this
 * file does not itself contain anything that looks like a credential — to
 * secret-guard, to GitHub's secret scanning, or to whoever greps the repo next.
 * (Writing them out literally is not a hypothetical problem: it fails, because
 * the guard blocks the write.)
 */
const AWS_KEY = 'AKIA' + 'Q3RJ7K2MNPZW5YB4';
const GH_TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const PEM = '-----BEGIN RSA ' + 'PRIVATE KEY-----';

function write(sb, filePath, content, cfg) {
  return run(
    SCRIPT,
    { tool_name: 'Write', cwd: sb.cwd, tool_input: { file_path: filePath, content } },
    { sandbox: sb, env: cfg ? { SECRET_GUARD_CONFIG: config(sb, 'secret-guard', cfg) } : {} }
  );
}

test('denies a write containing an AWS access key id', () => {
  const sb = sandbox();
  const r = write(sb, path.join(sb.cwd, 'config.js'), `const id = "${AWS_KEY}";\n`);
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /AWS access key ID/);
  assert.match(r.reason, /config\.js/);
});

test('redacts the credential instead of echoing it back', () => {
  const sb = sandbox();
  const r = write(sb, path.join(sb.cwd, 'config.js'), `const id = "${AWS_KEY}";\n`);
  assert.equal(r.decision, 'deny');
  assert.ok(!r.reason.includes(AWS_KEY), 'the full key must not appear in the reason');
  assert.match(r.reason, /…/);
});

test('denies a GitHub token', () => {
  const sb = sandbox();
  const r = write(sb, path.join(sb.cwd, 'deploy.sh'), `TOKEN=${GH_TOKEN}\n`);
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /GitHub token/);
});

test('lets an obvious placeholder through', () => {
  const sb = sandbox();
  const r = write(sb, path.join(sb.cwd, 'README.md'), `AWS_KEY=your-key-here-${AWS_KEY}\n`);
  assert.ok(r.silent, `expected silence, got: ${r.stdout}`);
});

test('leaves .env files alone — that is where a key belongs', () => {
  const sb = sandbox();
  for (const name of ['.env', '.env.local', '.env.production']) {
    const r = write(sb, path.join(sb.cwd, name), `AWS_ACCESS_KEY_ID=${AWS_KEY}\n`);
    assert.ok(r.silent, `${name} should be allowed, got: ${r.stdout}`);
  }
});

test('a private key block is denied even when the surrounding line reads like an example', () => {
  const sb = sandbox();
  const r = write(sb, path.join(sb.cwd, 'example.pem'), `# example key\n${PEM}\nMIIEpAIBAAKC\n`);
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /private key block/);
});

test('covers Edit via new_string', () => {
  const sb = sandbox();
  const r = run(
    SCRIPT,
    {
      tool_name: 'Edit',
      cwd: sb.cwd,
      tool_input: {
        file_path: path.join(sb.cwd, 'a.js'),
        old_string: 'x',
        new_string: `k="${AWS_KEY}"`,
      },
    },
    { sandbox: sb }
  );
  assert.equal(r.decision, 'deny');
});

test('covers NotebookEdit via new_source', () => {
  const sb = sandbox();
  const r = run(
    SCRIPT,
    {
      tool_name: 'NotebookEdit',
      cwd: sb.cwd,
      tool_input: { notebook_path: path.join(sb.cwd, 'a.ipynb'), new_source: `k="${AWS_KEY}"` },
    },
    { sandbox: sb }
  );
  assert.equal(r.decision, 'deny');
});

test('ignores tools that do not write files', () => {
  const sb = sandbox();
  for (const tool of ['Bash', 'Read', 'Grep', 'WebFetch']) {
    const r = run(
      SCRIPT,
      { tool_name: tool, cwd: sb.cwd, tool_input: { command: AWS_KEY } },
      { sandbox: sb }
    );
    assert.ok(r.silent, `${tool} should be ignored`);
  }
});

test('stays quiet on ordinary content', () => {
  const sb = sandbox();
  const r = write(sb, path.join(sb.cwd, 'index.js'), 'export const hello = () => "world";\n');
  assert.ok(r.silent);
});

test('disablePatterns switches a single pattern off', () => {
  const sb = sandbox();
  const r = write(sb, path.join(sb.cwd, 'a.js'), `k="${AWS_KEY}"`, {
    disablePatterns: ['aws-access-key-id'],
  });
  assert.ok(r.silent, `expected silence, got: ${r.stdout}`);
});

test('extraPatterns adds a project-specific shape', () => {
  const sb = sandbox();
  const r = write(sb, path.join(sb.cwd, 'a.js'), 'const t = "DPI-SECRET-99182";', {
    extraPatterns: ['DPI-SECRET-[0-9]{5}'],
  });
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /custom pattern/);
});

test('a broken regex in extraPatterns does not take the guard down', () => {
  const sb = sandbox();
  const r = write(sb, path.join(sb.cwd, 'a.js'), `k="${AWS_KEY}"`, {
    extraPatterns: ['([unclosed'],
  });
  assert.equal(r.code, 0);
  assert.equal(r.decision, 'deny', 'the built-in patterns still run');
});

test('allowFiles is configurable', () => {
  const sb = sandbox();
  const r = write(sb, path.join(sb.cwd, 'secrets.tfvars'), `key = "${AWS_KEY}"`, {
    allowFiles: ['secrets.tfvars'],
  });
  assert.ok(r.silent);
});

test('enabled:false turns it off completely', () => {
  const sb = sandbox();
  const r = write(sb, path.join(sb.cwd, 'a.js'), `k="${AWS_KEY}"`, { enabled: false });
  assert.ok(r.silent);
});

test('never answers "allow" — a guard does not widen permissions', () => {
  const sb = sandbox();
  const cases = [
    ['clean.js', 'const a = 1;'],
    ['dirty.js', `k="${AWS_KEY}"`],
    ['.env', `AWS=${AWS_KEY}`],
  ];
  for (const [name, content] of cases) {
    const r = write(sb, path.join(sb.cwd, name), content);
    assert.notEqual(r.decision, 'allow', `${name} must never be allowed outright`);
  }
});

test('fails open on unparsable stdin', () => {
  const sb = sandbox();
  for (const bad of ['', 'not json', '[]', 'null']) {
    const r = run(SCRIPT, bad, { sandbox: sb });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), '');
  }
});
