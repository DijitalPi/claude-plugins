#!/usr/bin/env node
/**
 * install-guard — PreToolUse hook (Bash)
 *
 * Checks packages against their registry before they get installed.
 *
 * The problem it addresses: language models occasionally invent package names
 * that sound right and do not exist. Attackers watch for the names that get
 * invented often and register them. So an install command produced by an
 * assistant is worth one lookup before it runs.
 *
 * Three outcomes:
 *   - Package does not exist in the registry  -> deny. Nothing legitimate is
 *     lost; the name is either hallucinated or a typo.
 *   - Package exists but is very new, or barely downloaded -> escalate, with
 *     the numbers, and let the human decide. Plenty of good packages are new.
 *   - Anything else -> stay silent and let the normal permission flow happen.
 *     Notably this hook never returns "allow": that would suppress the usual
 *     prompt, and a guard has no business widening permissions.
 *
 * Design notes:
 *  - Fail-open, everywhere. Offline, registry down, timeout, parse error: the
 *    command proceeds. A guard that blocks work when the network hiccups gets
 *    uninstalled by lunchtime.
 *  - Registry answers are cached, so a loop of installs is not a loop of
 *    requests.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const DEFAULTS = {
  enabled: true,
  // Flag packages first published fewer than this many days ago.
  minAgeDays: 90,
  // Flag npm packages below this many downloads in the last week.
  // No equivalent check for PyPI — it does not publish download counts.
  minWeeklyDownloads: 1000,
  // Block installs of packages the registry has never heard of.
  blockUnknown: true,
  // Per-request timeout. The whole hook must finish inside its own timeout.
  timeoutMs: 3000,
  // Packages to never question — internal names, private registries, and so on.
  allowlist: [],
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadConfig(cwd) {
  const candidates = [
    process.env.INSTALL_GUARD_CONFIG,
    cwd ? path.join(cwd, '.install-guard.json') : null,
    path.join(os.homedir(), '.claude', 'install-guard.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    const found = readJson(file);
    if (found) return { ...DEFAULTS, ...found };
  }
  return { ...DEFAULTS };
}

/* ---------------------------------------------------------------- parsing */

const NPM_INSTALL = /\b(?:npm|pnpm|bun)\s+(?:i|install|add)\b/;
const YARN_ADD = /\byarn\s+add\b/;
const PIP_INSTALL = /\b(?:pip|pip3|uv\s+pip)\s+install\b/;

/** Split a command line on shell separators so `a && npm i x` is still seen. */
function segments(command) {
  return String(command).split(/&&|\|\||;|\|/);
}

/**
 * Pull installable package names out of one command segment.
 * Returns [] for anything that isn't a registry install — `npm ci`, a bare
 * `npm install` restoring a lockfile, a git URL, a local path.
 */
function packagesFrom(segment) {
  const s = segment.trim();
  let ecosystem = null;
  if (NPM_INSTALL.test(s) || YARN_ADD.test(s)) ecosystem = 'npm';
  else if (PIP_INSTALL.test(s)) ecosystem = 'pypi';
  if (!ecosystem) return [];

  // Everything after the install verb.
  const after = s.replace(/^.*?\b(?:i|install|add)\b/, '');
  const tokens = after.split(/\s+/).filter(Boolean);

  const names = [];
  for (const raw of tokens) {
    if (raw.startsWith('-')) continue; // flags
    if (/^(https?:|git\+|git:|file:|\.|\/|~)/.test(raw)) continue; // not registry
    if (/^(github:|gitlab:|bitbucket:)/.test(raw)) continue;
    if (raw.includes('/') && !raw.startsWith('@')) continue; // path-ish
    if (raw === '.') continue;

    let name = raw;
    if (ecosystem === 'npm') {
      // @scope/pkg@1.2.3 -> @scope/pkg ; pkg@^1 -> pkg
      const at = name.lastIndexOf('@');
      if (at > 0) name = name.slice(0, at);
    } else {
      // pkg==1.2, pkg>=1, pkg[extra]
      name = name.split(/[=<>!~\[;]/)[0];
    }
    name = name.trim();
    if (!name) continue;
    if (ecosystem === 'npm' && !/^(@[\w.-]+\/)?[\w.-]+$/.test(name)) continue;
    if (ecosystem === 'pypi' && !/^[\w.-]+$/.test(name)) continue;
    names.push({ name, ecosystem });
  }
  return names;
}

/* ---------------------------------------------------------------- registry */

/**
 * GET a URL. Resolves {status, data} on 200, {status: 404} when absent, and
 * null for anything we cannot interpret — including network failures, which is
 * what makes the whole hook fail open.
 *
 * With existenceOnly, the body is discarded: used for endpoints that answer the
 * "does this exist" question without returning JSON.
 */
function getJson(url, timeoutMs, existenceOnly) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const req = https.get(
        url,
        { timeout: timeoutMs, headers: { 'user-agent': 'claude-install-guard' } },
        (res) => {
          if (res.statusCode === 404) {
            res.resume();
            return finish({ status: 404 });
          }
          if (res.statusCode !== 200) {
            res.resume();
            return finish(null); // Unknown state — treated as "no opinion".
          }
          if (existenceOnly) {
            res.resume();
            return finish({ status: 200 });
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => {
            body += c;
            if (body.length > 4 * 1024 * 1024) req.destroy(); // sanity bound
          });
          res.on('end', () => {
            try {
              finish({ status: 200, data: JSON.parse(body) });
            } catch {
              finish(null);
            }
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        finish(null);
      });
      req.on('error', () => finish(null));
    } catch {
      finish(null);
    }
  });
}

function cacheDir() {
  return path.join(os.tmpdir(), 'claude-install-guard');
}

function cached(key) {
  try {
    const f = path.join(cacheDir(), `${key.replace(/[^\w.@-]/g, '_')}.json`);
    const st = fs.statSync(f);
    if (Date.now() - st.mtimeMs > CACHE_TTL_MS) return null;
    return readJson(f);
  } catch {
    return null;
  }
}

function putCache(key, value) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir(), `${key.replace(/[^\w.@-]/g, '_')}.json`),
      JSON.stringify(value)
    );
  } catch {
    /* cache is an optimization */
  }
}

/** Returns {exists, ageDays, weeklyDownloads} or null when we can't tell. */
async function inspect(pkg, cfg) {
  const key = `${pkg.ecosystem}:${pkg.name}`;
  const hit = cached(key);
  if (hit) return hit;

  let result = null;
  if (pkg.ecosystem === 'npm') {
    // Existence first, from the smallest endpoint there is. The full document
    // for a popular package is megabytes of version history and will not
    // arrive inside a hook's timeout — asking for it here would mean the
    // check silently does nothing exactly where it is cheapest to be sure.
    const encoded = encodeURIComponent(pkg.name).replace('%40', '@');
    const head = await getJson(`https://registry.npmjs.org/${encoded}/latest`, cfg.timeoutMs);
    if (!head) return null;
    if (head.status === 404) {
      result = { exists: false };
    } else {
      let weeklyDownloads = null;
      const dl = await getJson(
        `https://api.npmjs.org/downloads/point/last-week/${pkg.name}`,
        cfg.timeoutMs
      );
      if (dl && dl.status === 200 && dl.data && typeof dl.data.downloads === 'number') {
        weeklyDownloads = dl.data.downloads;
      }

      // Age needs the full document, which is only affordable for small
      // packages — and those are the ones the age check is about. If it does
      // not arrive in time, downloads still carry the signal.
      let ageDays = null;
      if (weeklyDownloads === null || weeklyDownloads < 100000) {
        const meta = await getJson(`https://registry.npmjs.org/${encoded}`, cfg.timeoutMs);
        const created = meta && meta.data && meta.data.time && meta.data.time.created;
        if (created) ageDays = Math.floor((Date.now() - Date.parse(created)) / 86400000);
      }
      result = { exists: true, ageDays, weeklyDownloads };
    }
  } else {
    // PyPI's simple index is a tiny existence check; the JSON document is the
    // only place with dates and can be large for old projects.
    const head = await getJson(`https://pypi.org/simple/${pkg.name}/`, cfg.timeoutMs, true);
    if (!head) return null;
    if (head.status === 404) {
      result = { exists: false };
      putCache(key, result);
      return result;
    }
    const meta = await getJson(`https://pypi.org/pypi/${pkg.name}/json`, cfg.timeoutMs);
    if (!meta || meta.status === 404) {
      result = { exists: true, ageDays: null, weeklyDownloads: null };
    } else {
      // PyPI has no "created" field; the oldest release upload is the closest thing.
      let oldest = null;
      const releases = (meta.data && meta.data.releases) || {};
      for (const files of Object.values(releases)) {
        if (!Array.isArray(files)) continue;
        for (const f of files) {
          const t = f && f.upload_time_iso_8601 ? Date.parse(f.upload_time_iso_8601) : null;
          if (t && (oldest === null || t < oldest)) oldest = t;
        }
      }
      const ageDays = oldest ? Math.floor((Date.now() - oldest) / 86400000) : null;
      result = { exists: true, ageDays, weeklyDownloads: null };
    }
  }

  if (result) putCache(key, result);
  return result;
}

/* -------------------------------------------------------------------- main */

function respond(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

async function main() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8')) || {};
  } catch {
    process.exit(0);
  }

  if (input.tool_name !== 'Bash') process.exit(0);
  const command = input.tool_input && input.tool_input.command;
  if (!command) process.exit(0);

  const cfg = loadConfig(input.cwd);
  if (!cfg.enabled) process.exit(0);

  const allow = new Set((cfg.allowlist || []).map(String));
  const pkgs = [];
  const seen = new Set();
  for (const seg of segments(command)) {
    for (const p of packagesFrom(seg)) {
      const key = `${p.ecosystem}:${p.name}`;
      if (seen.has(key) || allow.has(p.name)) continue;
      seen.add(key);
      pkgs.push(p);
    }
  }
  if (!pkgs.length) process.exit(0);

  // Bound the work regardless of how long the command line is.
  const checked = await Promise.all(pkgs.slice(0, 10).map((p) => inspect(p, cfg)));

  const missing = [];
  const suspicious = [];
  pkgs.slice(0, 10).forEach((p, i) => {
    const r = checked[i];
    if (!r) return; // no opinion
    if (!r.exists) return missing.push(p.name);
    const reasons = [];
    if (r.ageDays !== null && r.ageDays < cfg.minAgeDays) {
      reasons.push(`first published ${r.ageDays} day${r.ageDays === 1 ? '' : 's'} ago`);
    }
    if (
      r.weeklyDownloads !== null &&
      cfg.minWeeklyDownloads > 0 &&
      r.weeklyDownloads < cfg.minWeeklyDownloads
    ) {
      reasons.push(`${r.weeklyDownloads.toLocaleString('en-US')} downloads last week`);
    }
    if (reasons.length) suspicious.push(`${p.name} (${reasons.join(', ')})`);
  });

  if (missing.length && cfg.blockUnknown) {
    const list = missing.join(', ');
    respond(
      'deny',
      `install-guard: ${missing.length > 1 ? 'these packages do' : 'this package does'} not exist in the registry: ${list}. ` +
        `A name that does not resolve is either a typo or invented — and invented names are a known target for attackers, who register them and wait. ` +
        `Check the real package name before installing. If the name is correct and the registry is simply private, add it to allowlist in .install-guard.json.`
    );
  }

  if (suspicious.length) {
    respond(
      'escalate',
      `install-guard: worth a second look before installing — ${suspicious.join('; ')}. ` +
        `New or rarely-downloaded packages are not necessarily bad, but they are where supply-chain problems start. Confirm this is the package you meant.`
    );
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
