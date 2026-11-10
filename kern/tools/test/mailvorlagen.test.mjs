// Unit tests for the mail template engine (kern/pb_hooks/nf/mailvorlagen.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { require } from './hilfen.mjs';

const vorlagen = require('../../pb_hooks/nf/mailvorlagen.js');

const BETRIEB = {
  name: 'Testbetrieb',
  firma: { name: 'Test GmbH', strasse: 'Weg 1', plz: '12345', ort: 'Stadt', telefon: '+49 1', email: 'info@test.example' },
  farbe: '#123456',
  auf_farbe: '#ffffff',
};

function mail(over = {}) {
  return vorlagen.rendern({
    art: 'bestaetigung',
    ansprache: 'sie',
    eigene: { du: {}, sie: {} },
    betrieb: BETRIEB,
    kontakt: { anrede: 'Frau', vorname: 'Erika', nachname: 'Muster' },
    buchung: { angebot: 'Paket A', zusatzoptionen: ['Extra'], termintyp: 'Abgabe', termin: { datum: '2030-01-07', zeit: '08:00' } },
    verwalten_link: 'https://buchung.test/verwalten/?t=abc',
    ...over,
  });
}

test('alle Mail-Arten lassen sich in beiden Ansprachen erzeugen', () => {
  for (const art of Object.keys(vorlagen.ARTEN)) {
    for (const ansprache of ['du', 'sie']) {
      const m = mail({ art, ansprache, status: { code: 'x', name: 'In Arbeit' }, tage: 1, buchung: { angebot: 'A', termin: { datum: '2030-01-07', zeit: '08:00' }, alter_termin: { datum: '2030-01-06', zeit: '09:00' } } });
      assert.ok(m.betreff && !/\{\{/.test(m.betreff), `${art}/${ansprache}: ${m.betreff}`);
      assert.doesNotMatch(m.text + m.html, /\{\{|undefined|null/, `${art}/${ansprache}`);
    }
  }
});

test('Sie: förmliche Anrede mit Nachname, Datum deutsch, Details, Knopf, Pflichtangaben', () => {
  const m = mail();
  assert.equal(m.betreff, 'Terminbestätigung: Montag, 7. Januar 2030, 08:00 Uhr');
  assert.match(m.text, /^Guten Tag Frau Muster,/);
  assert.match(m.text, /Angebot: Paket A \(\+ Extra\)/);
  assert.match(m.text, /Termin: Montag, 7\. Januar 2030, 08:00 Uhr – Abgabe/);
  assert.match(m.text, /Termin ansehen oder ändern:\nhttps:\/\/buchung\.test\/verwalten\/\?t=abc/);
  assert.match(m.text, /--\nTest GmbH\nWeg 1, 12345 Stadt\nTel\. \+49 1 · info@test\.example/);
  assert.match(m.html, /background:#123456;color:#ffffff/);
});

test('du: Vorname, ohne Anrede-Feld → voller Name bei Sie', () => {
  assert.match(mail({ ansprache: 'du' }).text, /^Hallo Erika,\n\nvielen Dank für deine Buchung/);
  assert.match(mail({ kontakt: { vorname: 'Erika', nachname: 'Muster' } }).text, /^Guten Tag Erika Muster,/);
});

test('eigene Texte des Kunden überschreiben die Standardtexte, auch je Status', () => {
  const eigene = { du: {}, sie: { signatur: 'Ihr Team\n{{betrieb}}', status_fertig_betreff: 'Fertig!', status_fertig_inhalt: 'abholbereit.' } };
  const fertig = mail({ art: 'status', eigene, status: { code: 'fertig', name: 'Fertig' } });
  assert.equal(fertig.betreff, 'Fertig!');
  assert.match(fertig.text, /abholbereit\./);
  assert.match(fertig.text, /Ihr Team\nTestbetrieb/);
  const anderer = mail({ art: 'status', eigene, status: { code: 'in_arbeit', name: 'In Arbeit' } });
  assert.equal(anderer.betreff, 'Neuigkeiten zu Ihrem Termin: In Arbeit');
});

test('Werte werden im HTML maskiert', () => {
  const m = mail({ kontakt: { vorname: '<script>x</script>', nachname: '"Böse"' }, ansprache: 'du' });
  assert.doesNotMatch(m.html, /<script>/);
  assert.match(m.html, /&lt;script&gt;/);
});

test('Absage ohne Verwalten-Knopf, Erinnerung mit „morgen“', () => {
  assert.doesNotMatch(mail({ art: 'abgesagt' }).text, /Termin ansehen oder ändern/);
  assert.equal(mail({ art: 'erinnerung', tage: 1 }).betreff, 'Erinnerung: Termin morgen');
  assert.equal(vorlagen.wannText(3), 'in 3 Tagen');
});

test('HTML lädt nichts von außen', () => {
  const m = mail();
  assert.doesNotMatch(m.html, /<img|<link|<script|src=|url\(/);
  const links = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(links, ['https://buchung.test/verwalten/?t=abc']);
});

test('unbekannte Platzhalter werden erkannt', () => {
  assert.deepEqual(vorlagen.unbekanntePlatzhalter('Hallo {{vorname}} {{vornmae}}'), ['vornmae']);
});
