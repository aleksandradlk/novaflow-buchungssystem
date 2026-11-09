// Guards for the hard rules in CLAUDE.md:
// - kern/ contains nothing customer-specific
// - nothing visible to end customers names the tools behind it
// - the assembled web root makes no external calls

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KERN, KUNDEN, WEB_DIR, customerDir } from '../lib/paths.mjs';
import { loadCustomer } from '../lib/config.mjs';
import { buildPublic } from '../lib/public.mjs';
import { platformKey, readVersionPin } from '../lib/pocketbase.mjs';

const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.md', '.txt']);
const TOOL_NAMES = /pocketbase|n8n|caddy/i;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (TEXT_EXT.has(path.extname(entry.name))) yield full;
  }
}

function customerIds() {
  return fs.readdirSync(KUNDEN, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

test('kern/ enthält keine Kundennamen oder -domains', () => {
  for (const id of customerIds()) {
    const { config } = loadCustomer(customerDir(id));
    const needles = [config.kunde.name, config.kunde.firma.name, config.kunde.domain].map((s) => s.toLowerCase());
    for (const file of walk(KERN)) {
      const content = fs.readFileSync(file, 'utf8').toLowerCase();
      for (const n of needles) {
        assert.ok(!content.includes(n), `${path.relative(KERN, file)} enthält „${n}“ (aus kunden/${id})`);
      }
    }
  }
});

test('kern/web nennt keine Tool-Namen', () => {
  for (const file of walk(WEB_DIR)) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), TOOL_NAMES, path.relative(KERN, file));
  }
});

test('zusammengebaute Seiten: keine Tool-Namen, keine externen Adressen', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-public-'));
  try {
    for (const id of customerIds()) {
      const dir = customerDir(id);
      const { config } = loadCustomer(dir);
      buildPublic({ customerDirPath: dir, branding: config.branding, outDir: out });
      for (const file of walk(out)) {
        const content = fs.readFileSync(file, 'utf8').replace(/xmlns(:\w+)?="http:\/\/www\.w3\.org\/[^"]*"/g, '');
        const rel = path.relative(out, file);
        assert.doesNotMatch(content, TOOL_NAMES, `${id}: ${rel}`);
        assert.doesNotMatch(content, /(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i, `${id}: ${rel} enthält eine externe Adresse`);
      }
      assert.ok(fs.existsSync(path.join(out, 'kunde', 'branding.css')));
      assert.ok(fs.existsSync(path.join(out, 'uebersicht', 'index.html')));
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Backend-Version ist gepinnt, mit Prüfsummen für alle unterstützten Plattformen', () => {
  const pin = readVersionPin();
  assert.match(pin.version, /^\d+\.\d+\.\d+$/);
  for (const key of ['linux_amd64', 'linux_arm64', 'windows_amd64', 'windows_arm64', 'darwin_amd64', 'darwin_arm64']) {
    assert.match(pin.sha256[key] ?? '', /^[0-9a-f]{64}$/, key);
  }
  assert.equal(platformKey('win32', 'x64'), 'windows_amd64');
  assert.equal(platformKey('linux', 'arm64'), 'linux_arm64');
  assert.throws(() => platformKey('linux', 'ia32'), /nicht unterstützt/);
});

test('package.json pinnt alle Abhängigkeiten exakt', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(KERN, '..', 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name}@${version} ist nicht exakt gepinnt`);
  }
});
