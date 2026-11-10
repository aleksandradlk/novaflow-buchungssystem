// Test helpers: time zone converters (Node/Intl) and a real backend instance.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { customerDir } from '../lib/paths.mjs';
import { loadCustomer, validateConfig } from '../lib/config.mjs';
import { ensurePocketBase } from '../lib/pocketbase.mjs';
import { instanceArgs, prepareInstance } from '../lib/instanz.mjs';
import { buildPublic } from '../lib/public.mjs';

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

export async function freierPort() {
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
export function testKonfiguration(mutate, dir = customerDir('_beispiel')) {
  const { config } = loadCustomer(dir);
  const c = structuredClone(config);
  c.termine.zeitraum = { buchbar_ab: '2030-01-07', buchbar_bis: '2030-03-31' };
  c.termine.folgetermin = { termintyp: 'abholung', ab: '2030-04-01', bis: '2030-05-31' };
  c.termine.sperrtage = [{ datum: '2030-01-09', grund: 'Test-Sperrtag' }];
  if (mutate) mutate(c);
  const errors = validateConfig(c, { dir });
  if (errors.length) throw new Error(`Testkonfiguration ungültig:\n${errors.join('\n')}`);
  return c;
}

/**
 * Starts a real instance (migrations, start values, admin) with a webhook receiver.
 * With seiten: true the public pages are served too (branding from kundeDir).
 * Returns helpers for requests; call stop() at the end.
 */
export async function startInstanz({ mutate, kundeDir = customerDir('_beispiel'), seiten = false, env: extraEnv = {} } = {}) {
  const exe = await ensurePocketBase({ log: () => {} });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-api-'));
  const dataDir = path.join(root, 'pb_data');
  const config = testKonfiguration(mutate, kundeDir);
  const extraArgs = [];
  if (seiten) {
    const publicDir = buildPublic({ customerDirPath: kundeDir, branding: config.branding, outDir: path.join(root, 'public') });
    extraArgs.push(`--publicDir=${publicDir}`);
  }

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
    NF_WEBHOOK_SECRET: 'test-geheimnis-1234567890',
    NF_SUPERUSER_2FA: '0', // tests use the admin API directly; the 2FA itself is tested separately
    ...extraEnv,
  };
  const admin = { email: 'admin@test.example', password: 'test-passwort-123' };
  prepareInstance({ exe, dataDir, config, superuser: admin, quiet: true, env });

  const child = spawn(exe, ['serve', `--http=127.0.0.1:${port}`, ...extraArgs, ...instanceArgs(dataDir)], { env, stdio: 'pipe' });
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

  // with the admin second factor switched on (betrieb.test.mjs) there is no plain password login
  const adminToken = env.NF_SUPERUSER_2FA === '0' ? await login('_superusers', admin.email, admin.password) : null;

  /** Code of a requested login (read from the outbox like the mail would deliver it). */
  async function anmeldecode(otpId) {
    // the backend hands the code over in the background after answering the request
    const n = await warteAuf(async () => {
      const r = await api('GET', `/api/collections/nachrichten/records?filter=${encodeURIComponent(`schluessel = "anmeldecode:${otpId}"`)}`, { token: adminToken });
      return r.json.items[0];
    }, { timeout: 5000, schritt: 50, text: `Anmeldecode für ${otpId}` });
    return n.text.match(/\b(\d{6})\b/)[1];
  }

  /** Overview login with two factors: password, then one-time code. */
  async function teamLogin(email, password) {
    const pw = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password } });
    if (!pw.json || !pw.json.mfaId) throw new Error(`Zwei-Faktor erwartet (${pw.status}): ${pw.text}`);
    const otp = await api('POST', '/api/collections/users/request-otp', { body: { email } });
    const code = await anmeldecode(otp.json.otpId);
    const r = await api('POST', '/api/collections/users/auth-with-otp', { body: { otpId: otp.json.otpId, password: code, mfaId: pw.json.mfaId } });
    if (r.status !== 200) throw new Error(`Anmeldung mit Code fehlgeschlagen (${r.status}): ${r.text}`);
    return r.json.token;
  }

  return {
    base,
    env,
    admin,
    dataDir,
    api,
    login,
    teamLogin,
    anmeldecode,
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

// ---------------------------------------------------------------- mail test doubles

/** Decodes MIME encoded words (=?UTF-8?B?…?= / =?UTF-8?Q?…?=) in a header value. */
function dekodiereHeader(wert) {
  return wert.replace(/=\?utf-8\?([bq])\?([^?]*)\?=\s*/gi, (_, art, inhalt) => (art.toLowerCase() === 'b'
    ? Buffer.from(inhalt, 'base64').toString('utf8')
    : Buffer.from(inhalt.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')));
}

function dekodiereQP(text) {
  const bytes = text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bytes, 'latin1').toString('utf8');
}

function mailLesen(roh, von, an) {
  const [kopf] = roh.split('\r\n\r\n');
  const header = {};
  for (const zeile of kopf.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const i = zeile.indexOf(':');
    if (i > 0) header[zeile.slice(0, i).toLowerCase()] = dekodiereHeader(zeile.slice(i + 1).trim());
  }
  return { von, an, betreff: header.subject || '', header, inhalt: dekodiereQP(roh) };
}

/**
 * Minimal SMTP server as test mailbox (no TLS). empfaenger.ablehnen = true rejects mails.
 */
export async function smtpEmpfaenger() {
  const mails = [];
  const zustand = { ablehnen: false };
  const server = net.createServer((sock) => {
    let puffer = '';
    let imText = false;
    let text = '';
    let von = '';
    let an = [];
    let authLogin = 0;
    const sende = (z) => sock.write(`${z}\r\n`);
    sende('220 test-postfach ESMTP');
    sock.on('data', (chunk) => {
      puffer += chunk.toString('latin1');
      let i;
      while ((i = puffer.indexOf('\r\n')) !== -1) {
        const zeile = puffer.slice(0, i);
        puffer = puffer.slice(i + 2);
        if (imText) {
          if (zeile === '.') {
            imText = false;
            if (zustand.ablehnen) sende('554 5.7.1 abgelehnt (Test)');
            else {
              mails.push(mailLesen(text, von, an));
              sende('250 2.0.0 OK');
            }
            text = '';
          } else text += `${zeile.startsWith('..') ? zeile.slice(1) : zeile}\r\n`;
          continue;
        }
        if (authLogin) {
          authLogin = authLogin === 1 ? (sende('334 UGFzc3dvcmQ6'), 2) : (sende('235 2.7.0 OK'), 0);
          continue;
        }
        const befehl = zeile.split(' ')[0].toUpperCase();
        if (befehl === 'EHLO') { sende('250-test-postfach'); sende('250-AUTH PLAIN LOGIN'); sende('250 8BITMIME'); }
        else if (befehl === 'HELO') sende('250 test-postfach');
        else if (befehl === 'AUTH') {
          if (/^AUTH LOGIN/i.test(zeile)) { authLogin = 1; sende('334 VXNlcm5hbWU6'); } else sende('235 2.7.0 OK');
        }
        else if (befehl === 'MAIL') { von = (zeile.match(/<([^>]*)>/) || [])[1] || ''; an = []; sende('250 OK'); }
        else if (befehl === 'RCPT') { an.push((zeile.match(/<([^>]*)>/) || [])[1] || ''); sende('250 OK'); }
        else if (befehl === 'DATA') { imText = true; sende('354 Ende mit <CRLF>.<CRLF>'); }
        else if (befehl === 'RSET' || befehl === 'NOOP') sende('250 OK');
        else if (befehl === 'QUIT') { sende('221 Bye'); sock.end(); }
        else sende('502 nicht unterstützt');
      }
    });
    sock.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    mails,
    zustand,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Small HTTP test double: handler(req, body) → { status, json }. Records all calls. */
export async function httpAttrappe(handler) {
  const aufrufe = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const aufruf = { methode: req.method, pfad: req.url, header: req.headers, body };
      aufrufe.push(aufruf);
      const antwort = handler(aufruf) || { status: 404, json: {} };
      res.writeHead(antwort.status, { 'Content-Type': 'application/json' });
      res.end(antwort.json === undefined ? '' : JSON.stringify(antwort.json));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, aufrufe, close: () => new Promise((r) => server.close(r)) };
}

/** Polls until fn() returns a truthy value (or throws after timeout). */
export async function warteAuf(fn, { timeout = 20000, schritt = 200, text = 'Bedingung' } = {}) {
  const ende = Date.now() + timeout;
  for (;;) {
    const wert = await fn();
    if (wert) return wert;
    if (Date.now() > ende) throw new Error(`Zeitüberschreitung beim Warten auf: ${text}`);
    await new Promise((r) => setTimeout(r, schritt));
  }
}

// ---------------------------------------------------------------- n8n (optional)

/** Directory of an n8n installation for tests (NF_TEST_N8N_DIR, contains node_modules/.bin/n8n), or null. */
export function n8nVerzeichnis() {
  const d = process.env.NF_TEST_N8N_DIR;
  return d && fs.existsSync(path.join(d, 'node_modules', '.bin', 'n8n')) ? d : null;
}

/** Starts an isolated n8n (own data folder, 127.0.0.1 only, no telemetry) with the given import files. */
export async function startN8n({ dir, workflows, credentials, webhookPfad, port: wunschPort }) {
  const bin = path.join(dir, 'node_modules', '.bin');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-n8n-'));
  const port = wunschPort || await freierPort();
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    N8N_USER_FOLDER: ordner,
    N8N_PORT: String(port),
    N8N_LISTEN_ADDRESS: '127.0.0.1',
    N8N_ENCRYPTION_KEY: 'test-schluessel-nur-fuer-tests-123',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_TEMPLATES_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_HIRING_BANNER_ENABLED: 'false',
    N8N_LOG_LEVEL: 'warn',
    N8N_SECURE_COOKIE: 'false',
    GENERIC_TIMEZONE: 'Europe/Berlin',
  };
  const cred = path.join(ordner, 'credentials.json');
  const wf = path.join(ordner, 'workflows.json');
  fs.writeFileSync(cred, JSON.stringify(credentials));
  fs.writeFileSync(wf, JSON.stringify(workflows));
  const n8n = path.join(bin, 'n8n');
  const ausfuehren = (args) => execFileSync(n8n, args, { env, encoding: 'utf8', stdio: 'pipe' });
  ausfuehren(['import:credentials', `--input=${cred}`]);
  ausfuehren(['import:workflow', `--input=${wf}`]);
  // n8n 2.x (regular mode): workflows become active by publishing them
  for (const w of workflows.filter((x) => x.active)) ausfuehren(['publish:workflow', `--id=${w.id}`]);
  fs.rmSync(cred);

  const child = spawn(n8n, ['start'], { env, stdio: 'pipe' });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  await warteAuf(async () => {
    try {
      return (await fetch(`${base}/healthz/readiness`)).ok;
    } catch {
      return false;
    }
  }, { timeout: 90000, schritt: 500, text: `n8n-Start\n${log}` });
  // "ready" comes before the workflows are activated: wait until the webhook exists (≠ 404)
  if (webhookPfad) {
    await warteAuf(async () => {
      try {
        return (await fetch(`${base}/webhook/${webhookPfad}`, { method: 'POST' })).status !== 404;
      } catch {
        return false;
      }
    }, { timeout: 60000, schritt: 300, text: `Webhook ${webhookPfad}\n${log}` });
  }
  return {
    base,
    log: () => log,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
      fs.rmSync(ordner, { recursive: true, force: true });
    },
  };
}
