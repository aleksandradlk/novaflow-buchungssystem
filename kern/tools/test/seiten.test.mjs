// Browser tests of the public pages (booking, manage, unsubscribe) on an emulated phone.
// Phase 3 acceptance: booking on a phone, no cookies / no external requests, photos stored,
// consents with date, branding switches only via kunden/<kunde>/branding.
// Needs Playwright with Chromium; skipped where it is not installed.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { require, slot, startInstanz } from './hilfen.mjs';
import { customerDir } from '../lib/paths.mjs';
import { loadCustomer } from '../lib/config.mjs';

const BETRIEB = loadCustomer(customerDir('_beispiel')).config.kunde.name;

let playwright = null;
try {
  playwright = require('playwright');
} catch {
  playwright = null;
}
const ohneBrowser = playwright ? false : 'Playwright ist nicht installiert – Browser-Tests übersprungen.';

const TOOL_NAMES = /pocketbase|n8n|caddy/i;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let browser;

async function handy(I) {
  const ctx = await browser.newContext({
    ...playwright.devices['iPhone 13'],
    locale: 'de-DE',
    timezoneId: 'America/New_York', // pages must show the customer's time zone, not the browser's
  });
  const page = await ctx.newPage();
  const protokoll = { extern: [], setCookie: [], fehler: [] };
  page.on('request', (r) => { if (!r.url().startsWith(I.base)) protokoll.extern.push(r.url()); });
  page.on('response', async (r) => { if ((await r.allHeaders())['set-cookie']) protokoll.setCookie.push(r.url()); });
  page.on('pageerror', (e) => protokoll.fehler.push(String(e)));
  return { ctx, page, protokoll };
}

async function datenschutzPruefen(ctx, page, protokoll) {
  assert.deepEqual(protokoll.extern, [], 'externe Aufrufe');
  assert.deepEqual(protokoll.setCookie, [], 'Set-Cookie');
  assert.equal((await ctx.cookies()).length, 0, 'Cookies');
  const speicher = await page.evaluate(() => localStorage.length + sessionStorage.length);
  assert.equal(speicher, 0, 'localStorage/sessionStorage');
  assert.deepEqual(protokoll.fehler, [], 'JavaScript-Fehler');
  const sichtbar = `${await page.title()} ${await page.locator('body').innerText()}`;
  assert.doesNotMatch(sichtbar, TOOL_NAMES, 'Tool-Name sichtbar');
}

async function adminHole(I, collection, filter) {
  const r = await I.api('GET', `/api/collections/${collection}/records?perPage=200&filter=${encodeURIComponent(filter)}`, { token: I.adminToken });
  return r.json.items;
}

async function apiBuchen(I, start, email, angebot = 'basis') {
  const r = await I.api('POST', '/api/nf/buchen', {
    body: { angebot, start, kontakt: { vorname: 'Api', nachname: 'Test', email, telefon: '0123 456789' }, zusatzfelder: { zustand: 'Gut' } },
  });
  assert.equal(r.status, 201, r.text);
  return r.json;
}

/** Opens the booking page and walks to the appointment step of the given offer. */
async function bisTermin(page, I, angebotName = 'Paket Basis', pfad = '/') {
  await page.goto(`${I.base}${pfad}`);
  await page.getByText(angebotName).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.locator('.kal-zeit:not([disabled])').first().waitFor();
}

async function tagWaehlen(page, datum) {
  await page.locator(`.kal-tag[data-datum="${datum}"]`).click();
}

describe('Seiten im Handy-Browser', { skip: ohneBrowser }, () => {
  let I;

  before(async () => {
    browser = await playwright.chromium.launch();
    I = await startInstanz({ seiten: true });
    await I.api('PATCH', '/api/settings', { body: { rateLimits: { enabled: false } }, token: I.adminToken });
  });

  after(async () => {
    await browser?.close();
    await I?.stop();
  });

  test('komplette Buchung mit Foto und Einwilligung – ohne Cookies, Speicher und externe Aufrufe', async () => {
    const { ctx, page, protokoll } = await handy(I);
    const beginn = Date.now();
    let schritte = 0;
    const tippe = async (locator) => { schritte++; await locator.click(); };

    await page.goto(`${I.base}/`);
    await page.locator('.karte').first().waitFor();
    assert.equal(await page.title(), `Termin buchen – ${BETRIEB}`);
    assert.equal(await page.locator('.kopf .logo').getAttribute('src'), '/kunde/logo.svg');

    await tippe(page.getByText('Paket Komplett'));
    await tippe(page.getByText('Gründliche Reinigung'));
    await tippe(page.getByRole('button', { name: 'Weiter' }));

    // calendar opens in the first bookable month; first free day is preselected
    await page.locator('.kal-zeit:not([disabled])').first().waitFor();
    assert.match(await page.locator('.kal-titel').innerText(), /Januar 2030/);
    await tippe(page.locator('.kal-zeit:not([disabled])', { hasText: '09:00' }));
    await tippe(page.getByRole('button', { name: 'Weiter' }));

    await page.getByLabel('Vorname').fill('Erika'); schritte++;
    await page.getByLabel('Nachname').fill('Browser'); schritte++;
    await page.getByLabel(/^E-Mail/).fill('browser@example.com'); schritte++;
    await page.getByLabel('Telefon').fill('0123 456789'); schritte++;
    await page.getByLabel('Zustand').selectOption('Gut'); schritte++;
    await page.getByLabel('Fotos (optional)').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG }); schritte++;
    const einwilligung = page.getByRole('checkbox', { name: /per E-Mail/ });
    assert.equal(await einwilligung.isChecked(), false, 'Einwilligung darf nicht vorausgewählt sein');
    await tippe(einwilligung);
    await tippe(page.getByRole('button', { name: 'Verbindlich buchen' }));

    await page.locator('.bestaetigung').waitFor();
    const text = await page.locator('.bestaetigung').innerText();
    assert.match(text, /Vielen Dank, Erika!/);
    assert.match(text, /Montag, 7\. Januar 2030, 09:00 Uhr/, 'Berliner Zeit trotz Browser in New York');
    const dauer = (Date.now() - beginn) / 1000;
    console.log(`  Buchung: ${schritte} Eingaben/Klicks, automatisiert ${dauer.toFixed(1)} s`);

    await datenschutzPruefen(ctx, page, protokoll);

    const [kontakt] = await adminHole(I, 'kontakte', 'email = "browser@example.com"');
    assert.equal(kontakt.einwilligung_email, true);
    assert.match(kontakt.einwilligung_email_am, /^\d{4}-\d{2}-\d{2} /);
    assert.equal(kontakt.einwilligung_email_quelle, 'buchung');
    const [buchung] = await adminHole(I, 'buchungen', `kontakt = "${kontakt.id}"`);
    assert.equal(buchung.fotos.length, 1, 'Foto gespeichert');
    assert.deepEqual(buchung.zusatzoptionen, ['reinigung']);
    await ctx.close();
  });

  test('Kalender: Sperrtag geschlossen, ausgebuchter Tag und Slot ausgegraut', async () => {
    for (const z of ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30']) {
      await apiBuchen(I, slot('2030-01-15', z), `voll-${z.replace(':', '')}-a@example.com`);
      await apiBuchen(I, slot('2030-01-15', z), `voll-${z.replace(':', '')}-b@example.com`);
    }
    await apiBuchen(I, slot('2030-01-14', '08:00'), 'slot-a@example.com');
    await apiBuchen(I, slot('2030-01-14', '08:00'), 'slot-b@example.com');

    const { ctx, page } = await handy(I);
    await bisTermin(page, I);
    const gesperrt = page.locator('.kal-tag[data-datum="2030-01-09"]');
    assert.ok(await gesperrt.isDisabled());
    assert.match(await gesperrt.getAttribute('aria-label'), /geschlossen/);
    const voll = page.locator('.kal-tag[data-datum="2030-01-15"]');
    assert.ok(await voll.isDisabled());
    assert.match(await voll.getAttribute('aria-label'), /ausgebucht/);

    await tagWaehlen(page, '2030-01-14');
    const zeit = page.locator('.kal-zeit', { hasText: '08:00' });
    assert.ok(await zeit.isDisabled(), 'voller Slot ist nicht wählbar');
    assert.match(await zeit.getAttribute('aria-label'), /ausgebucht/);
    assert.ok(!(await page.locator('.kal-zeit', { hasText: '08:30' }).isDisabled()));
    await ctx.close();
  });

  test('Fehler werden am Feld angezeigt; vergebener Slot führt zurück zur Terminwahl', async () => {
    const { ctx, page } = await handy(I);
    await bisTermin(page, I);
    await tagWaehlen(page, '2030-01-16');
    await page.locator('.kal-zeit', { hasText: '11:00' }).click();
    await page.getByRole('button', { name: 'Weiter' }).click();

    await page.getByRole('button', { name: 'Verbindlich buchen' }).click();
    await page.locator('.feld-fehler').first().waitFor();
    assert.equal(await page.getByLabel('Vorname').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'f-kontakt-vorname', 'Fokus auf erstem Fehler');

    // meanwhile someone else takes the last places
    await apiBuchen(I, slot('2030-01-16', '11:00'), 'weg-a@example.com');
    await apiBuchen(I, slot('2030-01-16', '11:00'), 'weg-b@example.com');
    await page.getByLabel('Vorname').fill('Zu');
    await page.getByLabel('Nachname').fill('Spät');
    await page.getByLabel(/^E-Mail/).fill('spaet@example.com');
    await page.getByLabel('Telefon').fill('0123 456789');
    await page.getByLabel('Zustand').selectOption('Gut');
    await page.getByRole('button', { name: 'Verbindlich buchen' }).click();
    await page.locator('.kalender').waitFor();
    assert.match(await page.locator('#meldung').innerText(), /vergeben/);
    await ctx.close();
  });

  test('Link aus Kampagne: Kontaktdaten sind vorausgefüllt', async () => {
    await apiBuchen(I, slot('2030-01-17', '08:00'), 'stamm@example.com');
    const [k] = await adminHole(I, 'kontakte', 'email = "stamm@example.com"');
    const { ctx, page } = await handy(I);
    await bisTermin(page, I, 'Paket Basis', `/?t=${k.token}`);
    await page.locator('.kal-zeit:not([disabled])').first().click();
    await page.getByRole('button', { name: 'Weiter' }).click();
    assert.equal(await page.getByLabel('Vorname').inputValue(), 'Api');
    assert.equal(await page.getByLabel(/^E-Mail/).inputValue(), 'stamm@example.com');
    await ctx.close();
  });

  test('Verwalten: verschieben, Folgetermin buchen, absagen', async () => {
    const b = await apiBuchen(I, slot('2030-01-21', '08:00'), 'verwalten@example.com', 'komplett');
    const { ctx, page, protokoll } = await handy(I);
    await page.goto(`${I.base}/verwalten/?t=${b.verwalten_token}`);
    await page.getByRole('heading', { name: 'Ihr Termin' }).waitFor();
    assert.match(await page.locator('.auswahl').first().innerText(), /Montag, 21\. Januar 2030, 08:00 Uhr/);

    await page.getByRole('button', { name: 'Termin verschieben' }).click();
    await page.locator('.kal-zeit:not([disabled])').first().waitFor();
    await tagWaehlen(page, '2030-01-22');
    await page.locator('.kal-zeit', { hasText: '10:00' }).click();
    await page.getByRole('button', { name: 'Neuen Termin bestätigen' }).click();
    await page.getByText('Der Termin wurde verschoben.').waitFor();
    assert.match(await page.locator('.auswahl').first().innerText(), /Dienstag, 22\. Januar 2030, 10:00 Uhr/);

    await page.getByRole('button', { name: 'Folgetermin buchen' }).click();
    await page.locator('.kal-zeit:not([disabled])').first().waitFor();
    assert.match(await page.locator('.kal-titel').innerText(), /April 2030/, 'Kalender startet im Folgetermin-Zeitraum');
    await page.locator('.kal-zeit:not([disabled])').first().click();
    await page.getByRole('button', { name: 'Folgetermin verbindlich buchen' }).click();
    await page.getByText('Der Folgetermin ist gebucht.').waitFor();
    assert.ok(await page.getByRole('link', { name: 'Folgetermin ansehen oder ändern' }).isVisible());

    await page.getByRole('button', { name: 'Termin absagen' }).click();
    await page.getByRole('button', { name: 'Ja, Termin absagen' }).click();
    await page.getByText('Der Termin ist abgesagt.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Termin verschieben' }).count(), 0);
    await datenschutzPruefen(ctx, page, protokoll);
    await ctx.close();
  });

  test('ungültiger Verwalten-Link zeigt deutsche Meldung', async () => {
    const { ctx, page } = await handy(I);
    await page.goto(`${I.base}/verwalten/?t=${'x'.repeat(40)}`);
    await page.locator('.meldung-fehler').waitFor();
    assert.match(await page.locator('#meldung').innerText(), /Link ist ungültig/);
    await ctx.close();
  });

  test('Abmelden: Öffnen allein ändert nichts, erst der Knopf meldet ab', async () => {
    await apiBuchen(I, slot('2030-01-23', '08:00'), 'abmelden@example.com');
    const [k] = await adminHole(I, 'kontakte', 'email = "abmelden@example.com"');
    const { ctx, page, protokoll } = await handy(I);
    await page.goto(`${I.base}/abmelden/?t=${k.token}`);
    await page.getByRole('button', { name: 'Abmelden' }).waitFor();
    assert.equal((await adminHole(I, 'kontakte', 'email = "abmelden@example.com"'))[0].abgemeldet, false);
    await page.getByRole('button', { name: 'Abmelden' }).click();
    await page.getByText('Sie sind abgemeldet').waitFor();
    assert.equal((await adminHole(I, 'kontakte', 'email = "abmelden@example.com"'))[0].abgemeldet, true);
    await datenschutzPruefen(ctx, page, protokoll);
    await ctx.close();
  });

  test('alle Formularfelder haben eine Beschriftung', async () => {
    const { ctx, page } = await handy(I);
    await bisTermin(page, I);
    await page.locator('.kal-zeit:not([disabled])').first().click();
    await page.getByRole('button', { name: 'Weiter' }).click();
    const ohne = await page.$$eval('form input, form select, form textarea',
      (els) => els.filter((e) => !(e.labels && e.labels.length)).map((e) => e.name));
    assert.deepEqual(ohne, []);
    await ctx.close();
  });
});

describe('Branding und Ansprache kommen nur aus dem Kundenordner', { skip: ohneBrowser }, () => {
  let I;
  let kundeDir;

  before(async () => {
    browser = browser && browser.isConnected() ? browser : await playwright.chromium.launch();
    // copy of the example; only files in branding/ change (+ form of address in kunde.json)
    kundeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-kunde-'));
    fs.cpSync(customerDir('_beispiel'), kundeDir, { recursive: true });
    const b = JSON.parse(fs.readFileSync(path.join(kundeDir, 'branding', 'branding.json'), 'utf8'));
    b.logo = 'zeichen.svg';
    b.farben.primaer = '#7a1f5c';
    fs.writeFileSync(path.join(kundeDir, 'branding', 'branding.json'), JSON.stringify(b));
    fs.writeFileSync(path.join(kundeDir, 'branding', 'zeichen.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#7a1f5c"/></svg>');
    I = await startInstanz({ seiten: true, kundeDir, mutate: (c) => { c.kunde.ansprache = 'du'; } });
  });

  after(async () => {
    await browser?.close();
    await I?.stop();
    if (kundeDir) fs.rmSync(kundeDir, { recursive: true, force: true });
  });

  test('andere Farbe, anderes Logo, du-Ansprache – ohne Änderung am Kern', async () => {
    const { ctx, page } = await handy(I);
    await page.goto(`${I.base}/`);
    await page.locator('.karte').first().waitFor();
    assert.equal(await page.locator('.kopf .logo').getAttribute('src'), '/kunde/zeichen.svg');
    assert.ok(await page.locator('.kopf .logo').evaluate((img) => img.complete && img.naturalWidth > 0), 'Logo geladen');
    const farbe = await page.getByRole('button', { name: 'Weiter' }).evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.equal(farbe, 'rgb(122, 31, 92)');
    assert.match(await page.locator('h2').innerText(), /für dich/);
    await ctx.close();
  });
});
