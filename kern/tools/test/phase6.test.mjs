// Phase 6 via API: import, campaign in stages, unsubscribed get nothing, follow-up reminders,
// follow-up invitations only for eligible bookings, deletion after (shortened) periods.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { slot, startInstanz, testKonfiguration, zeitIntl } from './hilfen.mjs';

const BEISPIEL = testKonfiguration();
const INHABER = { email: 'inhaber@test.example', passwort: 'inhaber-pw-123' };
const MITARBEITER = { email: 'ma@test.example', passwort: 'mitarbeiter-pw-1' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let I;
let inhaber;
let mitarbeiter;

const zehn = Array.from({ length: 10 }, (_, i) => ({
  nr: i + 2,
  vorname: `Vorname${i}`,
  nachname: `Kunde${i}`,
  email: `kunde${i}@example.com`,
  telefon: '0123 4567',
  strasse: `Weg ${i}`,
  plz: String(10000 + i),
  ort: 'Ort',
  zusatzfelder: { geraet: `Modell ${i}` },
  einwilligung_email: i < 7,
  einwilligung_datum: i === 0 ? '01.03.2025' : '',
}));

async function admin(collection, filter, sort = '-created') {
  const r = await I.api('GET', `/api/collections/${collection}/records?perPage=500&sort=${sort}&filter=${encodeURIComponent(filter)}`, { token: I.adminToken });
  return r.json.items;
}

function intern(pfad, methode = 'POST', body) {
  return fetch(`${I.base}/api/nf-intern/${pfad}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', 'X-NF-Secret': I.env.NF_WEBHOOK_SECRET },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
}

/** Simulates "Mail senden" for the given keys: lock, (send), report success. */
async function senden(schluesselListe) {
  const mails = [];
  for (const s of schluesselListe) {
    const start = await intern('versand/start', 'POST', { schluessel: s });
    if (!start.json.senden) continue;
    mails.push(start.json);
    await intern('versand/ergebnis', 'POST', { schluessel: s, ok: true, adapter: 'smtp' });
  }
  return mails;
}

async function einstellungen(werte) {
  const [e] = await admin('einstellungen', 'id != ""');
  const r = await I.api('PATCH', `/api/collections/einstellungen/records/${e.id}`, { body: werte, token: I.adminToken });
  assert.equal(r.status, 200, r.text);
}

async function buchen(start, email, over = {}) {
  const r = await I.api('POST', '/api/nf/buchen', {
    body: { angebot: 'basis', start, kontakt: { vorname: 'B', nachname: 'Bucher', email, telefon: '0123 4567' }, zusatzfelder: { zustand: 'Gut' }, ...over },
  });
  assert.equal(r.status, 201, r.text);
  const [b] = await admin('buchungen', `token_verwalten = "${r.json.verwalten_token}"`);
  return { ...r.json, id: b.id, kontakt: b.kontakt };
}

before(async () => {
  I = await startInstanz({
    env: { NF_NACHHOLEN_SOFORT: '1', NF_OEFFENTLICHE_URL: 'https://buchung.test' },
    mutate: (c) => {
      c.nachrichten.kampagne = { etappe_groesse: 4, etappe_abstand_minuten: 30, versandfenster: { von: '00:00', bis: '23:59' } };
      c.nachrichten.nachfass = { abstaende_tage: [1, 2] };
      c.kunde.loeschfristen = { fotos_monate_nach_abschluss: 1, buchungen_monate_nach_abschluss: 2 };
    },
  });
  await I.api('PATCH', '/api/settings', { body: { rateLimits: { enabled: false } }, token: I.adminToken });
  for (const [wer, rolle] of [[INHABER, 'inhaber'], [MITARBEITER, 'mitarbeiter']]) {
    const r = await I.api('POST', '/api/collections/users/records', { token: I.adminToken, body: { email: wer.email, password: wer.passwort, passwordConfirm: wer.passwort, rolle, name: rolle } });
    assert.equal(r.status, 200, r.text);
  }
  inhaber = await I.teamLogin(INHABER.email, INHABER.passwort);
  mitarbeiter = await I.teamLogin(MITARBEITER.email, MITARBEITER.passwort);
});

after(async () => {
  if (I) await I.stop();
});

describe('Import', () => {
  test('nur Inhaber', async () => {
    const r = await I.api('POST', '/api/nf-team/import', { body: { zeilen: zehn }, token: mitarbeiter });
    assert.equal(r.status, 403);
    assert.equal((await I.api('POST', '/api/nf-team/import', { body: { zeilen: zehn } })).status, 401);
  });

  test('10 Kontakte, Einwilligung mit Quelle „import“ und Datum; Fehlerhaftes wird gemeldet', async () => {
    const zeilen = [...zehn, { nr: 12, vorname: 'Kaputt', email: 'keine-adresse' }, { nr: 13, vorname: 'Doppelt', email: 'KUNDE1@example.com' }];
    const r = await I.api('POST', '/api/nf-team/import', { body: { zeilen }, token: inhaber });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.neu, 10);
    assert.deepEqual(r.json.uebersprungen, [{ zeile: 12, grund: 'ungültige E-Mail-Adresse' }, { zeile: 13, grund: 'E-Mail doppelt in der Datei' }]);

    const kontakte = await admin('kontakte', 'email ~ "kunde"', 'email');
    assert.equal(kontakte.length, 10);
    const mit = kontakte.filter((k) => k.einwilligung_email);
    assert.equal(mit.length, 7);
    assert.ok(mit.every((k) => k.einwilligung_email_quelle === 'import'));
    assert.match(kontakte[0].einwilligung_email_am, /^2025-03-01/, 'Datum aus der Datei');
    assert.equal(kontakte[0].zusatzfelder.geraet, 'Modell 0');
    assert.ok(kontakte.every((k) => k.token && k.token.length === 40), 'jeder Kontakt bekommt einen Token für den Buchungslink');
  });

  test('erneuter Import ergänzt nur und hebt keine Abmeldung auf', async () => {
    const [k9] = await admin('kontakte', 'email = "kunde9@example.com"');
    await I.api('PATCH', `/api/collections/kontakte/records/${k9.id}`, { body: { abgemeldet: true }, token: I.adminToken });
    const r = await I.api('POST', '/api/nf-team/import', {
      token: inhaber,
      body: { zeilen: [{ nr: 2, vorname: 'Neu', email: 'kunde0@example.com', ort: 'Anders' }, { nr: 3, email: 'kunde9@example.com', einwilligung_email: true }] },
    });
    assert.deepEqual([r.json.neu, r.json.ergaenzt], [0, 2]);
    const [k0] = await admin('kontakte', 'email = "kunde0@example.com"');
    assert.equal(k0.vorname, 'Vorname0', 'vorhandene Werte bleiben');
    const [k9neu] = await admin('kontakte', 'email = "kunde9@example.com"');
    assert.equal(k9neu.einwilligung_email, false, 'Abmeldung bleibt bestehen');
  });
});

describe('Kampagne in Etappen', () => {
  let schluessel = [];

  test('Start: nur Kontakte mit Einwilligung, nicht abgemeldet, noch nicht gebucht', async () => {
    await buchen(slot('2030-01-07', '08:00'), 'kunde1@example.com'); // already booked
    const [k2] = await admin('kontakte', 'email = "kunde2@example.com"');
    await I.api('GET', `/api/nf/abmelden?t=${k2.token}`);
    assert.equal((await I.api('POST', `/api/nf/abmelden?t=${k2.token}`)).status, 200); // unsubscribed

    const stand = await I.api('GET', '/api/nf-team/kampagne/stand', { token: inhaber });
    assert.equal(stand.json.empfaenger_moeglich, 5); // 7 with consent − booked − unsubscribed
    assert.equal((await I.api('GET', '/api/nf-team/kampagne/stand', { token: mitarbeiter })).status, 403);

    const start = await I.api('POST', '/api/nf-team/kampagne/start', { token: inhaber });
    assert.equal(start.json.geplant, 5);
    const nochmal = await I.api('POST', '/api/nf-team/kampagne/start', { token: inhaber });
    assert.equal(nochmal.json.geplant, 0, 'am selben Tag nicht doppelt');
  });

  test('Etappen à 4; wer sich zwischendurch abmeldet, bekommt nichts', async () => {
    const [k3] = await admin('kontakte', 'email = "kunde3@example.com"');
    await I.api('POST', `/api/nf/abmelden?t=${k3.token}`);

    const e1 = await intern('etappe');
    const e2 = await intern('etappe');
    const e3 = await intern('etappe');
    schluessel = [...e1.json.schluessel, ...e2.json.schluessel];
    assert.ok(e1.json.schluessel.length <= 4);
    assert.equal(schluessel.length, 4, 'von 5 geplanten ist eine übersprungen');
    assert.deepEqual(e3.json.schluessel, []);
    const [n3] = await admin('nachrichten', `kontakt = "${k3.id}" && art = "kampagne"`);
    assert.equal(n3.status, 'uebersprungen');

    const mails = await senden(schluessel);
    assert.equal(mails.length, 4);
    for (const m of mails) {
      assert.equal(m.empfaenger, BEISPIEL.nachrichten.test_empfaenger, 'Testmodus');
      assert.match(m.betreff, /^\[TEST → kunde\d@example\.com\] /);
      assert.match(m.text, /https:\/\/buchung\.test\/\?t=[A-Za-z0-9]{40}/, 'persönlicher Buchungslink');
      assert.match(m.text, /Abmelden: https:\/\/buchung\.test\/abmelden\/\?t=[A-Za-z0-9]{40}/, 'Abmeldelink');
      assert.match(m.html, /Hier abmelden<\/a>/);
    }
    const versendet = await admin('kontakte', 'kampagne_am != ""');
    assert.equal(versendet.length, 4);
  });

  test('Abmeldung nach der Freigabe: Versand wird beim Abholen übersprungen', async () => {
    // kunde4 books via the personal link from the campaign mail → no follow-ups from now on
    const [k4] = await admin('kontakte', 'email = "kunde4@example.com"');
    await buchen(slot('2030-01-07', '09:00'), 'kunde4@example.com', { t: k4.token });

    const [k] = await admin('kontakte', 'email = "kunde6@example.com"');
    const geplant = await intern('nachfass');
    assert.equal(geplant.json.geplant, 3, 'Nachfass 1 für kunde0, kunde5, kunde6');
    const e = await intern('etappe');
    const s = e.json.schluessel.find((x) => x.includes(k.id));
    assert.ok(s, 'Nachfass für kunde6 freigegeben');
    await I.api('POST', `/api/nf/abmelden?t=${k.token}`);
    const start = await intern('versand/start', 'POST', { schluessel: s });
    assert.equal(start.json.senden, false);
    const [n] = await admin('nachrichten', `schluessel = "${s}"`);
    assert.equal(n.status, 'uebersprungen');
    // remaining released follow-ups of this stage are sent normally
    await senden(e.json.schluessel.filter((x) => x !== s));
  });

  test('Nachfass: bis zu 2 Mails an Nicht-Bucher, wer bucht, bekommt keine mehr', async () => {
    for (let runde = 1; runde <= 3; runde++) {
      await intern('nachfass');
      const e = await intern('etappe');
      await senden(e.json.schluessel);
    }
    const kontakte = await admin('kontakte', 'kampagne_am != ""', 'email');
    const nachName = Object.fromEntries(kontakte.map((k) => [k.email, k]));
    assert.equal(nachName['kunde4@example.com'].nachfass_1_am, '', 'gebucht → kein Nachfass');
    assert.equal(nachName['kunde6@example.com'].nachfass_1_am, '', 'abgemeldet → kein Nachfass');
    const rest = ['kunde0@example.com', 'kunde5@example.com'].map((e) => nachName[e]);
    for (const k of rest) {
      assert.notEqual(k.nachfass_1_am, '', `${k.email}: Nachfass 1`);
      assert.notEqual(k.nachfass_2_am, '', `${k.email}: Nachfass 2`);
      assert.equal(k.nachfass_3_am, '', 'höchstens 2');
    }
    assert.deepEqual((await intern('nachfass')).json, { geplant: 0 });
  });
});

describe('Folgetermin-Einladung', () => {
  test('nur berechtigte Buchungen ohne Folgetermin, einmal, nur im Zeitraum', async () => {
    const komplett = await buchen(slot('2030-01-08', '08:00'), 'f1@example.com', { angebot: 'komplett' });
    const basis = await buchen(slot('2030-01-08', '08:30'), 'f2@example.com');
    const mitKind = await buchen(slot('2030-01-08', '09:00'), 'f3@example.com', { angebot: 'komplett' });
    assert.equal((await I.api('POST', `/api/nf/folgetermin?t=${mitKind.verwalten_token}`, { body: { start: slot('2030-04-01', '14:00') } })).status, 201);

    const z = zeitIntl('Europe/Berlin');
    const heute = z.toLocal(Date.now()).datum;
    const plus = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    await einstellungen({ folgetermin_ab: plus(heute, 1), folgetermin_bis: plus(heute, 30) });
    assert.equal((await intern('folgetermin-einladungen')).json.geplant, 0, 'vor dem Zeitraum');

    await einstellungen({ folgetermin_ab: plus(heute, -1), folgetermin_bis: plus(heute, 30) });
    assert.equal((await intern('folgetermin-einladungen')).json.geplant, 1);
    assert.equal((await intern('folgetermin-einladungen')).json.geplant, 0, 'nicht doppelt');
    const einladungen = await admin('nachrichten', 'art = "folgetermin_einladung"');
    assert.deepEqual(einladungen.map((n) => n.buchung), [komplett.id]);
    assert.ok(!einladungen.some((n) => n.buchung === basis.id || n.buchung === mitKind.id));
    assert.match(einladungen[0].text, new RegExp(`Folgetermin buchen:\\nhttps://buchung\\.test/verwalten/\\?t=${komplett.verwalten_token}`));
  });
});

describe('Löschung nach Frist (verkürzt: Fotos 1 Monat, Buchungen 2 Monate)', () => {
  test('Fotos und alte Buchungen werden gelöscht, Offenes bleibt', async () => {
    await einstellungen({ folgetermin_ab: '2030-04-01', folgetermin_bis: '2030-05-31' }); // previous test moved it
    const vorTagen = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const mitFoto = async (start, email) => {
      const f = new FormData();
      f.set('daten', JSON.stringify({ angebot: 'basis', start, kontakt: { vorname: 'L', nachname: 'Lösch', email, telefon: '0123 4567' }, zusatzfelder: { zustand: 'Gut' } }));
      f.append('fotos', new Blob([PNG]), 'foto.png');
      const r = await I.api('POST', '/api/nf/buchen', { form: f });
      const [b] = await admin('buchungen', `token_verwalten = "${r.json.verwalten_token}"`);
      return b;
    };
    const setzen = (id, werte) => I.api('PATCH', `/api/collections/buchungen/records/${id}`, { body: werte, token: I.adminToken });

    const a = await mitFoto(slot('2030-01-10', '08:00'), 'loesch-a@example.com'); // finished 45 days ago
    await setzen(a.id, { abgeschlossen_am: vorTagen(45) });
    const b = await mitFoto(slot('2030-01-10', '08:30'), 'loesch-b@example.com'); // finished 90 days ago, no consent
    await setzen(b.id, { abgeschlossen_am: vorTagen(90) });
    const c = await buchen(slot('2030-01-10', '09:00'), 'loesch-c@example.com'); // cancelled 90 days ago, unsubscribed
    await setzen(c.id, { abgesagt_am: vorTagen(90) });
    await I.api('PATCH', `/api/collections/kontakte/records/${c.kontakt}`, { body: { abgemeldet: true }, token: I.adminToken });
    const d = await buchen(slot('2030-01-10', '09:30'), 'loesch-d@example.com', { angebot: 'komplett' }); // old parent, open child
    const kind = await I.api('POST', `/api/nf/folgetermin?t=${d.verwalten_token}`, { body: { start: slot('2030-04-02', '14:00') } });
    assert.equal(kind.status, 201, kind.text);
    await setzen(d.id, { abgeschlossen_am: vorTagen(90) });
    const e = await mitFoto(slot('2030-01-10', '10:00'), 'loesch-e@example.com'); // still open

    const r = await intern('loeschung');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { fotos: 2, buchungen: 2, kontakte_geloescht: 1, kontakte_reduziert: 1 });

    const da = await admin('buchungen', `id = "${a.id}"`);
    assert.equal(da.length, 1, 'A bleibt (erst 45 Tage)');
    assert.deepEqual(da[0].fotos, [], 'Fotos von A gelöscht');
    assert.equal((await admin('buchungen', `id = "${b.id}"`)).length, 0, 'B gelöscht');
    assert.equal((await admin('kontakte', `id = "${b.kontakt}"`)).length, 0, 'Kontakt B ohne Einwilligung gelöscht');
    assert.equal((await admin('buchungen', `id = "${c.id}"`)).length, 0, 'C (abgesagt) gelöscht');
    const [kc] = await admin('kontakte', `id = "${c.kontakt}"`);
    assert.deepEqual([kc.email, kc.vorname, kc.telefon, kc.abgemeldet], ['loesch-c@example.com', '', '', true], 'abgemeldet: nur E-Mail bleibt als Sperre');
    assert.equal((await admin('buchungen', `id = "${d.id}"`)).length, 1, 'D bleibt wegen offenem Folgetermin');
    const [de] = await admin('buchungen', `id = "${e.id}"`);
    assert.equal(de.fotos.length, 1, 'offene Buchung unberührt');

    assert.deepEqual((await intern('loeschung')).json, { fotos: 0, buchungen: 0, kontakte_geloescht: 0, kontakte_reduziert: 0 });
  });
});
