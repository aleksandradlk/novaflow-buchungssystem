// Phase 7 rehearsal ("Generalprobe"): the real deploy/ scripts against a real web server
// (TLS with a local CA) and a real backup repository, on this machine instead of the VPS.
//   neuer-kunde.sh → pages over https (headers, blocked admin, no tool names, browser CSP) →
//   booking with photo → backup.sh → wiederherstellen.sh --als (test instance, same data) →
//   ausrollen.sh (ok + broken build rolls back) → kunde-entfernen.sh
// Opt-in, because it needs the two server tools:
//   NF_TEST_CADDY=/pfad/caddy NF_TEST_RESTIC=/pfad/restic npm test
// Differences to the server (documented in docs/BETRIEB.md): no systemd (NF_OHNE_SYSTEMD=1),
// no separate service user, paths in a temp folder.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DEV_DIR, ROOT } from '../lib/paths.mjs';
import { ensurePocketBase } from '../lib/pocketbase.mjs';
import { freierPort, require, warteAuf } from './hilfen.mjs';

const CADDY = process.env.NF_TEST_CADDY;
const RESTIC = process.env.NF_TEST_RESTIC;
const ohne = CADDY && RESTIC ? false : 'NF_TEST_CADDY / NF_TEST_RESTIC nicht gesetzt – Generalprobe übersprungen.';

let playwright = null;
try {
  playwright = require('playwright');
} catch {
  playwright = null;
}

const DOMAIN = 'demo.localhost';
const TOOLNAMEN = /pocketbase|n8n|caddy|restic/i;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Generalprobe Betrieb (deploy/)', { skip: ohne }, () => {
  let tmp;
  let env;
  let caddy;
  let HTTPS;
  let HTTP;
  let token; // manage token of the booking made over https
  const instanzen = new Set();

  function skript(name, args = [], extraEnv = {}) {
    const r = spawnSync('bash', [path.join(env.NF_VORLAGE, 'deploy', name), ...args], {
      env: { ...env, ...extraEnv },
      encoding: 'utf8',
      timeout: 180000,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  const envDatei = (name) => path.join(env.NF_ETC, `${name}.env`);
  const envWert = (name, key) => (fs.readFileSync(envDatei(name), 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1];
  const resticJson = (...args) => JSON.parse(spawnSync(RESTIC, [...args, '--json'], { env: { ...env, ...resticEnv() }, encoding: 'utf8' }).stdout);
  const resticEnv = () => ({ RESTIC_REPOSITORY: path.join(tmp, 'repo'), RESTIC_PASSWORD_FILE: path.join(env.NF_ETC, 'restic-passwort') });

  /** Request through the web server, exactly as a browser would send it (SNI + Host). */
  function holen(pfad, { method = 'GET', body, headers = {}, port = HTTPS, tls = true } = {}) {
    const modul = tls ? https : http;
    return new Promise((resolve, reject) => {
      const req = modul.request(
        { host: '127.0.0.1', port, path: pfad, method, servername: DOMAIN, rejectUnauthorized: false, headers: { host: `${DOMAIN}:${port}`, ...headers } },
        (res) => {
          const teile = [];
          res.on('data', (c) => teile.push(c));
          res.on('end', () => {
            const text = Buffer.concat(teile).toString('utf8');
            let json = null;
            try { json = JSON.parse(text); } catch { /* not json */ }
            resolve({ status: res.statusCode, headers: res.headers, text, json });
          });
        },
      );
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  async function lokal(name, pfad) {
    const res = await fetch(`http://127.0.0.1:${envWert(name, 'PB_PORT')}${pfad}`);
    return { status: res.status, text: await res.text() };
  }

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-generalprobe-'));
    [HTTPS, HTTP] = [await freierPort(), await freierPort()];
    const adminPort = await freierPort();
    const caddyfile = path.join(tmp, 'Caddyfile');
    fs.writeFileSync(caddyfile, `{
	admin 127.0.0.1:${adminPort}
	persist_config off
	local_certs
	skip_install_trust
	http_port ${HTTP}
	https_port ${HTTPS}
	storage file_system ${path.join(tmp, 'caddy-daten')}
}
import ${path.join(tmp, 'caddy.d')}/*.caddy
`);
    env = {
      ...process.env,
      NF_VORLAGE: ROOT,
      NF_SRV: path.join(tmp, 'srv'),
      NF_ETC: path.join(tmp, 'etc'),
      NF_BIN: path.join(DEV_DIR, 'bin'),
      NF_CADDY_DIR: path.join(tmp, 'caddy.d'),
      NF_CADDYFILE: caddyfile,
      NF_CADDY: CADDY,
      NF_CADDY_NEU_LADEN: `'${CADDY}' reload --config '${caddyfile}' --adapter caddyfile`,
      NF_RESTIC: RESTIC,
      NF_BENUTZER: '',
      NF_OHNE_SYSTEMD: '1',
      NF_PORT_AB: String(await freierPort()),
    };
    await ensurePocketBase({ log: () => {} });

    fs.mkdirSync(env.NF_ETC, { mode: 0o700 });
    fs.writeFileSync(path.join(env.NF_ETC, 'restic-passwort'), 'generalprobe-passwort-1234567890', { mode: 0o600 });
    fs.writeFileSync(path.join(env.NF_ETC, 'betrieb.env'), `RESTIC_REPOSITORY=${resticEnv().RESTIC_REPOSITORY}\nRESTIC_PASSWORD_FILE=${resticEnv().RESTIC_PASSWORD_FILE}\n`, { mode: 0o600 });
    const init = spawnSync(RESTIC, ['init', '--quiet'], { env: { ...env, ...resticEnv() }, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);

    fs.mkdirSync(path.join(tmp, 'caddy.d'));
    caddy = spawn(CADDY, ['run', '--config', caddyfile, '--adapter', 'caddyfile'], {
      env: { ...process.env, HOME: tmp, XDG_DATA_HOME: path.join(tmp, 'xdg'), XDG_CONFIG_HOME: path.join(tmp, 'xdg') },
      stdio: 'ignore',
    });
    // plain request: the admin endpoint refuses browser-like fetch() requests
    const bereit = () => new Promise((r) => http.get(`http://127.0.0.1:${adminPort}/config/`, (res) => { res.resume(); r(res.statusCode === 200); }).on('error', () => r(false)));
    await warteAuf(bereit, { text: 'Webserver' });
  });

  after(async () => {
    for (const name of instanzen) {
      const pid = path.join(env.NF_SRV, name, 'probe.pid');
      if (fs.existsSync(pid)) try { process.kill(Number(fs.readFileSync(pid, 'utf8'))); } catch { /* already gone */ }
    }
    if (caddy) {
      caddy.kill();
      await new Promise((r) => caddy.once('exit', r));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('neuer-kunde.sh legt Instanz, Umgebung (600), Dienst, Webserver-Block und Automationen an', () => {
    instanzen.add('demo');
    const r = skript('neuer-kunde.sh', ['_beispiel', '--name', 'demo', '--domain', DOMAIN, '--inhaber', 'inhaber@example.org']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Zugang inhaber@example\.org \(inhaber\) – Passwort \(nur jetzt sichtbar\): \S{20}/);
    assert.doesNotMatch(r.out, /SELECT|INSERT/, 'keine SQL-Ausgabe');

    assert.equal(fs.statSync(envDatei('demo')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(env.NF_ETC).mode & 0o777, 0o700);
    assert.equal(envWert('demo', 'NF_KUNDE'), '_beispiel');
    assert.equal(envWert('demo', 'NF_OEFFENTLICHE_URL'), `https://${DOMAIN}`);
    assert.match(envWert('demo', 'NF_WEBHOOK_SECRET'), /^[0-9a-f]{64}$/);
    assert.ok(Number(envWert('demo', 'PB_PORT')) >= Number(env.NF_PORT_AB));
    assert.doesNotMatch(fs.readFileSync(envDatei('demo'), 'utf8'), /PB_SUPERUSER/);

    const d = path.join(env.NF_SRV, 'demo');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'app', 'version.json'), 'utf8')).kunde, '_beispiel');
    assert.ok(fs.existsSync(path.join(env.NF_CADDY_DIR, 'demo.caddy')));
    assert.equal(fs.statSync(path.join(d, 'n8n')).mode & 0o777, 0o700);
    const wf = JSON.parse(fs.readFileSync(path.join(d, 'n8n', 'workflows.json'), 'utf8'));
    assert.ok(wf.length > 5);
    // only the webhook secret so far (mail access is entered later) – root only
    const cred = JSON.parse(fs.readFileSync(path.join(d, 'n8n', 'credentials.json'), 'utf8'));
    assert.deepEqual(cred.map((c) => c.type), ['httpHeaderAuth']);
    assert.equal(cred[0].data.value, envWert('demo', 'NF_WEBHOOK_SECRET'));
    assert.equal(fs.statSync(path.join(d, 'n8n', 'credentials.json')).mode & 0o777, 0o600);

    const nochmal = skript('neuer-kunde.sh', ['_beispiel', '--name', 'demo', '--domain', DOMAIN]);
    assert.notEqual(nochmal.status, 0);
    assert.match(nochmal.out, /gibt es schon/);
  });

  test('Seiten über https: Sicherheits-Header, kein Server-Header, keine Tool-Namen', async () => {
    for (const pfad of ['/', '/uebersicht/', '/verwalten/?t=x', '/abmelden/?t=x', '/api/nf/angebot', '/gemeinsam/basis.css', '/kunde/branding.css', '/gibt-es-nicht', '/_/']) {
      const r = await holen(pfad);
      const h = r.headers;
      assert.ok(!('server' in h) && !('via' in h) && !('x-powered-by' in h), `${pfad}: ${JSON.stringify(h)}`);
      assert.match(h['strict-transport-security'] ?? '', /max-age=\d{7,}/, pfad);
      assert.equal(h['x-content-type-options'], 'nosniff', pfad);
      assert.equal(h['referrer-policy'], 'no-referrer', pfad);
      assert.match(h['content-security-policy'] ?? '', /^default-src 'self';/, pfad);
      assert.doesNotMatch(h['content-security-policy'], /https?:/, pfad);
      assert.doesNotMatch(`${JSON.stringify(h)}\n${r.text}`, TOOLNAMEN, pfad);
      assert.ok(!h['set-cookie'], `${pfad} setzt ein Cookie`);
    }
    // http → https without revealing the web server
    const u = await holen('/uebersicht/?a=1', { port: HTTP, tls: false });
    assert.equal(u.status, 308);
    assert.equal(u.headers.location, `https://${DOMAIN}/uebersicht/?a=1`);
    assert.ok(!('server' in u.headers), JSON.stringify(u.headers));
  });

  test('Admin und interne Schnittstellen sind von außen gesperrt (auch mit Pfad-Tricks)', async () => {
    for (const pfad of ['/_/', '/_', '//_/', '/_/./', '/%5F/', '/api/nf-intern/offen', '/api/nf-intern/../nf-intern/offen', '/api/nf-intern//offen',
      '/api/collections/_superusers/auth-with-password', '/api/settings', '/api/backups', '/api/logs', '/api/crons', '/api/batch', '/api/realtime', '/api/health']) {
      for (const method of ['GET', 'POST']) {
        const r = await holen(pfad, { method });
        assert.equal(r.status, 404, `${method} ${pfad}: ${r.status} ${r.text.slice(0, 80)}`);
        assert.equal(r.text, '', `${method} ${pfad}`);
      }
    }
    // on the server itself (SSH tunnel) the admin UI is there
    assert.equal((await lokal('demo', '/_/')).status, 200);
  });

  test('Buchung mit Foto über https', async () => {
    const a = await holen('/api/nf/angebot');
    assert.equal(a.status, 200, a.text);
    const morgen = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    let von = a.json.zeitraum.ab > morgen ? a.json.zeitraum.ab : morgen;
    let frei = null;
    for (let i = 0; i < 8 && !frei; i++) {
      const bis = new Date(Date.parse(von) + 13 * 86400000).toISOString().slice(0, 10);
      const s = await holen(`/api/nf/slots?typ=abgabe&von=${von}&bis=${bis}`);
      assert.equal(s.status, 200, s.text);
      frei = s.json.slots.find((x) => x.frei > 0);
      von = new Date(Date.parse(bis) + 86400000).toISOString().slice(0, 10);
    }
    assert.ok(frei, 'kein freier Termin gefunden');

    const form = new FormData();
    form.set('daten', JSON.stringify({
      angebot: 'basis',
      start: frei.start,
      kontakt: { vorname: 'Erika', nachname: 'Probe', email: 'erika@example.com', telefon: '0123 456789' },
      zusatzfelder: { zustand: 'Gut' },
    }));
    form.append('fotos', new Blob([PNG], { type: 'image/png' }), 'foto.png');
    const req = new Request('http://x/', { method: 'POST', body: form });
    const r = await holen('/api/nf/buchen', { method: 'POST', body: Buffer.from(await req.arrayBuffer()), headers: { 'content-type': req.headers.get('content-type') } });
    assert.equal(r.status, 201, r.text);
    token = r.json.verwalten_token;
    assert.equal((await holen(`/api/nf/verwalten?t=${token}`)).status, 200);
  });

  test('Browser: Buchungsseite und Übersicht laufen unter der strengen CSP, ohne Cookies und Speicher', { skip: playwright ? false : 'Playwright fehlt' }, async () => {
    const browser = await playwright.chromium.launch({ args: [`--host-resolver-rules=MAP ${DOMAIN} 127.0.0.1`] });
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const verstoesse = [];
      page.on('console', (m) => { if (/Content.Security.Policy|Refused to/i.test(m.text())) verstoesse.push(m.text()); });
      page.on('pageerror', (e) => verstoesse.push(e.message));
      const basis = `https://${DOMAIN}:${HTTPS}`;

      await page.goto(`${basis}/`);
      await page.getByText('Paket Basis').first().waitFor();
      await page.goto(`${basis}/verwalten/?t=${token}`);
      await page.getByText(/Termin/).first().waitFor();
      await page.goto(`${basis}/uebersicht/`);
      await page.locator('input[type="email"]').first().waitFor();

      assert.deepEqual(verstoesse, []);
      assert.deepEqual(await context.cookies(), []);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      const farbe = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim());
      assert.ok(farbe, 'Branding-CSS geladen');
    } finally {
      await browser.close();
    }
  });

  test('backup.sh: konsistente Sicherung mit Datenbank, Fotos und Umgebung', () => {
    const r = skript('backup.sh', ['demo']);
    assert.equal(r.status, 0, r.out);
    const snaps = resticJson('snapshots', '--tag', 'instanz:demo');
    assert.equal(snaps.length, 1);
    const dateien = spawnSync(RESTIC, ['ls', snaps[0].short_id], { env: { ...env, ...resticEnv() }, encoding: 'utf8' }).stdout;
    assert.match(dateien, /\.sicherung\/demo\/data\.db$/m);
    assert.match(dateien, /\.sicherung\/demo\/instanz\.env$/m);
    assert.match(dateien, /pb_data\/storage\/.+\.png$/m);
    assert.doesNotMatch(dateien, /auxiliary\.db/, 'Protokolle (IP-Adressen) werden nicht gesichert');
    assert.ok(!fs.existsSync(path.join(env.NF_SRV, '.sicherung', 'demo')), 'Zwischenkopie aufgeräumt');
  });

  test('wiederherstellen.sh --als: Testinstanz mit denselben Daten, die nichts versendet', async () => {
    instanzen.add('demo-test');
    const r = skript('wiederherstellen.sh', ['demo', '--als', 'demo-test']);
    assert.equal(r.status, 0, r.out);
    assert.equal(fs.statSync(envDatei('demo-test')).mode & 0o777, 0o600);
    assert.equal(envWert('demo-test', 'NF_WEBHOOK_URL'), '');
    assert.notEqual(envWert('demo-test', 'NF_WEBHOOK_SECRET'), envWert('demo', 'NF_WEBHOOK_SECRET'));
    assert.notEqual(envWert('demo-test', 'PB_PORT'), envWert('demo', 'PB_PORT'));
    assert.ok(!fs.existsSync(path.join(env.NF_CADDY_DIR, 'demo-test.caddy')), 'ohne --domain nicht öffentlich');

    const original = JSON.parse((await holen(`/api/nf/verwalten?t=${token}`)).text);
    const kopie = await lokal('demo-test', `/api/nf/verwalten?t=${token}`);
    assert.equal(kopie.status, 200, kopie.text);
    assert.deepEqual(JSON.parse(kopie.text).buchung, original.buchung);
    const fotos = fs.readdirSync(path.join(env.NF_SRV, 'demo-test', 'pb_data', 'storage'), { recursive: true }).filter((f) => f.endsWith('.png'));
    assert.ok(fotos.length >= 1, 'Foto wiederhergestellt');
  });

  test('ausrollen.sh: neuer Stand ohne Datenverlust; kaputter Stand wird automatisch zurückgerollt', async () => {
    const ok = skript('ausrollen.sh', ['demo', '--ohne-git']);
    assert.equal(ok.status, 0, ok.out);
    assert.ok(fs.existsSync(path.join(env.NF_SRV, 'demo', 'app.vorher')));
    assert.equal((await holen(`/api/nf/verwalten?t=${token}`)).status, 200);

    // template copy with a broken hook file: the instance would start, but without its routes
    const kaputt = path.join(tmp, 'vorlage-kaputt');
    for (const teil of ['kern', 'kunden', 'deploy', 'package.json', '.env.example']) fs.cpSync(path.join(ROOT, teil), path.join(kaputt, teil), { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(kaputt, 'node_modules'));
    fs.appendFileSync(path.join(kaputt, 'kern', 'pb_hooks', 'nf.pb.js'), '\nrouterAdd("GET", "/api/nf/kaputt", (e) => {\n');
    const r = skript('ausrollen.sh', ['demo', '--ohne-git'], { NF_VORLAGE: kaputt });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /vorheriger Stand läuft wieder/);
    assert.ok(fs.existsSync(path.join(env.NF_SRV, 'demo', 'app.fehlgeschlagen')));
    const nachher = await holen(`/api/nf/verwalten?t=${token}`);
    assert.equal(nachher.status, 200, nachher.text);
    assert.ok(nachher.json?.buchung, 'API antwortet wieder mit Daten');
  });

  test('kunde-entfernen.sh: nur mit Bestätigung; löscht Instanz, Block und Backups', async () => {
    const ohneBestaetigung = skript('kunde-entfernen.sh', ['demo-test']);
    assert.notEqual(ohneBestaetigung.status, 0);
    assert.ok(fs.existsSync(path.join(env.NF_SRV, 'demo-test')));

    const port = envWert('demo-test', 'PB_PORT');
    const t = skript('kunde-entfernen.sh', ['demo-test', '--wirklich-loeschen']);
    assert.equal(t.status, 0, t.out);
    assert.doesNotMatch(t.out, /Workflows/, 'Testinstanz hatte keine Automationen');
    assert.ok(!fs.existsSync(path.join(env.NF_SRV, 'demo-test')) && !fs.existsSync(envDatei('demo-test')));
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`));

    const d = skript('kunde-entfernen.sh', ['demo', '--wirklich-loeschen', '--backups-loeschen']);
    assert.equal(d.status, 0, d.out);
    assert.ok(!fs.existsSync(path.join(env.NF_CADDY_DIR, 'demo.caddy')));
    assert.deepEqual(resticJson('snapshots', '--tag', 'instanz:demo'), []);
    await assert.rejects(holen('/'));
  });
});
