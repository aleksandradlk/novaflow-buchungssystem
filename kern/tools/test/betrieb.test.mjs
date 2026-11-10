// Phase 7 (operation) – parts that run without a server:
//  – admin access (superuser) only with two factors: password + one-time code by mail
//  – deploy/ files: shell syntax, site block rules, units, no secrets in templates
// The full rehearsal with web server, backups and restore is deploy.test.mjs (opt-in).

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../lib/paths.mjs';
import { startInstanz, warteAuf } from './hilfen.mjs';

const DEPLOY = path.join(ROOT, 'deploy');

let sqlite = null;
try {
  sqlite = await import('node:sqlite');
} catch {
  // Node without built-in SQLite: the 2FA test is skipped (the code is read from the database)
}

describe('Admin-Zugang mit Zwei-Faktor', { skip: sqlite ? false : 'node:sqlite nicht verfügbar' }, () => {
  let I;
  before(async () => {
    I = await startInstanz({ env: { NF_SUPERUSER_2FA: '1' } });
  });
  after(() => I?.stop());

  function codeAusPostausgang(otpId) {
    const db = new sqlite.DatabaseSync(path.join(I.dataDir, 'data.db'), { readOnly: true });
    try {
      const n = db.prepare('SELECT text FROM nachrichten WHERE schluessel = ?').get(`anmeldecode:${otpId}`);
      return n ? n.text.match(/\b(\d{6})\b/)[1] : null;
    } finally {
      db.close();
    }
  }

  test('Passwort allein reicht nicht; mit Code per Mail klappt die Anmeldung', async () => {
    const { email, password } = I.admin;
    const pw = await I.api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: email, password } });
    assert.equal(pw.status, 401, pw.text);
    assert.ok(pw.json.mfaId, pw.text);
    assert.ok(!pw.json.token);

    const otp = await I.api('POST', '/api/collections/_superusers/request-otp', { body: { email } });
    assert.equal(otp.status, 200, otp.text);
    const code = await warteAuf(() => codeAusPostausgang(otp.json.otpId), { timeout: 5000, schritt: 50, text: 'Admin-Code' });

    const falsch = await I.api('POST', '/api/collections/_superusers/auth-with-otp', {
      body: { otpId: otp.json.otpId, password: code === '000000' ? '111111' : '000000', mfaId: pw.json.mfaId },
    });
    assert.notEqual(falsch.status, 200);

    const ok = await I.api('POST', '/api/collections/_superusers/auth-with-otp', { body: { otpId: otp.json.otpId, password: code, mfaId: pw.json.mfaId } });
    assert.equal(ok.status, 200, ok.text);
    assert.ok(ok.json.token);
    const settings = await I.api('GET', '/api/settings', { token: ok.json.token });
    assert.equal(settings.status, 200);
  });
});

describe('deploy/: Skripte und Vorlagen', () => {
  const skripte = fs.readdirSync(DEPLOY).filter((f) => f.endsWith('.sh'));

  test('alle Skripte sind syntaktisch korrekt und ausführbar', () => {
    assert.ok(skripte.length >= 9, skripte.join(', '));
    for (const f of skripte) {
      const r = spawnSync('bash', ['-n', path.join(DEPLOY, f)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${f}: ${r.stderr}`);
      if (f !== 'lib.sh' && f !== 'versionen.sh') {
        assert.ok(fs.statSync(path.join(DEPLOY, f)).mode & 0o100, `${f} ist nicht ausführbar`);
      }
    }
  });

  test('Webserver-Vorlage: Admin gesperrt, kein Server-Header, Sicherheits-Header ohne fremde Quellen', () => {
    const v = fs.readFileSync(path.join(DEPLOY, 'caddy', 'kunde.caddy.vorlage'), 'utf8');
    const gesperrt = v.match(/@gesperrt path (.+)/)[1].split(/\s+/);
    for (const p of ['/_', '/_/*', '/api/nf-intern/*', '/api/collections/_superusers/*', '/api/settings', '/api/backups/*']) {
      assert.ok(gesperrt.includes(p), `${p} nicht gesperrt`);
    }
    assert.equal((v.match(/-Server/g) || []).length, 3, 'Server-Header in beiden Blöcken und vom Backend entfernen');
    const csp = v.match(/Content-Security-Policy "([^"]+)"/)[1];
    assert.match(csp, /default-src 'self'/);
    assert.doesNotMatch(csp, /https?:|\*|unsafe-inline|unsafe-eval/);
    assert.match(v, /Strict-Transport-Security/);
    assert.match(v, /X-Content-Type-Options "nosniff"/);
    assert.match(v, /Referrer-Policy "no-referrer"/);
    assert.match(v, /http:\/\/__DOMAIN__ \{/, 'eigene Umleitung http → https (ohne Server-Header)');
  });

  test('Vorlagen enthalten keine Secrets', () => {
    for (const f of ['.env.example', 'deploy/betrieb.env.example']) {
      for (const zeile of fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')) {
        const m = zeile.match(/^([A-Z_0-9]*(SECRET|PASSWORD|TOKEN|PASSWORT)[A-Z_0-9]*)=(.*)$/);
        if (m && !m[1].endsWith('_FILE')) assert.equal(m[3], '', `${f}: ${m[1]} hat einen Wert`);
      }
    }
  });

  test('systemd-Einheiten: Instanz nur auf eigene Daten, Umgebung aus /etc/novaflow', () => {
    const unit = fs.readFileSync(path.join(DEPLOY, 'systemd', 'novaflow@.service'), 'utf8');
    assert.match(unit, /^User=novaflow$/m);
    assert.match(unit, /^EnvironmentFile=\/etc\/novaflow\/%i\.env$/m);
    assert.match(unit, /^ProtectSystem=strict$/m);
    assert.match(unit, /^ReadWritePaths=\/srv\/novaflow\/%i\/pb_data$/m);
    assert.match(unit, /^NoNewPrivileges=yes$/m);
    assert.match(fs.readFileSync(path.join(DEPLOY, 'starten.sh'), 'utf8'), /--http="127\.0\.0\.1:\$PB_PORT"/);

    const verify = spawnSync('systemd-analyze', ['--version'], { encoding: 'utf8' });
    if (verify.status !== 0) return; // not available (e.g. macOS)
    const tmp = fs.mkdtempSync(path.join(ROOT, '.dev', 'units-'));
    try {
      for (const f of fs.readdirSync(path.join(DEPLOY, 'systemd'))) {
        fs.copyFileSync(path.join(DEPLOY, 'systemd', f), path.join(tmp, f.replace('@.', '@probe.')));
      }
      const r = spawnSync('systemd-analyze', ['verify', ...fs.readdirSync(tmp).map((f) => path.join(tmp, f))], { encoding: 'utf8' });
      // only complaint allowed here: the server paths do not exist on this machine
      const meldungen = (r.stderr + r.stdout).split('\n').filter((z) => z.trim() && !/is not executable: No such file or directory/.test(z));
      assert.deepEqual(meldungen, []);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
