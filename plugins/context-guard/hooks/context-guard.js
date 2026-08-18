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
    if (found) return { ...DEFAULTS, ...found };
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

function main() {
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

  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0);
}
