// Test helpers: time zone converters (Node/Intl) and a real backend instance.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { customerDir } from '../lib/paths.mjs';
import { loadCustomer, validateConfig } from '../lib/config.mjs';
import { ensurePocketBase } from '../lib/pocketbase.mjs';
import { instanceArgs, prepareInstance } from '../lib/instanz.mjs';

export const require = createRequire(import.meta.url);
export const slots = require('../../pb_hooks/nf/slots.js');

/** Same converters as kern/pb_hooks/nf/basis.js, implemented with Intl. */
export function zeitIntl(tz = 'Europe/Berlin') {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const teile = (ms) => Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const offset = (ms) => {
    const p = teile(ms);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000;
  };
  return {
    toUtcMs(datum, uhrzeit) {
      const [y, m, d] = datum.split('-').map(Number);
      const [h, min] = uhrzeit.split(':').map(Number);
      const naiv = Date.UTC(y, m - 1, d, h, min);
      let utc = naiv - offset(naiv);
      utc = naiv - offset(utc);
      return utc;
    },
    toLocal(ms) {
      const p = teile(ms);
      return { datum: `${p.year}-${p.month}-${p.day}`, zeit: `${p.hour}:${p.minute}` };
    },
  };
}

const berlin = zeitIntl();
/** ISO start time for a local date/time in Berlin. */
export function slot(datum, uhrzeit) {
  return new Date(berlin.toUtcMs(datum, uhrzeit)).toISOString();
}

async function freierPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

/** Example config with deterministic dates far in the future (2030). */
export function testKonfiguration(mutate) {
  const dir = customerDir('_beispiel');
  const { config } = loadCustomer(dir);
  const c = structuredClone(config);
  c.termine.zeitraum = { buchbar_ab: '2030-01-07', buchbar_bis: '2030-03-31' };
  c.termine.folgetermin = { termintyp: 'abholung', ab: '2030-04-01', bis: '2030-05-31' };
  c.termine.sperrtage = [{ datum: '2030-01-09', grund: 'Test-Sperrtag' }];
  if (mutate) mutate(c);
  const errors = validateConfig(c, { dir, folderName: '_beispiel' });
  if (errors.length) throw new Error(`Testkonfiguration ungültig:\n${errors.join('\n')}`);
  return c;
}

/**
 * Starts a real instance (migrations, start values, admin) with a webhook receiver.
 * Returns helpers for requests; call stop() at the end.
 */
export async function startInstanz({ mutate } = {}) {
  const exe = await ensurePocketBase({ log: () => {} });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-api-'));
  const dataDir = path.join(root, 'pb_data');
  const config = testKonfiguration(mutate);

  const webhooks = [];
  const empfaenger = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      webhooks.push({ pfad: req.url, secret: req.headers['x-nf-secret'], body: JSON.parse(body || '{}') });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise((r) => empfaenger.listen(0, '127.0.0.1', r));

  const port = await freierPort();
  const env = {
    ...process.env,
    NF_WEBHOOK_URL: `http://127.0.0.1:${empfaenger.address().port}`,
    NF_WEBHOOK_SECRET: 'test-geheimnis',
  };
  const admin = { email: 'admin@test.example', password: 'test-passwort-123' };
  prepareInstance({ exe, dataDir, config, superuser: admin, quiet: true, env });

  const child = spawn(exe, ['serve', `--http=127.0.0.1:${port}`, ...instanceArgs(dataDir)], { env, stdio: 'pipe' });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;

  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw new Error(`Instanz startet nicht:\n${log}`);
  }

  async function api(method, pfad, { body, token, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = token;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}${pfad}`, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  }

  async function login(collection, email, password) {
    const r = await api('POST', `/api/collections/${collection}/auth-with-password`, { body: { identity: email, password } });
    if (r.status !== 200) throw new Error(`Login fehlgeschlagen (${r.status}): ${r.text}`);
    return r.json.token;
  }

  const adminToken = await login('_superusers', admin.email, admin.password);

  return {
    base,
    api,
    login,
    adminToken,
    webhooks,
    log: () => log,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
      await new Promise((r) => empfaenger.close(r));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
