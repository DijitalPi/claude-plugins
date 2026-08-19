'use strict';
/**
 * Checks the repository itself rather than any one guard: that every file
 * parses, and that the manifests still point at things that exist.
 *
 * The failure this catches is the quiet one — a hook file renamed, a plugin
 * added to the directory but not to the marketplace — where nothing is broken
 * until someone installs it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REPO, walk } = require('./helpers');

const MARKETPLACE = JSON.parse(
  fs.readFileSync(path.join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8')
);
const PLUGIN_DIRS = fs
  .readdirSync(path.join(REPO, 'plugins'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

test('every JavaScript file parses', () => {
  const files = walk(REPO, '.js');
  assert.ok(files.length >= 5, 'expected to find the hooks');
  for (const file of files) {
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(res.status, 0, `${path.relative(REPO, file)} does not parse:\n${res.stderr}`);
  }
});

test('every JSON file parses', () => {
  for (const file of walk(REPO, '.json')) {
    assert.doesNotThrow(
      () => JSON.parse(fs.readFileSync(file, 'utf8')),
      `${path.relative(REPO, file)} is not valid JSON`
    );
  }
});

test('the marketplace lists every plugin in the repository', () => {
  const listed = MARKETPLACE.plugins
    .filter((p) => typeof p.source === 'string')
    .map((p) => path.basename(p.source));
  for (const dir of PLUGIN_DIRS) {
    assert.ok(listed.includes(dir), `plugins/${dir} is not listed in marketplace.json`);
  }
});

test('every marketplace entry resolves to something real', () => {
  for (const entry of MARKETPLACE.plugins) {
    assert.ok(entry.name, 'an entry is missing a name');
    assert.ok(entry.description, `${entry.name} is missing a description`);

    if (typeof entry.source === 'string') {
      const dir = path.join(REPO, entry.source);
      assert.ok(fs.existsSync(dir), `${entry.name}: ${entry.source} does not exist`);
      assert.ok(
        fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json')),
        `${entry.name}: no plugin.json`
      );
    } else {
      assert.equal(entry.source.source, 'url', `${entry.name}: unexpected source type`);
      assert.match(entry.source.url, /^https:\/\//, `${entry.name}: url should be https`);
    }
  }
});

test('every plugin.json is complete and agrees with its directory', () => {
  for (const dir of PLUGIN_DIRS) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO, 'plugins', dir, '.claude-plugin', 'plugin.json'), 'utf8')
    );
    assert.equal(manifest.name, dir, `plugins/${dir}: name should match the directory`);
    for (const field of ['description', 'version', 'license', 'author', 'homepage']) {
      assert.ok(manifest[field], `plugins/${dir}: missing ${field}`);
    }
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/, `plugins/${dir}: version should be semver`);

    const entry = MARKETPLACE.plugins.find((p) => p.name === dir);
    assert.ok(entry, `plugins/${dir}: no marketplace entry`);
  }
});

test('every hook command points at a file that exists', () => {
  for (const dir of PLUGIN_DIRS) {
    const root = path.join(REPO, 'plugins', dir);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')
    );
    const events = Object.values(manifest.hooks || {}).flat();
    assert.ok(events.length, `plugins/${dir}: declares no hooks`);

    for (const event of events) {
      for (const h of event.hooks || []) {
        const referenced = String(h.command).match(/\$\{CLAUDE_PLUGIN_ROOT\}([^"']+)/);
        assert.ok(referenced, `plugins/${dir}: hook command does not use CLAUDE_PLUGIN_ROOT`);
        const file = path.join(root, referenced[1]);
        assert.ok(fs.existsSync(file), `plugins/${dir}: hook references missing ${referenced[1]}`);
        assert.ok(h.timeout > 0, `plugins/${dir}: hook has no timeout`);
      }
    }
  }
});

test('every plugin ships both readmes and an example config', () => {
  for (const dir of PLUGIN_DIRS) {
    const root = path.join(REPO, 'plugins', dir);
    for (const file of ['README.md', 'README.tr.md', 'config.example.json']) {
      assert.ok(fs.existsSync(path.join(root, file)), `plugins/${dir}: missing ${file}`);
    }
    const example = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'));
    assert.equal(typeof example, 'object');
    assert.ok('enabled' in example, `plugins/${dir}: config.example.json should show "enabled"`);
  }
});

test('the readme documents installing each plugin', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  for (const entry of MARKETPLACE.plugins) {
    assert.ok(
      readme.includes(`/plugin install ${entry.name}@${MARKETPLACE.name}`),
      `README.md does not show how to install ${entry.name}`
    );
  }
});
