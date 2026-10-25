#!/usr/bin/env node
/**
 * context-guard — UserPromptSubmit hook
 *
 * Warns you before the context window fills up, while there is still room to
 * save your work and start clean.
 *
 * Two ways of measuring how full the window is:
 *
 *  1. A state file written by the optional statusline helper. Claude Code gives
 *     the statusline an exact `context_window.used_percentage`, so when the
 *     helper is installed this number is authoritative.
 *  2. Otherwise, the transcript. Every assistant turn records its token usage,
 *     and the last one is the current size of the window. This needs to know
 *     the model's limit, hence `contextLimit` in the config.
 *
 * Hooks are not given context usage directly, which is why this dance exists.
 *
 * Design notes:
 *  - Fail-open. Every error path exits 0 with no output. A guard that blocks
 *    your prompt is worse than no guard.
 *  - Fires once per session at full volume, then keeps a short reminder going
 *    until the window is actually cleared.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  enabled: true,
  // Percentage of the context window at which to start warning.
  threshold: 80,
  // Size of the model's context window, in tokens. Only used for the
  // transcript-based estimate; ignored when the statusline helper is installed.
  // 200000 is the common default; set 1000000 if you are on a 1M model.
  contextLimit: 200000,
  // A command for Claude to run before you clear — whatever you use to persist
  // state: "/save", "/kk", "/context-save". Empty means "just warn me".
  saveCommand: '',
  // Extra instructions appended to the warning. Your workflow, your words.
  extraInstructions: '',
  // Show the one-line warning in the terminal as well as telling Claude.
  showSystemMessage: true,
  // Warn again every N prompts once over threshold. 0 = only the short nudge.
  repeatEvery: 1,
  // Optional: notice when a prompt starts a new, unrelated task in an already
  // heavy window, and suggest saving and starting fresh. Every turn re-reads the
  // whole conversation, so a new task is cheapest in a new conversation. The
  // judgment comes from a TypeSafe System One model (Jev): one yes/no question,
  // no text generated. Off unless enabled and given an API key.
  topicShift: {
    enabled: false,
    // Only judge once the window is this full; below it a fresh start saves little.
    minPercent: 15,
    // Jev's yes-probability needed to call the prompt a new task.
    probability: 0.8,
    // Prompts to stay quiet after a suggestion (the suggestion itself counts as 1).
    cooldown: 5,
    // Prompts shorter than this ("ok", "go on", "3") are never judged.
    minPromptChars: 15,
    model: 'jev-1.13.0',
    apiKeyEnv: 'TYPESAFE_API_KEY',
    // Optional env-style file holding the key, e.g. "~/.config/typesafe.env".
    apiKeyFile: '',
    timeoutMs: 2500,
    endpoint: 'https://api.typesafe.ai/v1/systemone',
  },
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
    process.env.CONTEXT_GUARD_CONFIG,
    cwd ? path.join(cwd, '.context-guard.json') : null,
    path.join(os.homedir(), '.claude', 'context-guard.json'),
  ].filter(Boolean);

  for (const file of candidates) {
    const found = readJson(file);
    if (found) {
      const topicShift = { ...DEFAULTS.topicShift, ...(found.topicShift || {}) };
      return { ...DEFAULTS, ...found, topicShift };
    }
  }
  return { ...DEFAULTS };
}

const stateDir = () => path.join(os.tmpdir(), 'claude-context-guard');

/** Exact percentage, if the statusline helper has been writing one. */
function percentFromStatusline(sessionId) {
  try {
    const raw = fs.readFileSync(path.join(stateDir(), `${sessionId}.pct`), 'utf8');
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Estimated percentage from the transcript.
 *
 * The last assistant turn's usage is the whole window: fresh input, plus
 * everything read from cache, plus everything written to it. Only the tail of
 * the file is read — transcripts get long, and the last turn is all we need.
 */
function percentFromTranscript(transcriptPath, limit) {
  try {
    if (!transcriptPath || !limit) return null;
    const { size } = fs.statSync(transcriptPath);
    const window = Math.min(size, 512 * 1024);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(window);
    fs.readSync(fd, buf, 0, window, size - window);
    fs.closeSync(fd);

    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('{')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // A truncated first line, or a line we don't care about.
      }
      const u = entry && entry.message && entry.message.usage;
      if (!u) continue;
      const used =
        (u.input_tokens || 0) +
        (u.cache_read_input_tokens || 0) +
        (u.cache_creation_input_tokens || 0);
      if (used > 0) return (used / limit) * 100;
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ topicShift */

function readTail(file, bytes) {
  const { size } = fs.statSync(file);
  const window = Math.min(size, bytes);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(window);
  fs.readSync(fd, buf, 0, window, size - window);
  fs.closeSync(fd);
  return buf.toString('utf8');
}

/** Text the user actually typed: not tool results, skill bodies or <command> wrappers. */
function typedText(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta) return null;
  const c = entry.message && entry.message.content;
  let text = null;
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === 'tool_result')) return null;
    text = c
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  text = text ? text.trim() : '';
  if (!text || text.startsWith('<')) return null;
  return text;
}

function assistantText(entry) {
  if (!entry || entry.type !== 'assistant') return null;
  const c = entry.message && entry.message.content;
  if (!Array.isArray(c)) return null;
  const text = c
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text || null;
}

/** The last few typed prompts (oldest first) and the last assistant reply. */
function conversationTail(transcriptPath, currentPrompt, keep = 3) {
  try {
    if (!transcriptPath) return null;
    const lines = readTail(transcriptPath, 512 * 1024).split('\n');
    const previous = [];
    let lastReply = null;
    for (let i = lines.length - 1; i >= 0 && previous.length < keep; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('{')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (lastReply === null) lastReply = assistantText(entry);
      const typed = typedText(entry);
      if (typed && typed !== currentPrompt) previous.unshift(typed.slice(0, 600));
    }
    return { previous, lastReply: lastReply ? lastReply.slice(0, 800) : null };
  } catch {
    return null;
  }
}

function readApiKey(ts) {
  const name = String(ts.apiKeyEnv || 'TYPESAFE_API_KEY');
  if (process.env[name]) return process.env[name];
  const file = String(ts.apiKeyFile || '').replace(/^~(?=$|\/)/, os.homedir());
  if (!file) return null;
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === name) return m[2].replace(/^(['"])(.*)\1$/, '$2') || null;
    }
  } catch {
    /* no key file, no judgment */
  }
  return null;
}

// Measured on 99 real prompt transitions (65 follow-ups, 34 new tasks), jev-1.13.0:
// at probability 0.8 it caught 44% of new tasks with no false suggestion; at 0.7,
// 56% with one. An earlier wording that counted "refers back to earlier work" as a
// follow-up missed questions about work from other sessions ("did we ship X?").
const NEW_TASK_QUESTION = {
  type: 'noul',
  instructions:
    'Is `new_message` about a different subject than the work discussed in `previous_user_messages` and `last_assistant_reply`, so that it could be handled in a brand-new conversation without needing anything said here?',
  criteria: {
    true: 'A different project, client, product, file or topic, including a question about other or earlier work that was not discussed here.',
    false:
      'The same subject: a continuation, follow-up, correction, approval, a question about what was just discussed, or the next step of the same work.',
  },
};

/** Jev's probability that the prompt starts a new task, or null on any failure. */
async function askJev(ts, key, state) {
  try {
    const res = await fetch(String(ts.endpoint), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ts.model, state, questions: { new_task: NEW_TASK_QUESTION } }),
      signal: AbortSignal.timeout(Number(ts.timeoutMs) > 0 ? Number(ts.timeoutMs) : 2500),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const p = json && json.answers && json.answers.new_task && json.answers.new_task.noul;
    return typeof p === 'number' && p >= 0 && p <= 1 ? p : null;
  } catch {
    return null;
  }
}

function buildTopicShift(pct, cfg) {
  const save = String(cfg.saveCommand || '').trim();
  const how = save
    ? `suggest running ${save} and continuing this new task in a fresh conversation`
    : 'suggest continuing this new task in a fresh conversation';
  return [
    '<context-guard>',
    `The user's new message looks like a new task, unrelated to this conversation, and the context window is already ${pct}% full. Every turn re-reads the whole conversation, so a new task is cheaper in a fresh one.`,
    `Before starting it, in one short line, ${how}, and ask whether to do that or continue here. If the user has already said to continue here, just do the task.`,
    '</context-guard>',
  ].join('\n');
}

/**
 * Below the threshold: if the window is heavy and this prompt starts a new task,
 * return the suggestion payload. Returns null when there is nothing to say.
 */
async function topicShiftPayload(input, cfg, pct, dir) {
  const ts = cfg.topicShift || {};
  if (!ts.enabled) return null;

  const stateFile = path.join(dir, `${String(input.session_id).replace(/[^\w.-]/g, '_')}.shift`);
  const minPercent = Number(ts.minPercent) >= 0 ? Number(ts.minPercent) : 15;
  if (pct < minPercent) {
    // A small window, or a clear just happened: start over.
    try {
      fs.unlinkSync(stateFile);
    } catch {
      /* nothing to reset */
    }
    return null;
  }

  const state = readJson(stateFile);
  if (state && state.quiet > 0) {
    try {
      fs.writeFileSync(stateFile, JSON.stringify({ quiet: state.quiet - 1 }));
    } catch {
      /* cooldown is a nicety */
    }
    return null;
  }

  const prompt = String(input.prompt || '').trim();
  const minChars = Number(ts.minPromptChars) >= 0 ? Number(ts.minPromptChars) : 15;
  if (!prompt || prompt.startsWith('/') || prompt.length < minChars) return null;

  const key = readApiKey(ts);
  if (!key) return null;

  const tail = conversationTail(input.transcript_path, prompt);
  if (!tail || tail.previous.length === 0) return null;

  const p = await askJev(ts, key, {
    previous_user_messages: tail.previous,
    last_assistant_reply: tail.lastReply || '',
    new_message: prompt.slice(0, 1500),
  });
  const needed = Number(ts.probability) > 0 ? Number(ts.probability) : 0.8;
  const fired = p !== null && p >= needed;

  try {
    // Numbers only, no prompt text: enough to tune `probability` later.
    fs.appendFileSync(
      path.join(dir, 'topic-shift.log'),
      `${new Date().toISOString()}\t${input.session_id}\t${pct}\t${p === null ? 'error' : p}\t${fired ? 'fired' : 'quiet'}\n`
    );
  } catch {
    /* logging is a nicety */
  }
  if (!fired) return null;

  const cooldown = Number(ts.cooldown) > 1 ? Math.floor(Number(ts.cooldown)) : 1;
  try {
    fs.writeFileSync(stateFile, JSON.stringify({ quiet: cooldown - 1 }));
  } catch {
    /* cooldown is a nicety */
  }

  const payload = {
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: buildTopicShift(pct, cfg) },
  };
  if (cfg.showSystemMessage) {
    payload.systemMessage = `🧭 New task? Context is ${pct}% full — saving and starting a fresh conversation is cheaper.`;
  }
  return payload;
}

/** Write and exit only after the pipe has taken the bytes. */
function emit(payload) {
  process.stdout.write(JSON.stringify(payload), () => process.exit(0));
}

/* --------------------------------------------------------------- warning */

function buildWarning(pct, cfg, isFirst) {
  const save = String(cfg.saveCommand || '').trim();
  const extra = String(cfg.extraInstructions || '').trim();

  if (!isFirst) {
    const nudge = save
      ? `If you have already run ${save} this session, do not run it again — just end your reply by reminding the user to clear the conversation.`
      : 'Remind the user at the end of your reply that the conversation should be cleared soon.';
    return [
      '<context-guard>',
      `The context window is still ${pct}% full. ${nudge}`,
      '</context-guard>',
    ].join('\n');
  }

  const steps = [
    '1. Answer the current request. If it is a large piece of work, do not start it — finish the wrap-up below first and pick the work back up in a fresh conversation.',
  ];
  if (save) {
    steps.push(`2. Run ${save} to persist anything worth keeping from this session.`);
    steps.push(
      "3. End your reply by telling the user, explicitly, to clear the conversation. You cannot clear it yourself — only they can — so this line is not optional."
    );
  } else {
    steps.push(
      '2. Briefly summarize what has been done and what is still open, so it survives into the next conversation.'
    );
    steps.push(
      '3. End your reply by telling the user, explicitly, to clear the conversation. You cannot clear it yourself — only they can.'
    );
  }

  const lines = [
    '<context-guard>',
    `The context window is ${pct}% full (threshold: ${cfg.threshold}%). Wrap this session up cleanly:`,
    '',
    ...steps,
  ];
  if (extra) lines.push('', extra);
  lines.push('</context-guard>');
  return lines.join('\n');
}

async function main() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8')) || {};
  } catch {
    process.exit(0);
  }

  const cfg = loadConfig(input.cwd);
  if (!cfg.enabled) process.exit(0);

  const sessionId = input.session_id;
  if (!sessionId) process.exit(0);

  const limit = Number(cfg.contextLimit) > 0 ? Number(cfg.contextLimit) : 0;
  const pctRaw =
    percentFromStatusline(sessionId) ??
    percentFromTranscript(input.transcript_path, limit);
  if (pctRaw === null) process.exit(0);

  const pct = Math.round(pctRaw);
  const threshold = Number(cfg.threshold) > 0 ? Number(cfg.threshold) : 80;

  let dir;
  try {
    dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    process.exit(0);
  }
  const flagFile = path.join(dir, `${String(sessionId).replace(/[^\w.-]/g, '_')}.warned`);

  if (pct < threshold) {
    // Back under the line — a clear or a compact happened. Arm it again.
    try {
      fs.unlinkSync(flagFile);
    } catch {
      /* nothing to reset */
    }
    const shift = await topicShiftPayload(input, cfg, pct, dir);
    if (shift) return emit(shift);
    process.exit(0);
  }

  const state = readJson(flagFile);
  const isFirst = !state;
  // Counts prompts *since* the first warning, so the gap between reminders is
  // repeatEvery every time rather than one short on the first interval.
  const seen = isFirst ? 0 : (state.seen || 0) + 1;

  try {
    fs.writeFileSync(flagFile, JSON.stringify({ seen }));
  } catch {
    /* state is a nicety, not a requirement */
  }

  // After the first full warning, respect repeatEvery so long sessions past the
  // threshold don't get nagged on every single turn.
  const every = Number(cfg.repeatEvery);
  if (!isFirst && (!every || every < 1 || seen % every !== 0)) process.exit(0);

  const payload = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: buildWarning(pct, cfg, isFirst),
    },
  };
  if (isFirst && cfg.showSystemMessage) {
    const save = String(cfg.saveCommand || '').trim();
    payload.systemMessage = `⚠️  Context ${pct}% full — wrapping up${save ? ` (${save} will run)` : ''}, then clear the conversation.`;
  }

  emit(payload);
}

main().catch(() => process.exit(0));
