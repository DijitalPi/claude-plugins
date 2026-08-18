#!/usr/bin/env node
/**
 * context-guard — optional statusline helper
 *
 * The hook can estimate context usage from the transcript on its own. This
 * makes it exact instead: Claude Code hands the statusline a real
 * `context_window.used_percentage`, and this writes it where the hook looks.
 *
 * It does not replace your statusline. Pipe your statusline's stdin through it
 * and it prints a badge you can place wherever you like:
 *
 *   #!/bin/bash
 *   input=$(cat)
 *   ctx=$(echo "$input" | node "$HOME/.claude/plugins/.../context-percent.js" --badge)
 *   echo "$(your_existing_statusline_here) | $ctx"
 *
 * With no --badge it prints nothing and only records the number.
 *
 * Fails open and silent: a broken statusline is a visible, annoying thing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function main() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8')) || {};
  } catch {
    process.exit(0);
  }

  const sessionId = input.session_id;
  const pct =
    input.context_window && input.context_window.used_percentage != null
      ? Number(input.context_window.used_percentage)
      : null;

  if (!sessionId || pct === null || !Number.isFinite(pct)) process.exit(0);

  const dir = path.join(os.tmpdir(), 'claude-context-guard');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${String(sessionId).replace(/[^\w.-]/g, '_')}.pct`), String(pct));

    // Sweep state files older than two days. Sessions end without telling us.
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch {
        /* someone else's file, or already gone */
      }
    }
  } catch {
    /* recording is best-effort */
  }

  if (process.argv.includes('--badge')) {
    const n = Math.round(pct);
    const light = n >= 80 ? '🔴' : n >= 60 ? '🟡' : '🟢';
    process.stdout.write(`${light} ctx ${n}%`);
  }
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0);
}
