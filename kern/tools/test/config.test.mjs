import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCustomer, validateConfig, validateCustomer } from '../lib/config.mjs';
import { KUNDEN, customerDir } from '../lib/paths.mjs';

const EXAMPLE = '_beispiel';
const exampleDir = customerDir(EXAMPLE);

test('kunden/_beispiel besteht die Prüfung', () => {
  const { errors } = validateCustomer(EXAMPLE);
  assert.deepEqual(errors, []);
});

test('alle Kundenordner bestehen die Prüfung', () => {
  const ids = fs.readdirSync(KUNDEN, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const id of ids) {
    assert.deepEqual(validateCustomer(id).errors, [], `kunden/${id}`);
  }
});

test('_beispiel erfüllt den Phase-1-Umfang (2 Angebote, 2 Termintypen, 1 Ressource, 3 Status)', () => {
  const { config } = loadCustomer(exampleDir);
  assert.equal(config.angebote.angebote.length, 2);
  assert.equal(config.termine.termintypen.length, 2);
  assert.equal(config.termine.ressourcen.length, 1);
  assert.equal(config.status.status.length, 3);
});

test('ungültige Kundenkennung wird abgelehnt (kein Pfad-Ausbruch)', () => {
  assert.throws(() => customerDir('../etc'), /Ungültige Kundenkennung/);
});

test('fehlender Kundenordner wird gemeldet', () => {
  assert.match(validateCustomer('gibt-es-nicht').errors[0], /gibt es nicht/);
});

// Each case breaks one rule in a copy of _beispiel and expects a matching message.
function check(mutator) {
  const { config } = loadCustomer(exampleDir);
  const copy = structuredClone(config);
  mutator(copy);
  return validateConfig(copy, { dir: exampleDir, folderName: EXAMPLE });
}

const cases = [
  ['Pflichtfeld fehlt', (c) => { delete c.kunde.domain; }, /Pflichtfeld „domain“ fehlt/],
  ['Tippfehler im Feldnamen', (c) => { c.kunde.module.buchnug = true; }, /unbekanntes Feld „buchnug“/],
  ['falscher Typ', (c) => { c.kunde.rollen.max_mitarbeiter = 'drei'; }, /ganze Zahl/],
  ['ungültiges Datum', (c) => { c.termine.zeitraum.buchbar_ab = '2026-13-01'; }, /Datum/],
  ['ungültige Uhrzeit', (c) => { c.termine.termintypen[0].regeln[0].von = '8 Uhr'; }, /Format ungültig/],
  ['ungültige Farbe', (c) => { c.branding.farben.primaer = 'grün'; }, /Format ungültig/],
  ['Wochentag außerhalb 1–7', (c) => { c.termine.termintypen[0].regeln[0].wochentage = [0]; }, /mindestens 1/],
  ['Impressum ohne https', (c) => { c.rechtliches.impressum_url = 'http://example.com/impressum'; }, /Format ungültig/],
  ['Auswahlfeld ohne Optionen', (c) => { delete c.kunde.formular.zusatzfelder[1].optionen; }, /optionen/],
  ['Optionen bei Textfeld', (c) => { c.kunde.formular.zusatzfelder[0].optionen = ['a']; }, /nicht erlaubt/],
  ['Kennung passt nicht zum Ordner', (c) => { c.kunde.kennung = 'anderer-kunde'; }, /Ordnernamen/],
  ['unbekannte Zeitzone', (c) => { c.kunde.zeitzone = 'Europe/Atlantis'; }, /Zeitzone/],
  ['Modul-Abhängigkeit fehlt', (c) => { c.kunde.module.uebersicht = false; }, /braucht Modul „uebersicht“/],
  ['Touren ohne Adresse', (c) => { c.kunde.formular.adresse = 'aus'; }, /touren/],
  ['Zusatzfeld überschreibt Standardfeld', (c) => { c.kunde.formular.zusatzfelder[0].key = 'email'; }, /Standardfeld/],
  ['Angebot mit unbekanntem Termintyp', (c) => { c.angebote.angebote[0].termintyp = 'gibtsnicht'; }, /Termintyp „gibtsnicht“/],
  ['Angebot mit unbekannter Ressource', (c) => { c.angebote.angebote[1].ressource = 'box'; }, /Ressource „box“/],
  ['doppelter Angebotscode', (c) => { c.angebote.angebote[1].code = 'basis'; }, /doppelt/],
  ['kein aktives Angebot', (c) => { c.angebote.angebote.forEach((a) => { a.aktiv = false; }); }, /aktiv/],
  ['Folgetermin-Typ direkt buchbar', (c) => { c.angebote.angebote[0].termintyp = 'abholung'; }, /Folgetermin-Typ/],
  ['Folgetermin-Modul ohne Konfiguration', (c) => { delete c.termine.folgetermin; }, /„folgetermin“ fehlt/],
  ['Folgetermin am Angebot, Modul aus', (c) => { c.kunde.module.folgetermin = false; }, /Modul „folgetermin“ ist aus/],
  ['Zeitraum verdreht', (c) => { c.termine.zeitraum.buchbar_bis = '2026-01-01'; }, /buchbar_ab/],
  ['Regel: von nach bis', (c) => { c.termine.termintypen[0].regeln[0].bis = '07:00'; }, /„von“ muss vor „bis“/],
  ['Regel: Fenster kürzer als Termin', (c) => { c.termine.termintypen[0].regeln[0].bis = '08:15'; }, /kürzer als die Termindauer/],
  ['Regel: Tag kleiner als Slot', (c) => { c.termine.termintypen[0].regeln[0].max_pro_tag = 1; }, /max_pro_tag/],
  ['doppelter Sperrtag', (c) => { c.termine.sperrtage.push({ datum: '2026-12-24' }); }, /Sperrtag 2026-12-24 ist doppelt/],
  ['zwei Start-Status', (c) => { c.status.status[1].start = true; }, /genau ein Status/],
  ['Löschung ohne Abschluss-Status', (c) => { delete c.status.status[2].abschluss; }, /abschluss/],
  ['Kampagne ohne E-Mail-Einwilligung', (c) => { c.rechtliches.einwilligungen = []; }, /Einwilligungstext/],
  ['Versandfenster verdreht', (c) => { c.nachrichten.kampagne.versandfenster.von = '19:00'; }, /versandfenster/],
  ['du/Sie-Texte unvollständig', (c) => { delete c.texte.sie.titel; }, /fehlt in der Sie-Variante/],
  ['Logo-Datei fehlt', (c) => { c.branding.logo = 'fehlt.svg'; }, /Logo-Datei/],
  ['Schrift ohne lokale Dateien', (c) => { c.branding.schrift.familie = 'Fancy Font'; }, /lokal/],
  ['zu wenig Kontrast', (c) => { c.branding.farben.text = '#bbbbbb'; }, /Kontrast/],
  ['Mail-Text mit unbekanntem Schlüssel', (c) => { c.mails.du.bestaetigung_inhlat = 'x'; c.mails.sie.bestaetigung_inhlat = 'x'; }, /unbekannter Text „bestaetigung_inhlat“/],
  ['Mail-Text mit Tippfehler im Platzhalter', (c) => { c.mails.sie.signatur = 'Ihr {{betreib}}'; }, /unbekannte Platzhalter \{\{betreib\}\}/],
  ['Status-Mail für unbekannten Status', (c) => { c.mails.du.status_weg_inhalt = 'x'; c.mails.sie.status_weg_inhalt = 'x'; }, /Status „weg“ gibt es nicht/],
  ['Mail-Texte du/Sie unvollständig', (c) => { delete c.mails.du.signatur; }, /fehlt in der du-Variante/],
  ['Upload-Grenze überschritten', (c) => { c.kunde.formular.fotos.max_anzahl = 20; c.kunde.formular.fotos.max_mb = 25; }, /Upload-Grenze/],
];

for (const [name, mutator, expected] of cases) {
  test(`erkennt Fehler: ${name}`, () => {
    const errors = check(mutator);
    assert.ok(errors.some((e) => expected.test(e)), `erwartet ${expected}, erhalten:\n${errors.join('\n') || '(keine Fehler)'}`);
  });
}

test('Logo-SVG mit externem Inhalt wird abgelehnt', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-kunde-'));
  try {
    fs.cpSync(exampleDir, tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'branding', 'logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png"/></svg>');
    const { config } = loadCustomer(tmp);
    const errors = validateConfig(config, { dir: tmp });
    assert.ok(errors.some((e) => /extern/.test(e)), errors.join('\n'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
