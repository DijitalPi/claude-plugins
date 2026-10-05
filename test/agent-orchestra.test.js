'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { hook, sandbox, run } = require('./helpers');

const SCRIPT = hook('agent-orchestra');
const NO_SENDER = { AGENT_ORCHESTRA_NO_SENDER: '1' };

const dir = (sb) => path.join(sb.home, '.claude', 'agent-orchestra');
const spool = (sb) => path.join(dir(sb), 'spool.log');
const lines = (sb) => (fs.existsSync(spool(sb)) ? fs.readFileSync(spool(sb), 'utf8').trim().split('\n') : []);
const kinds = (sb) => lines(sb).map((l) => l.split(' ')[2]);

function fire(sb, input, env = {}) {
  return run(SCRIPT, { session_id: 's1', cwd: sb.cwd, ...input }, { sandbox: sb, env: { ...NO_SENDER, ...env } });
}

/** spawnSync would block the in-process test server, so the sender runs async here. */
function runAsync(sb, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { PATH: process.env.PATH, HOME: sb.home, USERPROFILE: sb.home, TMPDIR: sb.tmp, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', (code) => resolve({ code, out }));
  });
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('a tool call becomes one "step" line, silently', () => {
  const sb = sandbox();
  const res = fire(sb, { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/x' } });
  assert.ok(res.silent);
  assert.deepEqual(kinds(sb), ['step']);
});

test('a prompt marks the session busy and Stop marks it done', () => {
  const sb = sandbox();
  fire(sb, { hook_event_name: 'UserPromptSubmit', prompt: 'secret plan' });
  fire(sb, { hook_event_name: 'Stop' });
  assert.deepEqual(kinds(sb), ['busy', 'done']);
});

test('a git commit is a "ship" signal, and the command itself is never written down', () => {
  const sb = sandbox();
  fire(sb, {
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "launch the secret project"' },
    tool_response: { stdout: '[main 1a2b3c] launch', stderr: '' },
  });
  assert.deepEqual(kinds(sb), ['step', 'ship']);
  assert.ok(!fs.readFileSync(spool(sb), 'utf8').includes('secret'), 'command text leaked into the spool');
});

test('"tests passed" only when nothing failed', () => {
  const sb = sandbox();
  const bash = (stdout) => fire(sb, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout, stderr: '' } });
  bash('==== 34 passed in 0.3s ====');
  bash('2 failed, 32 passed');
  assert.deepEqual(kinds(sb), ['step', 'pass', 'step']);
});

test('a project can switch it off for itself', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(sb.cwd, '.claude', 'agent-orchestra.json'), JSON.stringify({ enabled: false }));
  const res = fire(sb, { hook_event_name: 'PostToolUse', tool_name: 'Read' });
  assert.ok(res.silent);
  assert.deepEqual(lines(sb), []);
});

test('a project cannot redirect where data goes', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.cwd, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(sb.cwd, '.claude', 'agent-orchestra.json'), JSON.stringify({ server: 'http://evil.example' }));
  const res = spawnSync(process.execPath, [SCRIPT, '--status'], {
    cwd: sb.cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: sb.home, USERPROFILE: sb.home, TMPDIR: sb.tmp },
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /orchestra\.dijitalpi\.com/);
  assert.doesNotMatch(res.stdout, /evil/);
});

test('the first session gets a one-time notice, then silence', () => {
  const sb = sandbox();
  const first = fire(sb, { hook_event_name: 'SessionStart' });
  assert.match(first.systemMessage || '', /Agent Orchestra is on/);
  assert.match(first.systemMessage, /never code or prompts/);
  const second = fire(sb, { hook_event_name: 'SessionStart' });
  assert.ok(second.silent);
});

test('fails open on garbage input', () => {
  const sb = sandbox();
  const res = run(SCRIPT, 'not json at all', { sandbox: sb, env: NO_SENDER });
  assert.ok(res.silent);
});

test('the spool never grows without bound', () => {
  const sb = sandbox();
  fs.mkdirSync(dir(sb), { recursive: true });
  fs.writeFileSync(spool(sb), 'x'.repeat(600 * 1024));
  fire(sb, { hook_event_name: 'PostToolUse', tool_name: 'Read' });
  assert.ok(fs.statSync(spool(sb)).size < 1024);
});

test('the sender reports counts and signals, never content, and empties the spool', async () => {
  const sb = sandbox();
  const received = [];
  const server = await listen((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ section: 'strings', seat: 4, players: 12 }));
    });
  });
  fire(sb, { hook_event_name: 'UserPromptSubmit', prompt: 'build the thing' });
  fire(sb, { hook_event_name: 'PostToolUse', tool_name: 'Edit' });
  fire(sb, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git push' }, tool_response: { stdout: 'ok' } });

  const url = `http://127.0.0.1:${server.address().port}`;
  const result = await runAsync(sb, ['--send-once'], { AGENT_ORCHESTRA_URL: url });
  server.close();

  assert.equal(result.code, 0);
  assert.equal(received.length, 1);
  const { url: route, body } = received[0];
  assert.equal(route, '/api/play');
  assert.match(body.id, /^[a-f0-9]{32}$/);
  assert.equal(body.steps, 2);
  assert.equal(body.working, true);
  assert.equal(body.sessions, 1);
  assert.deepEqual(body.signals, ['ship']);
  assert.deepEqual(body.tools, { claude: 1 });
  assert.deepEqual(Object.keys(body).sort(), ['id', 'sessions', 'signals', 'steps', 'tools', 'working']);
  assert.ok(!JSON.stringify(body).includes('build the thing'));
  assert.ok(!fs.existsSync(spool(sb)), 'spool should be drained');

  const status = JSON.parse(fs.readFileSync(path.join(dir(sb), 'status.json'), 'utf8'));
  assert.equal(status.section, 'strings');
  const shown = spawnSync(process.execPath, [SCRIPT, '--status'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: sb.home, USERPROFILE: sb.home, AGENT_ORCHESTRA_URL: url },
  });
  assert.match(shown.stdout, /strings, seat 5, with 12 machines/);
});

test('the sender keeps the same id across runs', async () => {
  const sb = sandbox();
  const ids = [];
  const server = await listen((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { ids.push(JSON.parse(body).id); res.end('{}'); });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (let i = 0; i < 2; i++) {
    fire(sb, { hook_event_name: 'PostToolUse', tool_name: 'Read' });
    await runAsync(sb, ['--send-once'], { AGENT_ORCHESTRA_URL: url });
  }
  server.close();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test('an unreachable orchestra changes nothing', async () => {
  const sb = sandbox();
  fire(sb, { hook_event_name: 'PostToolUse', tool_name: 'Read' });
  const started = Date.now();
  const result = await runAsync(sb, ['--send-once'], { AGENT_ORCHESTRA_URL: 'http://127.0.0.1:9' });
  assert.equal(result.code, 0);
  assert.equal(result.out, '');
  assert.ok(Date.now() - started < 5000);
});
