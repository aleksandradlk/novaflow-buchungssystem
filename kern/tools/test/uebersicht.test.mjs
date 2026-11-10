// Browser tests of the overview (/uebersicht/) – phase 5 acceptance:
// inhaber and mitarbeiter tested separately; status click creates a mail;
// tour link opens Google Maps with the right order. Skipped without Playwright.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { require, slot, startInstanz, testKonfiguration } from './hilfen.mjs';

let playwright = null;
try {
  playwright = require('playwright');
} catch {
  playwright = null;
}
const ohneBrowser = playwright ? false : 'Playwright ist nicht installiert – Browser-Tests übersprungen.';

const FIRMA = testKonfiguration().kunde.firma;
const INHABER = { email: 'inhaber@test.example', passwort: 'inhaber-pw-123', name: 'Ina Inhaber' };
const MITARBEITER = { email: 'ma@test.example', passwort: 'mitarbeiter-pw-1', name: 'Max Mitarbeiter' };
const ADRESSEN = [
  ['Zweigweg 2', '80331', 'München', '08:00', 'Erika'],
  ['Am Bach 5', '10115', 'Berlin', '09:30', 'Paul'],
  ['Dorfstraße 1', '01067', 'Dresden', '11:00', 'Lena'],
];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let I;
let browser;
const buchungen = {};

async function admin(collection, filter) {
  const r = await I.api('GET', `/api/collections/${collection}/records?perPage=200&sort=-created&filter=${encodeURIComponent(filter)}`, { token: I.adminToken });
  return r.json.items;
}

/** Phone browser logged in with password + one-time code. */
async function angemeldet(wer, { merken = false } = {}) {
  const ctx = await browser.newContext({ ...playwright.devices['iPhone 13'], locale: 'de-DE', timezoneId: 'America/New_York' });
  const page = await ctx.newPage();
  const fehler = [];
  page.on('pageerror', (e) => fehler.push(String(e)));
  await page.goto(`${I.base}/uebersicht/`);
  await page.getByLabel('E-Mail').fill(wer.email);
  await page.getByLabel('Passwort').fill(wer.passwort);
  if (merken) await page.getByLabel(/angemeldet bleiben/).check();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByLabel('Code (6 Ziffern)').waitFor();
  const [n] = await admin('nachrichten', `art = "anmeldecode" && empfaenger = "${wer.email}"`);
  await page.getByLabel('Code (6 Ziffern)').fill(await I.anmeldecode(n.schluessel.split(':')[1]));
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).waitFor();
  return { ctx, page, fehler };
}

async function oeffnen(page, hash, warteAuf) {
  await page.goto(`${I.base}/uebersicht/${hash}`);
  await page.locator(warteAuf).first().waitFor();
}

async function ohneSeitlichesScrollen(page, wo) {
  const zuBreit = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(zuBreit <= 1, `${wo}: Seite ist ${zuBreit}px breiter als das Handy`);
}

describe('Übersicht im Handy-Browser', { skip: ohneBrowser }, () => {
  before(async () => {
    browser = await playwright.chromium.launch();
    I = await startInstanz({ seiten: true });
    await I.api('PATCH', '/api/settings', { body: { rateLimits: { enabled: false } }, token: I.adminToken });
    for (const [wer, rolle] of [[INHABER, 'inhaber'], [MITARBEITER, 'mitarbeiter']]) {
      const r = await I.api('POST', '/api/collections/users/records', {
        token: I.adminToken, body: { email: wer.email, password: wer.passwort, passwordConfirm: wer.passwort, rolle, name: wer.name },
      });
      assert.equal(r.status, 200, r.text);
    }
    for (const [strasse, plz, ort, zeit, vorname] of ADRESSEN) {
      const daten = {
        angebot: 'basis', start: slot('2030-01-08', zeit),
        kontakt: { vorname, nachname: 'Muster', email: `${vorname.toLowerCase()}@example.com`, telefon: '0123 456789', strasse, plz, ort },
        zusatzfelder: { zustand: 'Gut' },
      };
      const form = new FormData();
      form.set('daten', JSON.stringify(daten));
      if (vorname === 'Erika') form.append('fotos', new Blob([PNG]), 'foto.png');
      const r = await I.api('POST', '/api/nf/buchen', { form });
      assert.equal(r.status, 201, r.text);
      const [rec] = await admin('buchungen', `token_verwalten = "${r.json.verwalten_token}"`);
      buchungen[vorname] = rec.id;
    }
    // a contact without any booking (e.g. imported)
    await I.api('POST', '/api/collections/kontakte/records', { token: I.adminToken, body: { vorname: 'Ohne', nachname: 'Buchung', email: 'ohne@example.com', ort: 'Musterort' } });
  });

  after(async () => {
    await browser?.close();
    await I?.stop();
  });

  test('Inhaber: Anmeldung mit zwei Faktoren, alle Bereiche, Sitzung nur im Tab gespeichert', async () => {
    const { ctx, page, fehler } = await angemeldet(INHABER);
    const nav = await page.getByRole('navigation', { name: 'Hauptnavigation' }).innerText();
    for (const punkt of ['Termine', 'Kontakte', 'Touren', 'Verwaltung']) assert.match(nav, new RegExp(punkt));
    assert.match(nav, /Ina Inhaber · Inhaber/);
    const speicher = await page.evaluate(() => ({ lokal: localStorage.length, sitzung: sessionStorage.length }));
    assert.deepEqual(speicher, { lokal: 0, sitzung: 1 }, 'ohne „angemeldet bleiben“ nur sessionStorage');

    await oeffnen(page, '#/woche/2030-01-07', '.termin-zeile');
    const zeilen = await page.locator('.termin-zeile').allInnerTexts();
    assert.equal(zeilen.length, 3);
    assert.match(zeilen[0], /^08:00\s+Erika Muster/, 'Zeiten in Berliner Zeit, sortiert');
    await ohneSeitlichesScrollen(page, 'Woche');

    for (const [hash, sel] of [
      ['#/tag/2030-01-08', '.termin-zeile'], [`#/buchung/${buchungen.Erika}`, '.status-knoepfe'], ['#/kontakte', '.kontakt'],
      ['#/touren/2030-01-07', '.stopps'], ['#/verwaltung/einstellungen', 'form'], ['#/verwaltung/angebote', 'form'],
      ['#/verwaltung/terminregeln', '.regel'], ['#/verwaltung/sperrtage', 'form'], ['#/verwaltung/benutzer', '.liste'],
    ]) {
      await oeffnen(page, hash, sel);
      await ohneSeitlichesScrollen(page, hash);
      const ohneLabel = await page.$$eval('input:not([type=hidden]), select, textarea', (els) => els
        .filter((e) => !(e.labels && e.labels.length) && !e.getAttribute('aria-label')).map((e) => e.name || e.id));
      assert.deepEqual(ohneLabel, [], `${hash}: Felder ohne Beschriftung`);
    }
    assert.deepEqual(fehler, []);
    await ctx.close();
  });

  test('Status-Klick erzeugt die Mail an den Kunden (Inhaber)', async () => {
    const { ctx, page } = await angemeldet(INHABER);
    await oeffnen(page, `#/buchung/${buchungen.Erika}`, '.status-knoepfe');
    const vorher = I.webhooks.length;
    await page.getByRole('button', { name: 'In Arbeit ✉' }).click();
    await page.getByText('Status „In Arbeit“ gesetzt. Die Mail an den Kunden wird verschickt.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'In Arbeit ✉' }).getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('.verlauf').innerText(), /In Arbeit/);

    const [b] = await admin('buchungen', `id = "${buchungen.Erika}"`);
    assert.equal(b.status, 'in_arbeit');
    const [mail] = await admin('nachrichten', `buchung = "${buchungen.Erika}" && art = "status"`);
    assert.ok(mail, 'Status-Mail liegt in der Warteschlange');
    assert.equal(mail.empfaenger, 'erika@example.com');
    assert.match(mail.betreff, /In Arbeit/);
    assert.ok(I.webhooks.slice(vorher).some((w) => w.pfad === '/status' && w.body.schluessel === mail.schluessel), 'Automation benachrichtigt');

    // photo is shown via short-lived file token
    const geladen = await page.locator('.fotos img').first().evaluate((img) => new Promise((ok) => {
      if (img.complete) ok(img.naturalWidth > 0); else img.onload = () => ok(img.naturalWidth > 0);
    }));
    assert.ok(geladen, 'Foto sichtbar');
    await ctx.close();
  });

  test('Mitarbeiter: sieht Termine, setzt Status (mit Mail), keine Verwaltung', async () => {
    const { ctx, page, fehler } = await angemeldet(MITARBEITER, { merken: true });
    const nav = await page.getByRole('navigation', { name: 'Hauptnavigation' }).innerText();
    assert.doesNotMatch(nav, /Verwaltung/);
    assert.match(nav, /Max Mitarbeiter · Mitarbeiter/);
    assert.equal(await page.evaluate(() => localStorage.length), 1, '„angemeldet bleiben“ → localStorage');

    await page.goto(`${I.base}/uebersicht/#/verwaltung/benutzer`);
    await page.waitForURL(/#\/woche$/);

    await oeffnen(page, `#/buchung/${buchungen.Paul}`, '.status-knoepfe');
    await page.getByRole('button', { name: 'Fertig ✉' }).click();
    await page.getByText('Status „Fertig“ gesetzt.', { exact: false }).waitFor();
    const [log] = await admin('status_log', `buchung = "${buchungen.Paul}"`);
    const [ma] = await admin('users', `email = "${MITARBEITER.email}"`);
    assert.equal(log.status, 'fertig');
    assert.equal(log.gesetzt_von, ma.id);
    const [mail] = await admin('nachrichten', `buchung = "${buchungen.Paul}" && art = "status"`);
    assert.equal(mail.betreff, 'Fertig zur Abholung', 'eigener Text des Kunden für „Fertig“');

    await oeffnen(page, '#/touren/2030-01-07', '.stopps');
    await page.getByRole('button', { name: 'Abmelden' }).click();
    await page.getByRole('heading', { name: 'Anmelden' }).waitFor();
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0], 'Abmelden löscht die Sitzung');
    assert.deepEqual(fehler, []);
    await ctx.close();
  });

  test('Touren: Link öffnet Google Maps mit Start beim Betrieb und Stopps nach PLZ', async () => {
    const { ctx, page } = await angemeldet(INHABER);
    await oeffnen(page, '#/touren/2030-01-07', '.stopps');
    const stopps = await page.locator('.stopps > li > strong').allInnerTexts();
    assert.deepEqual(stopps, ['Dorfstraße 1, 01067 Dresden', 'Am Bach 5, 10115 Berlin', 'Zweigweg 2, 80331 München']);
    const href = await page.getByRole('link', { name: 'Route in Google Maps öffnen' }).getAttribute('href');
    const url = new URL(href);
    assert.equal(`${url.origin}${url.pathname}`, 'https://www.google.com/maps/dir/');
    assert.equal(url.searchParams.get('origin'), `${FIRMA.strasse}, ${FIRMA.plz} ${FIRMA.ort}`);
    assert.deepEqual(url.searchParams.get('waypoints').split('|'), stopps.slice(0, 2));
    assert.equal(url.searchParams.get('destination'), stopps[2]);
    assert.equal(await page.getByRole('link', { name: 'Route in Google Maps öffnen' }).getAttribute('target'), '_blank');
    assert.match(await page.locator('.touren').innerText(), /Adressen der Stopps an Google übertragen/);

    await page.getByLabel('Termintyp').selectOption('abholung');
    await page.getByText('In dieser Woche gibt es keine Termine mit Adresse.').waitFor();
    await ctx.close();
  });

  test('Kontakte: zeigt nur Kontakte ohne Buchung im Zeitraum', async () => {
    const { ctx, page } = await angemeldet(INHABER);
    await oeffnen(page, '#/kontakte', '.kontakt');
    const text = await page.locator('.kontakte').innerText();
    assert.match(text, /Ohne Buchung/);
    assert.doesNotMatch(text, /Erika|Paul|Lena/);
    await page.getByLabel('Suchen').fill('nichtvorhanden');
    assert.equal(await page.locator('.kontakt').count(), 0);
    await ctx.close();
  });

  test('Verwaltung: Änderungen wirken sofort auf der Buchungsseite', async () => {
    const { ctx, page } = await angemeldet(INHABER);
    page.on('dialog', (d) => d.accept());

    // blocked day
    await oeffnen(page, '#/verwaltung/sperrtage', 'form');
    await page.getByLabel('Datum').fill('2030-01-10');
    await page.getByLabel('Grund (optional)').fill('Inventur');
    await page.getByRole('button', { name: 'Sperrtag hinzufügen' }).click();
    await page.getByText('Sperrtag hinzugefügt.').waitFor();
    const slots = await I.api('GET', '/api/nf/slots?typ=abgabe&von=2030-01-10&bis=2030-01-10');
    assert.deepEqual(slots.json.sperrtage, ['2030-01-10']);

    // offer name
    await oeffnen(page, '#/verwaltung/angebote', 'form');
    const basis = page.locator('form', { has: page.getByRole('heading', { name: 'Paket Basis' }) });
    await basis.locator('input[name=name]').fill('Paket Basis Plus');
    await basis.getByRole('button', { name: 'Speichern' }).click();
    await page.getByText('Angebot gespeichert.').waitFor();
    const angebot = await I.api('GET', '/api/nf/angebot');
    assert.ok(angebot.json.angebote.some((a) => a.name === 'Paket Basis Plus'));

    // appointment rule: Monday ends earlier
    await oeffnen(page, '#/verwaltung/terminregeln', '.regel');
    const montag = page.locator('form.regel').filter({ has: page.locator('select[name=wochentag] option[selected]', { hasText: 'Montag' }) }).first();
    await montag.locator('input[name=bis]').fill('10:00');
    await montag.getByRole('button', { name: 'Speichern' }).click();
    await page.getByText('Regel gespeichert.').waitFor();
    const montagSlots = await I.api('GET', '/api/nf/slots?typ=abgabe&von=2030-01-14&bis=2030-01-14');
    assert.equal(montagSlots.json.slots.at(-1).zeit, '09:30');

    // settings
    await oeffnen(page, '#/verwaltung/einstellungen', 'form');
    await page.getByLabel(/Höchstens Termine pro Woche/).fill('7');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.getByText('Einstellungen gespeichert.').waitFor();
    const [e] = await admin('einstellungen', 'id != ""');
    assert.equal(e.max_pro_woche, 7);

    // users: limit of staff accounts (3 in the example, 1 exists)
    await oeffnen(page, '#/verwaltung/benutzer', '.liste');
    for (const n of [2, 3, 4]) {
      await page.locator('form input[name=name]').fill(`MA ${n}`);
      await page.locator('form input[name=email]').fill(`ma${n}@test.example`);
      await page.getByLabel(/Startpasswort/).fill('startpasswort-1');
      await page.getByRole('button', { name: 'Zugang anlegen' }).click();
      if (n < 4) await page.getByText('Zugang angelegt.', { exact: false }).waitFor();
      else await page.getByText(/maximale Anzahl an Mitarbeiter-Zugängen \(3\)/).waitFor();
    }
    assert.match(await page.locator('.verwaltung-inhalt').innerText(), /3 von 3 Mitarbeiter-Zugängen belegt/);
    await ctx.close();
  });
});
