// Integration tests against a real instance (migrations + hooks + start values).
// Phase 2 acceptance: slot calculation (blocked day, full week, full slot, full resource)
// and concurrent bookings for the last place → exactly one succeeds.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { slot, startInstanz } from './hilfen.mjs';

let I;
let einstellungenId;

const KONTAKT = { vorname: 'Erika', nachname: 'Muster', email: 'erika@example.com', telefon: '0123 456789' };
const ZUSATZ = { zustand: 'Gut' };

function buchung(start, over = {}) {
  return { angebot: 'basis', start, kontakt: { ...KONTAKT }, zusatzfelder: { ...ZUSATZ }, ...over };
}

async function buchen(start, over = {}) {
  return I.api('POST', '/api/nf/buchen', { body: buchung(start, over) });
}

async function freiAm(datum, uhrzeit, { typ = 'abgabe', angebot } = {}) {
  const q = `typ=${typ}&von=${datum}&bis=${datum}${angebot ? `&angebot=${angebot}` : ''}`;
  const r = await I.api('GET', `/api/nf/slots?${q}`);
  assert.equal(r.status, 200, r.text);
  const s = r.json.slots.find((x) => x.zeit === uhrzeit);
  return s ? s.frei : null;
}

async function einstellungenSetzen(werte) {
  const r = await I.api('PATCH', `/api/collections/einstellungen/records/${einstellungenId}`, { body: werte, token: I.adminToken });
  assert.equal(r.status, 200, r.text);
}

async function adminHole(collection, filter) {
  const r = await I.api('GET', `/api/collections/${collection}/records?perPage=200&filter=${encodeURIComponent(filter)}`, { token: I.adminToken });
  assert.equal(r.status, 200, r.text);
  return r.json.items;
}

before(async () => {
  I = await startInstanz();
  const r = await I.api('GET', '/api/collections/einstellungen/records', { token: I.adminToken });
  einstellungenId = r.json.items[0].id;
  // Rate limits are tested separately at the end.
  const s = await I.api('PATCH', '/api/settings', { body: { rateLimits: { enabled: false } }, token: I.adminToken });
  assert.equal(s.status, 200, s.text);
});

after(async () => {
  if (I) await I.stop();
});

describe('GET /api/nf/angebot', () => {
  test('liefert aktive Angebote, Texte in der eingestellten Ansprache, keine Tokens', async () => {
    const r = await I.api('GET', '/api/nf/angebot');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.angebote.map((a) => a.code), ['basis', 'komplett']);
    assert.equal(r.json.ansprache, 'sie');
    assert.match(r.json.texte.einleitung, /Wählen Sie/);
    assert.equal(r.json.einwilligungen.length, 1);
    assert.equal(r.json.kontakt, null);
    assert.doesNotMatch(r.text, /token/i);
  });
});

describe('GET /api/nf/slots', () => {
  test('Montag: 8 Slots 08:00–11:30 mit je 2 Plätzen, Ortszeit Berlin', async () => {
    const r = await I.api('GET', '/api/nf/slots?typ=abgabe&von=2030-01-07&bis=2030-01-07');
    assert.equal(r.json.slots.length, 8);
    assert.equal(r.json.slots[0].start, '2030-01-07T07:00:00.000Z');
    assert.equal(r.json.slots.at(-1).zeit, '11:30');
    assert.ok(r.json.slots.every((s) => s.frei === 2));
  });

  test('Samstag eigene Regel, Sonntag keine Slots', async () => {
    const r = await I.api('GET', '/api/nf/slots?typ=abgabe&von=2030-01-12&bis=2030-01-13');
    assert.deepEqual([...new Set(r.json.slots.map((s) => s.datum))], ['2030-01-12']);
    assert.ok(r.json.slots.every((s) => s.frei === 1));
  });

  test('Sperrtag: keine Slots, Tag wird gemeldet', async () => {
    const r = await I.api('GET', '/api/nf/slots?typ=abgabe&von=2030-01-09&bis=2030-01-09');
    assert.equal(r.json.slots.length, 0);
    assert.deepEqual(r.json.sperrtage, ['2030-01-09']);
  });

  test('ungültige Abfrage: deutsche Feldmeldungen', async () => {
    const r = await I.api('GET', '/api/nf/slots?typ=gibtsnicht&von=2030-1-1&bis=2030-12-31');
    assert.equal(r.status, 400);
    assert.equal(r.json.message, 'Bitte die markierten Angaben prüfen.');
    assert.ok(r.json.data.typ && r.json.data.von);
  });

  test('zu langer Zeitraum wird abgelehnt', async () => {
    const r = await I.api('GET', '/api/nf/slots?typ=abgabe&von=2030-01-07&bis=2030-06-30');
    assert.equal(r.status, 400);
    assert.match(r.json.data.bis.message, /höchstens 62 Tage/);
  });
});

describe('POST /api/nf/buchen', () => {
  test('Pflichtfelder fehlen → 400 mit deutschen Feldmeldungen', async () => {
    const r = await I.api('POST', '/api/nf/buchen', { body: { angebot: 'basis', start: slot('2030-01-07', '08:00'), kontakt: {} } });
    assert.equal(r.status, 400);
    for (const f of ['kontakt.vorname', 'kontakt.nachname', 'kontakt.email', 'kontakt.telefon', 'zusatzfelder.zustand']) {
      assert.ok(r.json.data[f], `Feld ${f} fehlt in ${r.text}`);
    }
  });

  test('unbekanntes Angebot und unbekannte Zusatzoption', async () => {
    assert.equal((await buchen(slot('2030-01-07', '08:00'), { angebot: 'gibtsnicht' })).status, 400);
    const r = await buchen(slot('2030-01-07', '08:00'), { zusatzoptionen: ['gibtsnicht'] });
    assert.equal(r.status, 400);
    assert.ok(r.json.data.zusatzoptionen);
  });

  test('ungültige Zeiten → 409: falsche Uhrzeit, Sperrtag, außerhalb Zeitraum, Vergangenheit', async () => {
    for (const start of [slot('2030-01-07', '08:15'), slot('2030-01-09', '08:00'), slot('2030-04-01', '08:00'), slot('2020-01-06', '08:00')]) {
      const r = await buchen(start);
      assert.equal(r.status, 409, `${start}: ${r.text}`);
      assert.match(r.json.message, /nicht buchbar/);
    }
  });

  test('Buchung klappt, Webhook „neue-buchung“ mit Secret, Einwilligung mit Datum und Quelle', async () => {
    const vorher = I.webhooks.length;
    const r = await buchen(slot('2030-01-07', '08:00'), {
      zusatzoptionen: ['reinigung'],
      kontakt: { ...KONTAKT, email: 'Einwilligung@Example.com' },
      einwilligungen: { email: true, whatsapp: true },
    });
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.verwalten_token, /^[A-Za-z0-9]{40}$/);
    assert.equal(r.json.buchung.status.code, 'eingegangen');

    const hook = I.webhooks.slice(vorher).find((w) => w.pfad === '/neue-buchung');
    assert.ok(hook, 'Webhook fehlt');
    assert.equal(hook.secret, 'test-geheimnis');
    assert.equal(hook.body.kontakt.email, 'einwilligung@example.com');

    const [k] = await adminHole('kontakte', 'email = "einwilligung@example.com"');
    assert.equal(k.einwilligung_email, true);
    assert.notEqual(k.einwilligung_email_am, '');
    assert.equal(k.einwilligung_email_quelle, 'buchung');
    assert.equal(k.einwilligung_whatsapp, false, 'nicht konfigurierter Kanal darf nicht gespeichert werden');
    assert.match(k.token, /^[A-Za-z0-9]{40}$/);
  });

  test('ohne Häkchen keine Einwilligung; gleiche E-Mail → derselbe Kontakt, Name nicht überschrieben', async () => {
    const email = 'zweimal@example.com';
    assert.equal((await buchen(slot('2030-01-07', '08:30'), { kontakt: { ...KONTAKT, email } })).status, 201);
    assert.equal((await buchen(slot('2030-01-07', '09:00'), { kontakt: { ...KONTAKT, email, vorname: 'Anders' } })).status, 201);
    const kontakte = await adminHole('kontakte', `email = "${email}"`);
    assert.equal(kontakte.length, 1);
    assert.equal(kontakte[0].vorname, 'Erika');
    assert.equal(kontakte[0].einwilligung_email, false);
  });
});

describe('Kapazität', () => {
  test('voller Slot: dritte Buchung abgelehnt, Slot zeigt frei 0', async () => {
    assert.equal((await buchen(slot('2030-01-10', '08:00'))).status, 201);
    assert.equal((await buchen(slot('2030-01-10', '08:00'))).status, 201);
    const r = await buchen(slot('2030-01-10', '08:00'));
    assert.equal(r.status, 409);
    assert.match(r.json.message, /vergeben/);
    assert.equal(await freiAm('2030-01-10', '08:00'), 0);
    assert.equal(await freiAm('2030-01-10', '08:30'), 2);
  });

  test('voller Tag: nach 12 Buchungen sind alle Slots des Tages belegt', async () => {
    for (const z of ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30']) {
      assert.equal((await buchen(slot('2030-01-11', z))).status, 201);
      assert.equal((await buchen(slot('2030-01-11', z))).status, 201);
    }
    assert.equal(await freiAm('2030-01-11', '11:00'), 0);
    assert.equal((await buchen(slot('2030-01-11', '11:00'))).status, 409);
  });

  test('volle Woche: max_pro_woche greift über alle Tage der ISO-Woche', async () => {
    await einstellungenSetzen({ max_pro_woche: 3 });
    try {
      for (const d of ['2030-01-21', '2030-01-22', '2030-01-23']) {
        assert.equal((await buchen(slot(d, '08:00'))).status, 201);
      }
      assert.equal(await freiAm('2030-01-25', '10:00'), 0);
      assert.equal((await buchen(slot('2030-01-25', '10:00'))).status, 409);
      assert.equal(await freiAm('2030-01-28', '10:00'), 2, 'nächste Woche ist frei');
    } finally {
      await einstellungenSetzen({ max_pro_woche: 50 });
    }
  });

  test('Ressource voll: Angebot mit Ressource gesperrt, Angebot ohne Ressource weiter buchbar', async () => {
    await einstellungenSetzen({ ressourcen: [{ code: 'stellplatz', name: 'Stellplätze', kapazitaet: 1 }] });
    assert.equal((await buchen(slot('2030-02-04', '08:00'), { angebot: 'komplett' })).status, 201);
    assert.equal(await freiAm('2030-02-05', '08:00', { angebot: 'komplett' }), 0);
    assert.equal(await freiAm('2030-02-05', '08:00', { angebot: 'basis' }), 2);
    const r = await buchen(slot('2030-02-05', '08:00'), { angebot: 'komplett' });
    assert.equal(r.status, 409);
    assert.equal((await buchen(slot('2030-02-05', '08:00'))).status, 201);
  });

  test('gleichzeitig: 10 Anfragen auf den letzten Platz eines Slots → genau eine erfolgreich', async () => {
    assert.equal((await buchen(slot('2030-02-06', '08:00'))).status, 201);
    const ergebnisse = await Promise.all(
      Array.from({ length: 10 }, (_, i) => buchen(slot('2030-02-06', '08:00'), { kontakt: { ...KONTAKT, email: `parallel${i}@example.com` } })),
    );
    const status = ergebnisse.map((r) => r.status).sort();
    assert.equal(status.filter((s) => s === 201).length, 1, JSON.stringify(status));
    assert.equal(status.filter((s) => s === 409).length, 9, JSON.stringify(status));
    assert.equal(await freiAm('2030-02-06', '08:00'), 0);
  });

  test('gleichzeitig: 8 Anfragen auf die letzte Ressourcen-Einheit → genau eine erfolgreich', async () => {
    await einstellungenSetzen({ ressourcen: [{ code: 'stellplatz', name: 'Stellplätze', kapazitaet: 2 }] });
    const zeiten = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30'];
    const ergebnisse = await Promise.all(
      zeiten.map((z, i) => buchen(slot('2030-02-07', z), { angebot: 'komplett', kontakt: { ...KONTAKT, email: `ress${i}@example.com` } })),
    );
    const status = ergebnisse.map((r) => r.status);
    assert.equal(status.filter((s) => s === 201).length, 1, JSON.stringify(status));
    await einstellungenSetzen({ ressourcen: [{ code: 'stellplatz', name: 'Stellplätze', kapazitaet: 20 }] });
  });
});

describe('Verwalten', () => {
  test('ansehen, verschieben (alter Slot frei), absagen (Slot frei, danach gesperrt)', async () => {
    const b = await buchen(slot('2030-02-11', '08:00'));
    const t = b.json.verwalten_token;

    const g = await I.api('GET', `/api/nf/verwalten?t=${t}`);
    assert.equal(g.status, 200);
    assert.deepEqual(g.json.aktionen, { verschieben: true, absagen: true });
    assert.doesNotMatch(g.text, /"id"/);

    const vorher = I.webhooks.length;
    const v = await I.api('POST', `/api/nf/verwalten?t=${t}`, { body: { aktion: 'verschieben', start: slot('2030-02-11', '09:00') } });
    assert.equal(v.status, 200, v.text);
    assert.equal(v.json.buchung.start, slot('2030-02-11', '09:00'));
    assert.equal(await freiAm('2030-02-11', '08:00'), 2);
    assert.equal(await freiAm('2030-02-11', '09:00'), 1);
    const hook = I.webhooks.slice(vorher).find((w) => w.pfad === '/verschoben-abgesagt');
    assert.equal(hook.body.art, 'verschoben');
    assert.equal(hook.body.alter_start, slot('2030-02-11', '08:00'));

    const ungueltig = await I.api('POST', `/api/nf/verwalten?t=${t}`, { body: { aktion: 'verschieben', start: slot('2030-02-11', '09:10') } });
    assert.equal(ungueltig.status, 409);

    const a = await I.api('POST', `/api/nf/verwalten?t=${t}`, { body: { aktion: 'absagen' } });
    assert.equal(a.status, 200);
    assert.equal(a.json.buchung.abgesagt, true);
    assert.equal(await freiAm('2030-02-11', '09:00'), 2);
    const danach = await I.api('GET', `/api/nf/verwalten?t=${t}`);
    assert.deepEqual(danach.json.aktionen, { verschieben: false, absagen: false });
    assert.equal((await I.api('POST', `/api/nf/verwalten?t=${t}`, { body: { aktion: 'absagen' } })).status, 409);
  });

  test('ungültiger Link → 404 mit deutscher Meldung', async () => {
    const r = await I.api('GET', `/api/nf/verwalten?t=${'x'.repeat(40)}`);
    assert.equal(r.status, 404);
    assert.match(r.json.message, /Link ist ungültig/);
  });
});

describe('Folgetermin', () => {
  test('nur für berechtigte Buchungen, einmalig, im Folgetermin-Zeitraum; Absage nimmt ihn mit', async () => {
    const komplett = await buchen(slot('2030-02-12', '08:00'), { angebot: 'komplett' });
    const t = komplett.json.verwalten_token;
    const info = await I.api('GET', `/api/nf/folgetermin?t=${t}`);
    assert.equal(info.json.folgetermin.berechtigt, true);
    assert.equal(info.json.folgetermin.ab, '2030-04-01');

    const falscheZeit = await I.api('POST', `/api/nf/folgetermin?t=${t}`, { body: { start: slot('2030-03-04', '14:00') } });
    assert.equal(falscheZeit.status, 409, 'außerhalb des Folgetermin-Zeitraums');

    const ok = await I.api('POST', `/api/nf/folgetermin?t=${t}`, { body: { start: slot('2030-04-01', '14:00') } });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.json.buchung.termintyp.code, 'abholung');
    assert.equal((await I.api('POST', `/api/nf/folgetermin?t=${t}`, { body: { start: slot('2030-04-02', '14:00') } })).status, 409);

    const basis = await buchen(slot('2030-02-12', '08:30'));
    const nein = await I.api('POST', `/api/nf/folgetermin?t=${basis.json.verwalten_token}`, { body: { start: slot('2030-04-01', '14:15') } });
    assert.equal(nein.status, 403);

    await I.api('POST', `/api/nf/verwalten?t=${t}`, { body: { aktion: 'absagen' } });
    const kind = await I.api('GET', `/api/nf/verwalten?t=${ok.json.verwalten_token}`);
    assert.equal(kind.json.buchung.abgesagt, true);
  });

  test('Folgetermin-Typ kann nicht direkt gebucht werden', async () => {
    const r = await I.api('GET', '/api/nf/slots?typ=abholung&von=2030-04-01&bis=2030-04-01');
    assert.ok(r.json.slots.length > 0);
    const b = await buchen(slot('2030-04-01', '14:30'), { angebot: 'basis' });
    assert.equal(b.status, 409);
  });
});

describe('Kontakt-Token: Vorbelegung und Abmeldung', () => {
  test('Angebot mit Token liefert Kontaktdaten; Abmelden setzt abgemeldet mit Datum', async () => {
    await buchen(slot('2030-02-13', '08:00'), { kontakt: { ...KONTAKT, email: 'token@example.com' }, zusatzfelder: { ...ZUSATZ, geraet: 'Modell X' } });
    const [k] = await adminHole('kontakte', 'email = "token@example.com"');

    const a = await I.api('GET', `/api/nf/angebot?t=${k.token}`);
    assert.equal(a.json.kontakt.vorname, 'Erika');
    assert.equal(a.json.kontakt.zusatzfelder.geraet, 'Modell X');

    const r = await I.api('GET', `/api/nf/abmelden?t=${k.token}`);
    assert.equal(r.status, 200);
    const [danach] = await adminHole('kontakte', 'email = "token@example.com"');
    assert.equal(danach.abgemeldet, true);
    assert.notEqual(danach.abgemeldet_am, '');

    assert.equal((await I.api('GET', `/api/nf/abmelden?t=${'y'.repeat(40)}`)).status, 404);
  });
});

describe('Rollen und Zugriffsregeln', () => {
  let inhaber;
  let mitarbeiter;
  let buchungId;

  before(async () => {
    const neu = { email: 'inhaber@test.example', password: 'inhaber-pw-123', passwordConfirm: 'inhaber-pw-123', rolle: 'inhaber', name: 'Inhaber' };
    assert.equal((await I.api('POST', '/api/collections/users/records', { body: neu, token: I.adminToken })).status, 200);
    inhaber = await I.login('users', neu.email, neu.password);
    const b = await buchen(slot('2030-02-14', '08:00'));
    const [rec] = await adminHole('buchungen', `termin_start = "${slot('2030-02-14', '08:00').replace('T', ' ')}"`);
    buchungId = rec.id;
    assert.ok(b.json.ok);
  });

  test('Gäste sehen keine Daten über die Standard-API', async () => {
    for (const c of ['buchungen', 'kontakte', 'einstellungen', 'status_log', 'nachrichten', 'angebote', 'users']) {
      const r = await I.api('GET', `/api/collections/${c}/records`);
      assert.ok(r.status === 200 ? r.json.items.length === 0 : r.status >= 400, `${c}: ${r.status} ${r.text.slice(0, 100)}`);
    }
    const anlegen = await I.api('POST', '/api/collections/buchungen/records', { body: { status: 'x' } });
    assert.ok(anlegen.status >= 400);
  });

  test('Inhaber legt bis zu 3 Mitarbeiter an, der 4. wird abgelehnt', async () => {
    for (let i = 1; i <= 4; i++) {
      const body = { email: `ma${i}@test.example`, password: 'mitarbeiter-pw-1', passwordConfirm: 'mitarbeiter-pw-1', rolle: 'mitarbeiter', name: `MA ${i}` };
      const r = await I.api('POST', '/api/collections/users/records', { body, token: inhaber });
      if (i <= 3) assert.equal(r.status, 200, r.text);
      else {
        assert.equal(r.status, 400);
        assert.match(r.json.message, /maximale Anzahl/);
      }
    }
    mitarbeiter = await I.login('users', 'ma1@test.example', 'mitarbeiter-pw-1');
  });

  test('Tokens sind auch für das Team unsichtbar', async () => {
    const r = await I.api('GET', '/api/collections/kontakte/records', { token: inhaber });
    assert.ok(r.json.items.length > 0);
    assert.ok(r.json.items.every((k) => !('token' in k)));
    const b = await I.api('GET', `/api/collections/buchungen/records/${buchungId}`, { token: mitarbeiter });
    assert.equal(b.status, 200);
    assert.ok(!('token_verwalten' in b.json));
  });

  test('Mitarbeiter: Status setzen ja (Log + Webhook), andere Felder/Einstellungen/Löschen nein', async () => {
    const vorher = I.webhooks.length;
    const s = await I.api('PATCH', `/api/collections/buchungen/records/${buchungId}`, { body: { status: 'in_arbeit' }, token: mitarbeiter });
    assert.equal(s.status, 200, s.text);
    const log = await adminHole('status_log', `buchung = "${buchungId}"`);
    assert.equal(log.length, 1);
    assert.equal(log[0].status, 'in_arbeit');
    assert.notEqual(log[0].gesetzt_von, '');
    const hook = I.webhooks.slice(vorher).find((w) => w.pfad === '/status');
    assert.equal(hook.body.status.code, 'in_arbeit');

    const feld = await I.api('PATCH', `/api/collections/buchungen/records/${buchungId}`, { body: { bemerkung: 'x' }, token: mitarbeiter });
    assert.equal(feld.status, 403);
    assert.match(feld.json.message, /nur den Status/);

    const einst = await I.api('PATCH', `/api/collections/einstellungen/records/${einstellungenId}`, { body: { max_pro_woche: 1 }, token: mitarbeiter });
    assert.ok(einst.status >= 400);
    const angebot = await I.api('POST', '/api/collections/angebote/records', { body: { code: 'neu', name: 'Neu', termintyp: 'abgabe' }, token: mitarbeiter });
    assert.ok(angebot.status >= 400);
    const loeschen = await I.api('DELETE', `/api/collections/buchungen/records/${buchungId}`, { token: mitarbeiter });
    assert.ok(loeschen.status >= 400);
    const [me] = (await I.api('GET', '/api/collections/users/records', { token: mitarbeiter })).json.items;
    const befoerdern = await I.api('PATCH', `/api/collections/users/records/${me.id}`, { body: { rolle: 'inhaber' }, token: mitarbeiter });
    assert.ok(befoerdern.status >= 400, 'Mitarbeiter darf eigene Rolle nicht ändern');
  });

  test('Inhaber: Abschluss-Status setzt abgeschlossen_am; unbekannter Status wird abgelehnt', async () => {
    const r = await I.api('PATCH', `/api/collections/buchungen/records/${buchungId}`, { body: { status: 'fertig' }, token: inhaber });
    assert.equal(r.status, 200, r.text);
    assert.notEqual(r.json.abgeschlossen_am, '');
    const x = await I.api('PATCH', `/api/collections/buchungen/records/${buchungId}`, { body: { status: 'gibtsnicht' }, token: inhaber });
    assert.equal(x.status, 400);
  });
});

describe('Fotos', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  function formular(datei, name) {
    const f = new FormData();
    f.set('daten', JSON.stringify(buchung(slot('2030-02-15', '08:00'))));
    f.append('fotos', new Blob([datei]), name);
    return f;
  }

  test('Foto wird gespeichert und ist ohne Datei-Token nicht abrufbar', async () => {
    const r = await I.api('POST', '/api/nf/buchen', { form: formular(PNG, 'foto.png') });
    assert.equal(r.status, 201, r.text);
    const [rec] = await adminHole('buchungen', `termin_start = "${slot('2030-02-15', '08:00').replace('T', ' ')}"`);
    assert.equal(rec.fotos.length, 1);
    const datei = await fetch(`${I.base}/api/files/buchungen/${rec.id}/${rec.fotos[0]}`);
    assert.ok(datei.status >= 400, `Foto öffentlich abrufbar (${datei.status})`);
  });

  test('Nicht-Bild wird abgelehnt', async () => {
    const r = await I.api('POST', '/api/nf/buchen', { form: formular(Buffer.from('kein bild'), 'notiz.txt') });
    assert.equal(r.status, 400);
    assert.ok(r.json.data.fotos);
  });
});

describe('Rate-Limit', () => {
  test('zu viele Buchungsversuche → 429 mit deutscher Meldung', async () => {
    const s = await I.api('PATCH', '/api/settings', { body: { rateLimits: { enabled: true } }, token: I.adminToken });
    assert.equal(s.status, 200, s.text);
    const antworten = [];
    for (let i = 0; i < 12; i++) antworten.push(await I.api('POST', '/api/nf/buchen', { body: {} }));
    const limit = antworten.find((r) => r.status === 429);
    assert.ok(limit, `kein 429: ${antworten.map((r) => r.status).join(',')}`);
    assert.match(limit.json.message, /Zu viele Anfragen/);
  });
});
