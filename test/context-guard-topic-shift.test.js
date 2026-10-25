'use strict';
/**
 * topicShift: the optional "is this a new task?" check.
 *
 * The hook asks a TypeSafe System One model (Jev) one yes/no question over the
 * conversation tail. These tests stand up a fake TypeSafe endpoint in-process,
 * so nothing here touches the network. Because the fake server lives in this
 * process, the hook is run with an async spawn rather than helpers.run(), whose
 * spawnSync would block the event loop the server needs to answer.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { hook, sandbox, config } = require('./helpers');

const SCRIPT = hook('context-guard');

function setPercent(sb, sessionId, pct) {
  const dir = path.join(sb.tmp, 'claude-context-guard');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sessionId}.pct`), String(pct));
}

/** A transcript with real user prompts, noise the hook must skip, and replies. */
function transcript(sb) {
  const file = path.join(sb.base, 'transcript.jsonl');
  const rows = [
    { type: 'user', message: { role: 'user', content: 'CARDFLOWPI rapor ekranındaki grafik boş geliyor, bakar mısın?' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Grafiği besleyen sorguya bakıyorum.' }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'tool output' }] } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'Base directory for this skill: ...' } },
    { type: 'user', message: { role: 'user', content: '<command-name>/kk</command-name>' } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Tamam, tarih filtresini de düzelt.' }] } },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 't2', name: 'Edit', input: {} },
          { type: 'text', text: 'Tarih filtresi düzeldi, grafik artık dolu geliyor.' },
        ],
        usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    },
  ];
  fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return file;
}

/** Fake TypeSafe endpoint, closed when the test ends. `answer` is the Noul probability, or a function of the request. */
async function fakeJev(t, answer, opts = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let json = null;
      try {
        json = JSON.parse(body);
      } catch {
        /* recorded as null */
      }
      calls.push({ headers: req.headers, body: json });
      if (opts.status) {
        res.writeHead(opts.status);
        res.end('nope');
        return;
      }
      if (opts.hang) return; // never answers: the hook must time out on its own
      const p = typeof answer === 'function' ? answer(json) : answer;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { new_task: { type: 'noul', noul: p } } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/v1/systemone`;
  let closed = false;
  const close = () => {
    if (closed) return Promise.resolve();
    closed = true;
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  };
  // A failed assertion must not leave the server holding the test process open.
  t.after(close);
  return { url, calls, close };
}

function runAsync(input, sb, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, HOME: sb.home, USERPROFILE: sb.home, TMPDIR: sb.tmp, TMP: sb.tmp, TEMP: sb.tmp, ...env },
    });
    let stdout = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.on('error', reject);
    child.on('close', (code) => {
      let json = null;
      try {
        json = stdout.trim() ? JSON.parse(stdout) : null;
      } catch {
        json = null;
      }
      const out = json && json.hookSpecificOutput ? json.hookSpecificOutput : {};
      resolve({
        code,
        stdout,
        context: out.additionalContext || '',
        systemMessage: json ? json.systemMessage : undefined,
        silent: code === 0 && stdout.trim() === '',
      });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

const NEW_TASK = 'Şimdi Leodent için yarın gidecek karşılama mailini hazırlayalım.';

/** One prompt through the hook with topicShift on, against the fake endpoint. */
function ask(sb, jev, opts = {}) {
  const cfg = {
    threshold: 80,
    saveCommand: '/kk',
    topicShift: { enabled: true, endpoint: jev.url, minPercent: 15, probability: 0.8, cooldown: 3, ...(opts.topicShift || {}) },
    ...(opts.cfg || {}),
  };
  const input = {
    session_id: 'sess-1',
    cwd: sb.cwd,
    prompt: opts.prompt === undefined ? NEW_TASK : opts.prompt,
    transcript_path: opts.transcript === undefined ? transcript(sb) : opts.transcript,
  };
  const env = { CONTEXT_GUARD_CONFIG: config(sb, 'context-guard', cfg) };
  if (opts.key !== null) env.TYPESAFE_API_KEY = opts.key || 'test-key';
  return runAsync(input, sb, env);
}

test('topicShift is off unless enabled', async (t) => {
  const sb = sandbox();
  const jev = await fakeJev(t, 0.99);
  setPercent(sb, 'sess-1', 30);
  const r = await runAsync(
    { session_id: 'sess-1', cwd: sb.cwd, prompt: NEW_TASK, transcript_path: transcript(sb) },
    sb,
    { CONTEXT_GUARD_CONFIG: config(sb, 'context-guard', { threshold: 80 }), TYPESAFE_API_KEY: 'test-key' }
  );
  await jev.close();
  assert.ok(r.silent);
  assert.equal(jev.calls.length, 0);
});

test('a new task in a heavy window suggests saving and starting fresh', async (t) => {
  const sb = sandbox();
  const jev = await fakeJev(t, 0.93);
  setPercent(sb, 'sess-1', 30);
  const r = await ask(sb, jev);
  await jev.close();

  assert.match(r.context, /<context-guard>/);
  assert.match(r.context, /new task/i);
  assert.match(r.context, /30% full/);
  assert.match(r.context, /\/kk/);
  assert.match(String(r.systemMessage), /New task\?/);
  assert.match(String(r.systemMessage), /30%/);
});

test('it sends Jev one Noul over the conversation tail', async (t) => {
  const sb = sandbox();
  const jev = await fakeJev(t, 0.1);
  setPercent(sb, 'sess-1', 30);
  await ask(sb, jev, { key: 'k-123' });
  await jev.close();

  assert.equal(jev.calls.length, 1);
  const { headers, body } = jev.calls[0];
  assert.equal(headers.authorization, 'Bearer k-123');
  assert.equal(body.model, 'jev-1.13.0');
  assert.equal(body.questions.new_task.type, 'noul');
  assert.equal(body.state.new_message, NEW_TASK);
  assert.deepEqual(body.state.previous_user_messages, [
    'CARDFLOWPI rapor ekranındaki grafik boş geliyor, bakar mısın?',
    'Tamam, tarih filtresini de düzelt.',
  ]);
  assert.equal(body.state.last_assistant_reply, 'Tarih filtresi düzeldi, grafik artık dolu geliyor.');
});

test('a follow-up stays quiet', async (t) => {
  const sb = sandbox();
  const jev = await fakeJev(t, 0.2);
  setPercent(sb, 'sess-1', 30);
  const r = await ask(sb, jev, { prompt: 'Peki boş tarih aralığında ne gösteriyor?' });
  await jev.close();
  assert.ok(r.silent);
  assert.equal(jev.calls.length, 1);
});

test('below minPercent a fresh start saves little, so Jev is not asked', async (t) => {
  const sb = sandbox();
  const jev = await fakeJev(t, 0.99);
  setPercent(sb, 'sess-1', 9);
  const r = await ask(sb, jev);
  await jev.close();
  assert.ok(r.silent);
  assert.equal(jev.calls.length, 0);
});

test('over the threshold the regular warning wins and Jev is not asked', async (t) => {
  const sb = sandbox();
  const jev = await fakeJev(t, 0.99);
  setPercent(sb, 'sess-1', 85);
  const r = await ask(sb, jev);
  await jev.close();
  assert.match(r.context, /Wrap this session up cleanly/);
  assert.doesNotMatch(r.context, /new task/i);
  assert.equal(jev.calls.length, 0);
});

test('after a suggestion it stays quiet for `cooldown` prompts', async (t) => {
  const sb = sandbox();
  const jev = await fakeJev(t, 0.95);
  setPercent(sb, 'sess-1', 30);
  assert.match((await ask(sb, jev)).context, /new task/i);
  assert.ok((await ask(sb, jev)).silent, 'prompt 2 is quiet');
  assert.ok((await ask(sb, jev)).silent, 'prompt 3 is quiet');
  assert.match((await ask(sb, jev)).context, /new task/i, 'prompt 4 may suggest again');
  await jev.close();
  assert.equal(jev.calls.length, 2, 'quiet prompts cost no Jev call');
});

test('clearing the conversation resets the cooldown', async (t) => {
  const sb = sandbox();
  const jev = await fakeJev(t, 0.95);
  setPercent(sb, 'sess-1', 30);
  assert.match((await ask(sb, jev)).context, /new task/i);
  setPercent(sb, 'sess-1', 3); // /clear
  assert.ok((await ask(sb, jev)).silent);
  setPercent(sb, 'sess-1', 30);
  assert.match((await ask(sb, jev)).context, /new task/i);
  await jev.close();
});

test('slash commands, short replies and a first prompt are not judged', async (t) => {
  const sb = sandbox();
  const jev = await fakeJev(t, 0.99);
  setPercent(sb, 'sess-1', 30);
  for (const prompt of ['/kk', 'tamam', '3', 'evet devam']) {
    assert.ok((await ask(sb, jev, { prompt })).silent, `"${prompt}" is not judged`);
  }
  const empty = path.join(sb.base, 'empty.jsonl');
  fs.writeFileSync(empty, '');
  assert.ok((await ask(sb, jev, { transcript: empty })).silent, 'nothing to compare against');
  await jev.close();
  assert.equal(jev.calls.length, 0);
});

test('without an API key it stays quiet and makes no request', async (t) => {
  const sb = sandbox();
  const jev = await fakeJev(t, 0.99);
  setPercent(sb, 'sess-1', 30);
  const r = await ask(sb, jev, { key: null });
  await jev.close();
  assert.ok(r.silent);
  assert.equal(jev.calls.length, 0);
});

test('the key can come from an env-style file', async (t) => {
  const sb = sandbox();
  const jev = await fakeJev(t, 0.95);
  setPercent(sb, 'sess-1', 30);
  const keyFile = path.join(sb.home, 'typesafe.env');
  fs.writeFileSync(keyFile, '# comment\nOTHER=1\nTYPESAFE_API_KEY="from-file"\n');
  const r = await ask(sb, jev, { key: null, topicShift: { apiKeyFile: keyFile } });
  await jev.close();
  assert.match(r.context, /new task/i);
  assert.equal(jev.calls[0].headers.authorization, 'Bearer from-file');
});

test('fails open when Jev errors, hangs or answers nonsense', async (t) => {
  for (const opts of [{ status: 500 }, { hang: true }]) {
    const sb = sandbox();
    const jev = await fakeJev(t, 0.99, opts);
    setPercent(sb, 'sess-1', 30);
    const started = Date.now();
    const r = await ask(sb, jev, { topicShift: { timeoutMs: 300 } });
    await jev.close();
    assert.equal(r.code, 0);
    assert.ok(r.silent, JSON.stringify(opts));
    assert.ok(Date.now() - started < 4000, 'a hung endpoint does not hold the prompt');
  }
  const sb = sandbox();
  const jev = await fakeJev(t, () => 'not-a-number');
  setPercent(sb, 'sess-1', 30);
  const r = await ask(sb, jev);
  await jev.close();
  assert.ok(r.silent);
});
