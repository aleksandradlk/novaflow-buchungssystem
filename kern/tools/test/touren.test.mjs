// Unit tests for kern/web/uebersicht/touren.js (sorting and Google Maps links).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ZWISCHENSTOPPS, adresseVon, mapsLinks, tourPlanen } from '../../web/uebersicht/touren.js';

const b = (id, strasse, plz, ort) => ({ id, kontakt: { strasse, plz, ort } });

function waypoints(url) {
  const u = new URL(url);
  return {
    origin: u.searchParams.get('origin'),
    destination: u.searchParams.get('destination'),
    waypoints: (u.searchParams.get('waypoints') || '').split('|').filter(Boolean),
    api: u.searchParams.get('api'),
    mode: u.searchParams.get('travelmode'),
  };
}

test('nur Termine mit vollständiger Adresse', () => {
  assert.equal(adresseVon({ strasse: 'A 1', plz: '12345', ort: '' }), '');
  const t = tourPlanen([b(1, 'A 1', '12345', 'X'), b(2, '', '', ''), { id: 3, kontakt: null }]);
  assert.equal(t.length, 1);
});

test('nach PLZ sortiert, dann Ort und Straße; gleiche Adresse = ein Stopp', () => {
  const t = tourPlanen([
    b(1, 'Zweigweg 2', '80331', 'München'),
    b(2, 'Am Bach 5', '10115', 'Berlin'),
    b(3, 'Hauptstr. 9', '10115', 'Berlin'),
    b(4, 'Hauptstraße 9', '10115', 'Berlin'),
    b(5, 'Dorfstraße 1', '01067', 'Dresden'),
  ]);
  assert.deepEqual(t.map((s) => s.plz), ['01067', '10115', '10115', '80331']);
  assert.deepEqual(t.map((s) => s.strasse), ['Dorfstraße 1', 'Am Bach 5', 'Hauptstr. 9', 'Zweigweg 2']);
  assert.deepEqual(t[2].buchungen.map((x) => x.id), [3, 4]);
});

test('Link: Start beim Betrieb, Zwischenstopps in Reihenfolge, Ziel = letzter Stopp', () => {
  const t = tourPlanen([b(1, 'C 3', '30000', 'Ort'), b(2, 'A 1', '10000', 'Ort'), b(3, 'B 2', '20000', 'Ort')]);
  const [link] = mapsLinks('Betrieb 1, 99999 Stadt', t);
  const w = waypoints(link.url);
  assert.equal(w.api, '1');
  assert.equal(w.mode, 'driving');
  assert.equal(w.origin, 'Betrieb 1, 99999 Stadt');
  assert.deepEqual(w.waypoints, ['A 1, 10000 Ort', 'B 2, 20000 Ort']);
  assert.equal(w.destination, 'C 3, 30000 Ort');
  assert.ok(link.url.startsWith('https://www.google.com/maps/dir/?api=1&'));
});

test('viele Stopps: mehrere Links, lückenlos aneinander, je höchstens 9 Zwischenstopps', () => {
  const stopps = tourPlanen(Array.from({ length: 23 }, (_, i) => b(i, `Weg ${i}`, String(10000 + i), 'Ort')));
  const links = mapsLinks('Start', stopps);
  assert.equal(links.length, 3);
  const besucht = [];
  let von = 'Start';
  for (const l of links) {
    const w = waypoints(l.url);
    assert.ok(w.waypoints.length <= MAX_ZWISCHENSTOPPS);
    assert.equal(w.origin, von);
    besucht.push(...w.waypoints, w.destination);
    von = w.destination;
  }
  assert.deepEqual(besucht, stopps.map((s) => s.adresse), 'alle Stopps genau einmal in PLZ-Reihenfolge');
});
