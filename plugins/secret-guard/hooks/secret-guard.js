#!/usr/bin/env node
/**
 * secret-guard — PreToolUse hook (Write / Edit / NotebookEdit)
 *
 * Stops a live credential from being written into a file.
 *
 * The failure this prevents is mundane: a key gets pasted into a config file to
 * make something work, the file gets committed, and the key is public. Rotating
 * it is the easy part; noticing is the hard part.
 *
 * Scope, deliberately narrow:
 *  - Only provider-specific patterns with recognizable shapes — an AWS key ID,
 *    a GitHub token, a PEM private key header. These are unambiguous.
 *  - No generic `password = "..."` matching. That fires on fixtures, on docs,
 *    on test data, on the word "password" in a comment. A guard that cries wolf
 *    gets switched off, and then it protects nothing.
 *  - Files whose whole purpose is to hold secrets — .env and friends — are left
 *    alone. That is where a key is *supposed* to go.
 *
 * Fail-open like the rest: any error and the write proceeds.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  enabled: true,
  // Files allowed to contain credentials. Globs are not supported; these are
  // matched against the basename, plus any path containing them as a segment.
  allowFiles: ['.env', '.env.local', '.env.development', '.env.production', '.env.test'],
  // Extra regex sources (strings) to treat as secrets. Case-sensitive.
  extraPatterns: [],
  // Pattern names to switch off, e.g. ["jwt"].
  disablePatterns: [],
};

/**
 * Each pattern is shaped tightly enough that a match is almost certainly a real
 * credential rather than prose that happens to look like one.
 */
const PATTERNS = [
  { name: 'aws-access-key-id', label: 'AWS access key ID', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'github-token', label: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'github-pat-fine', label: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: 'anthropic-key', label: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'openai-key', label: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'google-api-key', label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'slack-token', label: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'stripe-live-key', label: 'Stripe live key', re: /\b[sr]k_live_[0-9a-zA-Z]{20,}/ },
  { name: 'sendgrid-key', label: 'SendGrid API key', re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
  { name: 'npm-token', label: 'npm access token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'private-key', label: 'private key block', re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'slack-webhook', label: 'Slack webhook URL', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_/-]{20,}/ },
];

/** Strings that mark a match as an obvious placeholder rather than a real key. */
const PLACEHOLDER = /(example|placeholder|your[_-]?|my[_-]?|dummy|sample|fake|test[_-]?key|replace[_-]?me|xxxx|\.\.\.|<[^>]+>|\$\{|%s\b)/i;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadConfig(cwd) {
  const candidates = [
    process.env.SECRET_GUARD_CONFIG,
    cwd ? path.join(cwd, '.secret-guard.json') : null,
    path.join(os.homedir(), '.claude', 'secret-guard.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    const found = readJson(file);
    if (found) return { ...DEFAULTS, ...found };
  }
  return { ...DEFAULTS };
}

/** True when this file is an accepted home for credentials. */
function isAllowedFile(filePath, allowFiles) {
  if (!filePath) return false;
  const base = path.basename(String(filePath));
  return (allowFiles || []).some((a) => base === a || base.startsWith(`${a}.`));
}

/** The text a tool call would write, whichever tool it is. */
function contentOf(toolName, ti) {
  if (!ti) return '';
  if (toolName === 'Write') return String(ti.content || '');
  if (toolName === 'Edit') return String(ti.new_string || '');
  if (toolName === 'NotebookEdit') return String(ti.new_source || '');
  return '';
}

function buildPatterns(cfg) {
  const off = new Set(cfg.disablePatterns || []);
  const list = PATTERNS.filter((p) => !off.has(p.name));
  for (const src of cfg.extraPatterns || []) {
    try {
      list.push({ name: 'custom', label: 'custom pattern', re: new RegExp(src) });
    } catch {
      /* a bad regex in config should not take the hook down */
    }
  }
  return list;
}

/** Show enough of a match to be recognizable, not enough to leak it. */
function redact(match) {
  const s = String(match);
  if (s.length <= 12) return `${s.slice(0, 4)}…`;
  return `${s.slice(0, 8)}…${s.slice(-2)}`;
}

function main() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8')) || {};
  } catch {
    process.exit(0);
  }

  const tool = input.tool_name;
  if (!['Write', 'Edit', 'NotebookEdit'].includes(tool)) process.exit(0);

  const cfg = loadConfig(input.cwd);
  if (!cfg.enabled) process.exit(0);

  const ti = input.tool_input || {};
  if (isAllowedFile(ti.file_path || ti.notebook_path, cfg.allowFiles)) process.exit(0);

  const content = contentOf(tool, ti);
  if (!content) process.exit(0);

  const hits = [];
  for (const p of buildPatterns(cfg)) {
    const m = content.match(p.re);
    if (!m) continue;
    // Skip anything that reads as a placeholder — docs and examples are full of
    // key-shaped strings that are not keys.
    const line = (content.split('\n').find((l) => l.includes(m[0])) || m[0]).trim();
    if (PLACEHOLDER.test(line) && p.name !== 'private-key') continue;
    hits.push(`${p.label} (${redact(m[0])})`);
  }

  if (!hits.length) process.exit(0);

  const file = ti.file_path || ti.notebook_path || 'this file';
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `secret-guard: this write to ${file} contains what looks like a live credential — ${hits.join(', ')}. ` +
          `Put the value in an environment variable and read it at runtime, or write it to a .env file that is gitignored. ` +
          `If this is a placeholder or test fixture that only resembles a key, either make that obvious in the value or add the pattern to disablePatterns in .secret-guard.json.`,
      },
    })
  );
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0);
}
