// End-to-end mail test with a real n8n (phase 4 acceptance):
// every mail type arrives once in the test mailbox, nothing twice, du/Sie switch works,
// Microsoft 365 adapter (token cached), failures → Telegram without personal data → retry.
//
// Runs only with NF_TEST_N8N_DIR pointing to an n8n installation (node_modules/.bin/n8n,
// incl. a matching Node version there). Otherwise skipped. See README "Tests".

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freierPort, httpAttrappe, n8nVerzeichnis, slot, smtpEmpfaenger, startInstanz, startN8n, testKonfiguration, warteAuf, zeitIntl,
} from './hilfen.mjs';
import { buildCredentials, buildWorkflows } from '../lib/n8n.mjs';

const N8N_DIR = n8nVerzeichnis();
const SECRET = 'test-geheimnis-e2e-1234567890';
const KUNDE = '_beispiel';
const BEISPIEL = testKonfiguration();
const TEST_EMPFAENGER = BEISPIEL.nachrichten.test_empfaenger;
const ABSENDER = BEISPIEL.nachrichten.absender;
const BETRIEB = BEISPIEL.kunde.name;
const re = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let I; let N; let postfach; let graph; let telegram;

const KONTAKT = { vorname: 'Erika', nachname: 'Muster', email: 'erika@example.com', telefon: '0123 456789' };

async function buchen(start, over = {}) {
  const r = await I.api('POST', '/api/nf/buchen', {
    body: { angebot: 'basis', start, kontakt: { ...KONTAKT }, zusatzfelder: { zustand: 'Gut' }, ...over },
  });
  assert.equal(r.status, 201, r.text);
  return r.json;
}

async function nachrichten(filter = 'id != ""') {
  const r = await I.api('GET', `/api/collections/nachrichten/records?perPage=500&filter=${encodeURIComponent(filter)}`, { token: I.adminToken });
  return r.json.items;
}

async function einstellungen(werte) {
  const r = await I.api('GET', '/api/collections/einstellungen/records', { token: I.adminToken });
  const p = await I.api('PATCH', `/api/collections/einstellungen/records/${r.json.items[0].id}`, { body: werte, token: I.adminToken });
  assert.equal(p.status, 200, p.text);
}

function n8nWebhook(pfad, body = {}) {
  return fetch(`${N.base}/webhook/${KUNDE}/${pfad}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NF-Secret': SECRET }, body: JSON.stringify(body),
  });
}

/** Waits until every message is sent (or until a given filter is satisfied). */
async function alleGesendet(anzahl) {
  return warteAuf(async () => {
    const liste = await nachrichten();
    return liste.length >= anzahl && liste.every((n) => n.status === 'gesendet') ? liste : null;
  }, { timeout: 30000, text: `${anzahl} Nachrichten gesendet` });
}

describe('Mails mit echtem n8n', { skip: N8N_DIR ? false : 'NF_TEST_N8N_DIR nicht gesetzt – Mail-Ende-zu-Ende-Test übersprungen.' }, () => {
  before(async () => {
    postfach = await smtpEmpfaenger();
    graph = await httpAttrappe((a) => {
      if (a.pfad.endsWith('/oauth2/v2.0/token')) return { status: 200, json: { access_token: 'token-1', token_type: 'Bearer', expires_in: 3600 } };
      if (a.pfad.endsWith('/sendMail')) return { status: 202 };
      return null;
    });
    telegram = await httpAttrappe(() => ({ status: 200, json: { ok: true, result: { message_id: 1, date: 0, chat: { id: 42, type: 'private' }, text: '' } } }));

    const n8nPort = await freierPort();
    I = await startInstanz({
      env: {
        NF_WEBHOOK_URL: `http://127.0.0.1:${n8nPort}/webhook/${KUNDE}`,
        NF_WEBHOOK_SECRET: SECRET,
        NF_NACHHOLEN_SOFORT: '1',
        NF_OEFFENTLICHE_URL: 'https://buchung.test',
      },
    });
    await I.api('PATCH', '/api/settings', { body: { rateLimits: { enabled: false } }, token: I.adminToken });

    const config = testKonfiguration();
    const workflows = buildWorkflows({ config, pbUrl: I.base, graphApiUrl: graph.url, telegramChatId: '42' });
    const credentials = buildCredentials({
      config,
      env: {
        NF_WEBHOOK_SECRET: SECRET,
        SMTP_HOST: '127.0.0.1', SMTP_PORT: String(postfach.port), SMTP_USER: 'test', SMTP_PASSWORD: 'test', SMTP_SECURE: 'false', SMTP_STARTTLS: 'false',
        GRAPH_TENANT_ID: 'tenant', GRAPH_CLIENT_ID: 'client', GRAPH_CLIENT_SECRET: 'secret', NF_GRAPH_LOGIN_URL: graph.url,
        TELEGRAM_BOT_TOKEN: '123:test', NF_TELEGRAM_API_URL: telegram.url,
      },
    });
    N = await startN8n({ dir: N8N_DIR, port: n8nPort, workflows, credentials, webhookPfad: `${KUNDE}/neue-buchung` });
  });

  after(async () => {
    await N?.stop();
    await I?.stop();
    await postfach?.close();
    await graph?.close();
    await telegram?.close();
  });

  test('jede Mail-Art kommt genau einmal im Test-Postfach an', async () => {
    // booking → confirmation; follow-up → its confirmation; move; status with mail
    const b = await buchen(slot('2030-01-07', '08:00'), { angebot: 'komplett' });
    const f = await I.api('POST', `/api/nf/folgetermin?t=${b.verwalten_token}`, { body: { start: slot('2030-04-01', '14:00') } });
    assert.equal(f.status, 201, f.text);
    assert.equal((await I.api('POST', `/api/nf/verwalten?t=${b.verwalten_token}`, { body: { aktion: 'verschieben', start: slot('2030-01-07', '09:00') } })).status, 200);
    const [rec] = (await I.api('GET', `/api/collections/buchungen/records?filter=${encodeURIComponent(`token_verwalten = "${b.verwalten_token}"`)}`, { token: I.adminToken })).json.items;
    assert.equal((await I.api('PATCH', `/api/collections/buchungen/records/${rec.id}`, { body: { status: 'in_arbeit' }, token: I.adminToken })).status, 200);

    // reminder: appointment tomorrow (created directly), then trigger the daily workflow
    const z = zeitIntl('Europe/Berlin');
    const morgen = new Date(Date.parse(`${z.toLocal(Date.now()).datum}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const startMs = z.toUtcMs(morgen, '10:00');
    const neu = await I.api('POST', '/api/collections/buchungen/records', {
      token: I.adminToken,
      body: { kontakt: rec.kontakt, angebot: rec.angebot, termintyp: 'abgabe', status: 'eingegangen', termin_start: new Date(startMs).toISOString(), termin_ende: new Date(startMs + 1800000).toISOString() },
    });
    assert.equal(neu.status, 200, neu.text);
    assert.equal((await n8nWebhook('erinnerungen-jetzt')).status, 200);

    // cancel → cancellation for the booking and its follow-up
    assert.equal((await I.api('POST', `/api/nf/verwalten?t=${b.verwalten_token}`, { body: { aktion: 'absagen' } })).status, 200);

    const gesendet = await alleGesendet(7);
    const proArt = {};
    for (const n of gesendet) proArt[n.art] = (proArt[n.art] || 0) + 1;
    assert.deepEqual(proArt, { bestaetigung: 1, folgetermin: 1, verschoben: 1, status: 1, erinnerung: 1, abgesagt: 2 });

    await warteAuf(() => postfach.mails.length >= gesendet.length, { text: 'Mails im Postfach' });
    assert.equal(postfach.mails.length, gesendet.length, 'eine Mail je Nachricht');
    for (const m of postfach.mails) {
      assert.deepEqual(m.an, [TEST_EMPFAENGER], 'Testmodus: alles an den Test-Empfänger');
      assert.match(m.betreff, /^\[TEST → erika@example\.com\] /);
      assert.match(m.header.from, new RegExp(`${re(ABSENDER.name)}.*<${re(ABSENDER.email)}>`), 'Absender des Kunden');
    }
    const betreffs = postfach.mails.map((m) => m.betreff.replace(/^\[TEST → [^\]]+\] /, '')).sort();
    assert.deepEqual(betreffs, [
      'Erinnerung: Termin morgen',
      'Folgetermin bestätigt: Montag, 1. April 2030, 14:00 Uhr',
      'Neuigkeiten zu Ihrem Termin: In Arbeit',
      'Termin abgesagt: Montag, 1. April 2030, 14:00 Uhr',
      'Termin abgesagt: Montag, 7. Januar 2030, 09:00 Uhr',
      'Termin verschoben: Montag, 7. Januar 2030, 09:00 Uhr',
      'Terminbestätigung: Montag, 7. Januar 2030, 08:00 Uhr',
    ]);
    // status log knows the mail went out
    const log = (await I.api('GET', `/api/collections/status_log/records?filter=${encodeURIComponent(`buchung = "${rec.id}"`)}`, { token: I.adminToken })).json.items;
    assert.equal(log[0].mail_gesendet, true);
  });

  test('nichts doppelt: erneute Webhooks, Erinnerungs- und Nachhol-Läufe verschicken nichts', async () => {
    const vorher = postfach.mails.length;
    const [bestaetigung] = await nachrichten('art = "bestaetigung"');
    assert.equal((await n8nWebhook('neue-buchung', { art: 'bestaetigung', kunde: KUNDE, schluessel: bestaetigung.schluessel })).status, 200);
    assert.equal((await n8nWebhook('erinnerungen-jetzt')).status, 200);
    assert.equal((await n8nWebhook('nachholen-jetzt')).status, 200);
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(postfach.mails.length, vorher);
  });

  test('du/Sie-Umschaltung wirkt in der Mail', async () => {
    await einstellungen({ ansprache: 'du' });
    try {
      const vorher = postfach.mails.length;
      await buchen(slot('2030-01-08', '08:00'), { kontakt: { ...KONTAKT, email: 'du@example.com' } });
      await warteAuf(() => postfach.mails.length > vorher, { text: 'du-Mail' });
      const m = postfach.mails.at(-1);
      assert.match(m.inhalt, /Hallo Erika,/);
      assert.match(m.inhalt, /vielen Dank für deine Buchung/);
      assert.match(m.inhalt, new RegExp(`Dein Team vom ${re(BETRIEB)}`));
    } finally {
      await einstellungen({ ansprache: 'sie' });
    }
    const vorher = postfach.mails.length;
    await buchen(slot('2030-01-08', '08:30'), { kontakt: { ...KONTAKT, email: 'sie@example.com', anrede: 'Frau' } });
    await warteAuf(() => postfach.mails.length > vorher, { text: 'Sie-Mail' });
    assert.match(postfach.mails.at(-1).inhalt, /Guten Tag Frau Muster,/);
  });

  test('Microsoft 365: Versand über Graph, Token wird zwischengespeichert', async () => {
    await einstellungen({ mail_adapter: 'graph' });
    try {
      // second mail only after the first one is out: then the cached token must be reused
      // (two mails at the very same moment may both fetch a token – harmless, see E-008)
      await buchen(slot('2030-01-08', '09:00'), { kontakt: { ...KONTAKT, email: 'graph1@example.com' } });
      await warteAuf(() => graph.aufrufe.some((a) => a.pfad.endsWith('/sendMail')), { text: 'erste Graph-Mail' });
      await buchen(slot('2030-01-08', '09:30'), { kontakt: { ...KONTAKT, email: 'graph2@example.com' } });
      const sends = await warteAuf(() => {
        const s = graph.aufrufe.filter((a) => a.pfad.endsWith('/sendMail'));
        return s.length >= 2 ? s : null;
      }, { text: 'Graph sendMail' });
      assert.equal(graph.aufrufe.filter((a) => a.pfad.endsWith('/token')).length, 1, 'Token nur einmal geholt');
      assert.equal(sends[0].pfad, `/v1.0/users/${encodeURIComponent(ABSENDER.email)}/sendMail`);
      assert.equal(sends[0].header.authorization, 'Bearer token-1');
      const body = JSON.parse(sends[0].body);
      assert.equal(body.message.toRecipients[0].emailAddress.address, TEST_EMPFAENGER);
      assert.match(body.message.subject, /^\[TEST → graph1@example\.com\] Terminbestätigung/);
      assert.equal(body.message.body.contentType, 'HTML');
      const n = await warteAuf(async () => {
        const liste = await nachrichten('empfaenger = "graph2@example.com"');
        return liste[0] && liste[0].status === 'gesendet' ? liste[0] : null;
      }, { text: 'Graph-Ergebnis' });
      assert.equal(n.ergebnis, 'gesendet graph');
    } finally {
      await einstellungen({ mail_adapter: 'smtp' });
    }
  });

  test('Anmeldecode für die Übersicht kommt an – an die echte Adresse, auch im Testmodus', async () => {
    const neu = await I.api('POST', '/api/collections/users/records', {
      token: I.adminToken, body: { email: 'chefin@example.com', password: 'passwort-123', passwordConfirm: 'passwort-123', rolle: 'inhaber', name: 'Chefin' },
    });
    assert.equal(neu.status, 200, neu.text);
    const vorher = postfach.mails.length;
    const pw = await I.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'chefin@example.com', password: 'passwort-123' } });
    const otp = await I.api('POST', '/api/collections/users/request-otp', { body: { email: 'chefin@example.com' } });
    await warteAuf(() => postfach.mails.length > vorher, { text: 'Anmeldecode-Mail' });
    const m = postfach.mails.at(-1);
    assert.deepEqual(m.an, ['chefin@example.com']);
    const code = m.betreff.match(/^Ihr Anmeldecode: (\d{6})$/)[1];
    const login = await I.api('POST', '/api/collections/users/auth-with-otp', { body: { otpId: otp.json.otpId, password: code, mfaId: pw.json.mfaId } });
    assert.equal(login.status, 200, 'mit dem Code aus der Mail anmelden');
    const n = await warteAuf(async () => {
      const [x] = await nachrichten(`schluessel = "anmeldecode:${otp.json.otpId}"`);
      return x && x.status === 'gesendet' ? x : null;
    }, { text: 'Anmeldecode gesendet' });
    assert.equal(n.text, '', 'Code wird nach dem Versand nicht aufbewahrt');
    assert.doesNotMatch(n.betreff, /\d{6}/);
  });

  test('Fehler: Telegram ohne personenbezogene Daten, danach automatisch nachgeholt', async () => {
    postfach.zustand.ablehnen = true;
    const vorher = postfach.mails.length;
    await buchen(slot('2030-01-08', '10:00'), { kontakt: { ...KONTAKT, email: 'stoerung@example.com' } });
    const [n] = await warteAuf(async () => {
      const liste = await nachrichten('empfaenger = "stoerung@example.com"');
      return liste[0] && liste[0].status === 'fehler' ? liste : null;
    }, { text: 'Status fehler' });
    assert.match(n.ergebnis, /^fehler: /);

    const nachricht = await warteAuf(() => telegram.aufrufe.find((a) => a.pfad.endsWith('/sendMessage')), { text: 'Telegram' });
    const text = JSON.parse(nachricht.body).text;
    assert.match(text, /Mailversand fehlgeschlagen/);
    assert.match(text, /Kunde: _beispiel/);
    assert.doesNotMatch(text, /@|Erika|Muster|stoerung/, 'keine personenbezogenen Daten');

    postfach.zustand.ablehnen = false;
    assert.equal((await n8nWebhook('nachholen-jetzt')).status, 200);
    await warteAuf(async () => (await nachrichten('empfaenger = "stoerung@example.com"'))[0].status === 'gesendet', { text: 'nachgeholt' });
    assert.equal(postfach.mails.length, vorher + 1);
  });
});
