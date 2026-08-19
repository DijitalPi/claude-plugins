'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { REPO, hook, sandbox, config, run } = require('./helpers');

const SCRIPT = hook('context-guard');
const STATUSLINE = path.join(REPO, 'plugins', 'context-guard', 'statusline', 'context-percent.js');

/** Write the percentage the statusline helper would have recorded. */
function setPercent(sb, sessionId, pct) {
  const dir = path.join(sb.tmp, 'claude-context-guard');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sessionId}.pct`), String(pct));
}

/** A transcript in the shape context-guard reads: JSONL, usage on the last turn. */
function transcript(sb, turns) {
  const file = path.join(sb.base, 'transcript.jsonl');
  const lines = turns.map((used) =>
    JSON.stringify({
      type: 'assistant',
      message: { usage: { input_tokens: used, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    })
  );
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

function prompt(sb, cfg = {}, extra = {}) {
  return run(
    SCRIPT,
    { session_id: 'sess-1', cwd: sb.cwd, prompt: 'carry on', ...extra },
    { sandbox: sb, env: { CONTEXT_GUARD_CONFIG: config(sb, 'context-guard', cfg) } }
  );
}

test('says nothing while there is room left', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 42);
  assert.ok(prompt(sb, { threshold: 80 }).silent);
});

test('warns once the window crosses the threshold', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 87);
  const r = prompt(sb, { threshold: 80 });
  assert.match(r.context, /<context-guard>/);
  assert.match(r.context, /87% full/);
  assert.match(r.context, /threshold: 80%/);
  assert.match(r.context, /clear the conversation/);
});

test('the first warning also surfaces in the terminal', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 91);
  const r = prompt(sb, { threshold: 80 });
  assert.match(String(r.systemMessage), /Context 91% full/);
});

test('showSystemMessage:false keeps it between Claude and the hook', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 91);
  const r = prompt(sb, { threshold: 80, showSystemMessage: false });
  assert.equal(r.systemMessage, undefined);
  assert.match(r.context, /91% full/);
});

test('saveCommand turns the warning into a workflow', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 85);
  const r = prompt(sb, { threshold: 80, saveCommand: '/kk' });
  assert.match(r.context, /Run \/kk to persist/);
  assert.match(String(r.systemMessage), /\/kk will run/);
});

test('extraInstructions are appended verbatim', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 85);
  const r = prompt(sb, { threshold: 80, extraInstructions: 'Also update the Obsidian note.' });
  assert.match(r.context, /Also update the Obsidian note\./);
});

test('the second warning is a short nudge, not the full drill', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 85);

  const first = prompt(sb, { threshold: 80, saveCommand: '/kk' });
  assert.match(first.context, /Wrap this session up cleanly/);

  const second = prompt(sb, { threshold: 80, saveCommand: '/kk' });
  assert.match(second.context, /still 85% full/);
  assert.match(second.context, /do not run it again/);
  assert.equal(second.systemMessage, undefined, 'only the first warning interrupts the terminal');
});

test('repeatEvery spaces out the reminders', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 85);
  const cfg = { threshold: 80, repeatEvery: 3 };

  assert.match(prompt(sb, cfg).context, /Wrap this session up cleanly/);
  assert.ok(prompt(sb, cfg).silent, 'prompt 2 is quiet');
  assert.ok(prompt(sb, cfg).silent, 'prompt 3 is quiet');
  assert.match(prompt(sb, cfg).context, /still 85% full/, 'prompt 4 nudges');
});

test('repeatEvery:0 warns exactly once', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 85);
  const cfg = { threshold: 80, repeatEvery: 0 };
  assert.match(prompt(sb, cfg).context, /Wrap this session up cleanly/);
  assert.ok(prompt(sb, cfg).silent);
  assert.ok(prompt(sb, cfg).silent);
});

test('clearing the conversation re-arms the full warning', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 85);
  assert.match(prompt(sb, { threshold: 80 }).context, /Wrap this session up cleanly/);

  setPercent(sb, 'sess-1', 5); // /clear
  assert.ok(prompt(sb, { threshold: 80 }).silent);

  setPercent(sb, 'sess-1', 88); // filling up again
  const again = prompt(sb, { threshold: 80 });
  assert.match(again.context, /Wrap this session up cleanly/, 'a fresh window gets a fresh warning');
});

test('sessions do not share state', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 85);
  setPercent(sb, 'sess-2', 85);
  assert.match(prompt(sb, { threshold: 80 }).context, /Wrap this session up cleanly/);
  const other = prompt(sb, { threshold: 80 }, { session_id: 'sess-2' });
  assert.match(other.context, /Wrap this session up cleanly/);
});

test('falls back to the transcript when the statusline helper is not installed', () => {
  const sb = sandbox();
  const file = transcript(sb, [20000, 180000]);
  const r = prompt(sb, { threshold: 80, contextLimit: 200000 }, { transcript_path: file });
  assert.match(r.context, /90% full/);
});

test('the transcript estimate respects contextLimit', () => {
  const sb = sandbox();
  const file = transcript(sb, [180000]);
  const r = prompt(sb, { threshold: 80, contextLimit: 1000000 }, { transcript_path: file });
  assert.ok(r.silent, '180k of a 1M window is not worth a warning');
});

test('the statusline percentage wins over the transcript estimate', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 10);
  const file = transcript(sb, [190000]);
  const r = prompt(sb, { threshold: 80, contextLimit: 200000 }, { transcript_path: file });
  assert.ok(r.silent, 'the exact number says there is room');
});

test('with no way to measure, it stays quiet', () => {
  const sb = sandbox();
  assert.ok(prompt(sb, { threshold: 80 }).silent);
  assert.ok(prompt(sb, { threshold: 80 }, { transcript_path: '/nonexistent/x.jsonl' }).silent);
});

test('a transcript with no usage data is not an error', () => {
  const sb = sandbox();
  const file = path.join(sb.base, 'weird.jsonl');
  fs.writeFileSync(file, 'not json\n{"type":"user"}\n{broken\n');
  const r = prompt(sb, { threshold: 80, contextLimit: 200000 }, { transcript_path: file });
  assert.equal(r.code, 0);
  assert.ok(r.silent);
});

test('enabled:false turns it off completely', () => {
  const sb = sandbox();
  setPercent(sb, 'sess-1', 99);
  assert.ok(prompt(sb, { enabled: false, threshold: 80 }).silent);
});

test('fails open on unparsable stdin and on a prompt with no session', () => {
  const sb = sandbox();
  for (const bad of ['', 'not json', 'null']) {
    const r = run(SCRIPT, bad, { sandbox: sb });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), '');
  }
  assert.ok(run(SCRIPT, { cwd: sb.cwd }, { sandbox: sb }).silent);
});

/* ------------------------------------------------------- statusline helper */

test('the statusline helper records the exact percentage for the hook', () => {
  const sb = sandbox();
  const r = run(
    STATUSLINE,
    { session_id: 'sess-1', context_window: { used_percentage: 63.4 } },
    { sandbox: sb }
  );
  assert.equal(r.code, 0);
  const recorded = fs.readFileSync(path.join(sb.tmp, 'claude-context-guard', 'sess-1.pct'), 'utf8');
  assert.equal(recorded, '63.4');

  // And the hook reads what it wrote.
  const warned = prompt(sb, { threshold: 60 });
  assert.match(warned.context, /63% full/);
});

test('the statusline helper prints nothing unless asked for a badge', () => {
  const sb = sandbox();
  const quiet = run(
    STATUSLINE,
    { session_id: 'sess-1', context_window: { used_percentage: 42 } },
    { sandbox: sb }
  );
  assert.equal(quiet.stdout, '');

  const badge = run(
    STATUSLINE,
    { session_id: 'sess-1', context_window: { used_percentage: 42 } },
    { sandbox: sb, args: ['--badge'] }
  );
  assert.equal(badge.stdout, '🟢 ctx 42%');
});

test('the badge changes colour as the window fills', () => {
  const sb = sandbox();
  const badge = (pct) =>
    run(
      STATUSLINE,
      { session_id: 'sess-1', context_window: { used_percentage: pct } },
      { sandbox: sb, args: ['--badge'] }
    ).stdout;

  assert.match(badge(10), /^🟢/);
  assert.match(badge(65), /^🟡/);
  assert.match(badge(93), /^🔴/);
});

test('the statusline helper is silent without a usable percentage', () => {
  const sb = sandbox();
  for (const input of [
    { session_id: 'sess-1' },
    { session_id: 'sess-1', context_window: {} },
    { context_window: { used_percentage: 50 } },
    'not json',
    '',
  ]) {
    const r = run(STATUSLINE, input, { sandbox: sb, args: ['--badge'] });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  }
});
