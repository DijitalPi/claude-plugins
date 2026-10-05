#!/usr/bin/env node
/**
 * agent-orchestra: puts your Claude Code sessions on stage in the Agent Orchestra,
 * a live orchestra where every machine running coding agents is a musician.
 *
 * What leaves your machine, about once a second while you work:
 *   - how many steps your agents took (a number)
 *   - whether they are working, and how many sessions are open
 *   - "shipped" (a git commit or push) and "tests passed" signals
 *   - a random id, so the same machine keeps the same seat
 * Never: code, prompts, file or project names, commands, output. The server turns
 * your IP into a country flag and does not store the IP.
 *
 * How, without slowing Claude down: each hook call appends one short line to a local
 * spool file and returns. A small detached sender, started on demand, posts the spool
 * in batches and exits after a minute of quiet.
 *
 * Design notes:
 *  - Fail-open. Every error path exits 0 with no output.
 *  - Silent by default. The only message is a one-time notice on the first session.
 *  - A project can switch it off ({ "enabled": false } in .claude/agent-orchestra.json),
 *    but cannot change where data goes: the server address is global config only.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const DEFAULTS = {
  enabled: true,
  // Where the orchestra lives. Global config or AGENT_ORCHESTRA_URL only.
  server: 'https://orchestra.dijitalpi.com',
};

const HOME = os.homedir();
const DIR = path.join(HOME, '.claude', 'agent-orchestra');
const SPOOL = path.join(DIR, 'spool.log');
const LOCK = path.join(DIR, 'sender.lock');
const STATUS = path.join(DIR, 'status.json');
const NOTICE = path.join(DIR, 'notice-shown');
const ID_FILE = path.join(DIR, 'id');

const MAX_SPOOL = 512 * 1024;      // if no sender ever drains it, never let it grow past this
const QUIET_EXIT_MS = 60_000;      // sender leaves after a minute without events
const HEARTBEAT_MS = 10_000;       // keeps the seat while agents think without taking steps
const SESSION_TTL_MS = 120_000;

const SHIP = /\bgit\s+(?:commit|push)\b/;
const PASSED = /\b\d+ (?:passed|passing)\b/;
const FAILED = /\b\d+ (?:failed|failing)\b|\bFAILED\b/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Global config, then a project may only switch the plugin off for itself. */
function loadConfig(cwd) {
  const globalFile = process.env.AGENT_ORCHESTRA_CONFIG || path.join(HOME, '.claude', 'agent-orchestra.json');
  const cfg = { ...DEFAULTS, ...(readJson(globalFile) || {}) };
  if (cwd) {
    const project = readJson(path.join(cwd, '.claude', 'agent-orchestra.json'));
    if (project && project.enabled === false) cfg.enabled = false;
  }
  if (process.env.AGENT_ORCHESTRA_URL) cfg.server = process.env.AGENT_ORCHESTRA_URL;
  return cfg;
}

function responseText(response) {
  if (!response) return '';
  if (typeof response === 'string') return response.slice(-4000);
  return `${response.stdout || ''}\n${response.stderr || ''}`.slice(-4000);
}

/** What one hook call means for the orchestra. Only the kind is kept, never the content. */
function kindsFor(input) {
  switch (input.hook_event_name) {
    case 'UserPromptSubmit':
      return ['busy'];
    case 'Stop':
      return ['done'];
    case 'PostToolUse': {
      const kinds = ['step'];
      if (input.tool_name === 'Bash') {
        const command = String((input.tool_input && input.tool_input.command) || '').slice(0, 500);
        const output = responseText(input.tool_response);
        if (SHIP.test(command)) kinds.push('ship');
        if (!FAILED.test(output) && PASSED.test(output)) kinds.push('pass');
      }
      return kinds;
    }
    default:
      return [];
  }
}

function append(sessionId, kinds) {
  if (!kinds.length) return;
  fs.mkdirSync(DIR, { recursive: true });
  try {
    if (fs.statSync(SPOOL).size > MAX_SPOOL) fs.unlinkSync(SPOOL);
  } catch {
    // no spool yet
  }
  const now = Date.now();
  const sid = String(sessionId || 'unknown').replace(/[^\w-]/g, '').slice(0, 64) || 'unknown';
  fs.appendFileSync(SPOOL, kinds.map((k) => `${now} ${sid} ${k}\n`).join(''));
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function lockOwner() {
  try {
    return Number(fs.readFileSync(LOCK, 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
}

/** Start the sender unless one is already running. */
function ensureSender() {
  if (process.env.AGENT_ORCHESTRA_NO_SENDER) return;
  if (isAlive(lockOwner())) return;
  const child = spawn(process.execPath, [__filename, '--send'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function acquireLock() {
  fs.mkdirSync(DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LOCK, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') return false;
      if (isAlive(lockOwner())) return false;
      try {
        fs.unlinkSync(LOCK);   // stale: its sender is gone
      } catch {
        return false;
      }
    }
  }
  return false;
}

function releaseLock() {
  if (lockOwner() === process.pid) {
    try {
      fs.unlinkSync(LOCK);
    } catch {
      // already gone
    }
  }
}

function machineId() {
  try {
    const id = fs.readFileSync(ID_FILE, 'utf8').trim();
    if (/^[a-f0-9]{32}$/.test(id)) return id;
  } catch {
    // first run
  }
  const id = require('crypto').randomBytes(16).toString('hex');
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(ID_FILE, id);
  return id;
}

/** Take everything in the spool. Renaming first means no line is read twice or lost. */
function drain() {
  const taken = `${SPOOL}.${process.pid}`;
  try {
    fs.renameSync(SPOOL, taken);
  } catch {
    return [];
  }
  let text = '';
  try {
    text = fs.readFileSync(taken, 'utf8');
  } catch {
    // nothing readable
  }
  try {
    fs.unlinkSync(taken);
  } catch {
    // already gone
  }
  return text
    .split('\n')
    .map((line) => {
      const [t, sid, kind] = line.split(' ');
      return { t: Number(t), sid, kind };
    })
    .filter((e) => e.kind && Number.isFinite(e.t));
}

function post(server, body) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL('/api/play', server);
    } catch {
      return resolve(null);
    }
    const data = JSON.stringify(body);
    const client = url.protocol === 'http:' ? http : https;
    const req = client.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout: 3000 },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve(res.statusCode === 200 ? readJsonText(text) : null));
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end(data);
  });
}

function readJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The sender: drains the spool once a second and reports. `once` drains a single
 * time and returns (used by the tests and by --status).
 */
async function sender(once) {
  if (!once && !acquireLock()) return;
  try {
    const cfg = loadConfig(null);
    const id = machineId();
    const sessions = new Map();     // session id -> { last, working }
    let quietSince = Date.now();
    let lastPost = 0;
    for (;;) {
      const now = Date.now();
      let steps = 0;
      const signals = [];
      const batch = drain();
      for (const e of batch) {
        const s = sessions.get(e.sid) || { last: 0, working: false };
        s.last = Math.max(s.last, e.t);
        if (e.kind === 'busy' || e.kind === 'step') s.working = true;
        if (e.kind === 'done') s.working = false;
        if (e.kind === 'step') steps++;
        if ((e.kind === 'ship' || e.kind === 'pass') && !signals.includes(e.kind)) signals.push(e.kind);
        sessions.set(e.sid, s);
      }
      for (const [sid, s] of sessions) if (now - s.last > SESSION_TTL_MS) sessions.delete(sid);
      if (batch.length) quietSince = now;
      const working = [...sessions.values()].some((s) => s.working);
      const due = steps > 0 || signals.length > 0 || (sessions.size > 0 && now - lastPost >= HEARTBEAT_MS);
      if (due && cfg.enabled) {
        const count = Math.max(1, sessions.size);
        const seat = await post(cfg.server, { id, steps, signals, working, sessions: count, tools: { claude: count } });
        lastPost = now;
        if (seat) {
          try {
            fs.writeFileSync(STATUS, JSON.stringify({ ...seat, server: cfg.server, at: now }));
          } catch {
            // status is a convenience
          }
        }
      }
      if (once) return;
      if (!working && now - quietSince > QUIET_EXIT_MS) return;
      await sleep(1000);
    }
  } finally {
    if (!once) releaseLock();
  }
}

/** For the /orchestra command: one line about where you sit. */
function status() {
  const cfg = loadConfig(process.cwd());
  const s = readJson(STATUS);
  const watch = String(cfg.server).replace(/\/+$/, '');
  if (!cfg.enabled) return console.log(`Agent Orchestra is switched off here. Watch the orchestra: ${watch}`);
  if (s && Date.now() - s.at < 5 * 60_000 && s.section) {
    return console.log(`You are on stage: ${s.section}, seat ${Number(s.seat) + 1}, with ${s.players} machines playing. Watch: ${watch}`);
  }
  console.log(`Not on stage right now (it joins while your agents work). Watch: ${watch}`);
}

function main() {
  const arg = process.argv[2];
  if (arg === '--send') return sender(false).catch(() => {});
  if (arg === '--send-once') return sender(true).catch(() => {});
  if (arg === '--status') return status();

  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return;
  }
  const cfg = loadConfig(input.cwd);
  if (!cfg.enabled) return;

  append(input.session_id, kindsFor(input));

  if (input.hook_event_name === 'SessionStart' && !fs.existsSync(NOTICE)) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(NOTICE, new Date().toISOString());
    process.stdout.write(JSON.stringify({
      systemMessage: `Agent Orchestra is on: while your agents work, they play in the live orchestra at ${String(cfg.server).replace(/\/+$/, '')}. Only step counts are sent, never code or prompts. /orchestra shows your seat.`,
    }));
  }

  ensureSender();
}

try {
  main();
} catch {
  // fail-open
}
