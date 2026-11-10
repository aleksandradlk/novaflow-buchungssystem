// Unit tests for kern/pb_hooks/nf/slots.js (pure slot calculation).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slots, zeitIntl } from './hilfen.mjs';

const zeit = zeitIntl('Europe/Berlin');
const ms = (datum, uhrzeit) => zeit.toUtcMs(datum, uhrzeit);

const ABGABE = { code: 'abgabe', dauer_minuten: 30 };
const regelMo = { wochentag: 1, von: '08:00', bis: '10:00', takt_minuten: 30, max_pro_slot: 2, max_pro_tag: 5 };

function ctx(over = {}) {
  return {
    typ: ABGABE,
    regeln: [regelMo],
    zeitraum: { ab: '2030-01-01', bis: '2030-12-31' },
    sperrtage: [],
    maxProWoche: 0,
    ressourceFrei: null,
    buchungen: [],
    von: '2030-01-07',
    bis: '2030-01-07',
    nowMs: Date.UTC(2029, 0, 1),
    zeit,
    ...over,
  };
}

function buchung(datum, uhrzeit, typ = 'abgabe', dauer = 30) {
  const startMs = ms(datum, uhrzeit);
  return { startMs, endeMs: startMs + dauer * 60000, termintyp: typ };
}

test('erzeugt Slots im Takt bis Ende des Fensters (Ende − Dauer)', () => {
  const { slots: s } = slots.berechneSlots(ctx());
  assert.deepEqual(s.map((x) => x.zeit), ['08:00', '08:30', '09:00', '09:30']);
  assert.ok(s.every((x) => x.frei === 2));
  assert.equal(s[0].start, '2030-01-07T07:00:00.000Z'); // Winterzeit: UTC+1
});

test('Sommerzeit wird berücksichtigt', () => {
  const { slots: s } = slots.berechneSlots(ctx({ von: '2030-07-01', bis: '2030-07-01' }));
  assert.equal(s[0].start, '2030-07-01T06:00:00.000Z'); // UTC+2
});

test('nur passende Wochentage, Sonntag = 7', () => {
  const c = ctx({ regeln: [{ ...regelMo, wochentag: 7 }], von: '2030-01-07', bis: '2030-01-13' });
  const { slots: s } = slots.berechneSlots(c);
  assert.ok(s.length > 0 && s.every((x) => x.datum === '2030-01-13'));
});

test('Sperrtag: keine Slots, Tag wird gemeldet', () => {
  const r = slots.berechneSlots(ctx({ sperrtage: ['2030-01-07'] }));
  assert.equal(r.slots.length, 0);
  assert.deepEqual(r.sperrtage, ['2030-01-07']);
});

test('Zeitraum begrenzt die Tage', () => {
  const r = slots.berechneSlots(ctx({ zeitraum: { ab: '2030-01-08', bis: '2030-12-31' } }));
  assert.equal(r.slots.length, 0);
});

test('Gültigkeit der Regel (gueltig_von/bis)', () => {
  const r = slots.berechneSlots(ctx({ regeln: [{ ...regelMo, gueltig_von: '2030-02-01' }] }));
  assert.equal(r.slots.length, 0);
});

test('vergangene Slots werden nicht angeboten', () => {
  const r = slots.berechneSlots(ctx({ nowMs: ms('2030-01-07', '08:45') }));
  assert.deepEqual(r.slots.map((x) => x.zeit), ['09:00', '09:30']);
});

test('voller Slot: frei 0, andere Slots unberührt', () => {
  const c = ctx({ buchungen: [buchung('2030-01-07', '08:00'), buchung('2030-01-07', '08:00')] });
  const s = slots.berechneSlots(c).slots;
  assert.equal(s[0].frei, 0);
  assert.equal(s[1].frei, 2);
});

test('Überlappung zählt (Takt kürzer als Dauer)', () => {
  const c = ctx({
    regeln: [{ ...regelMo, takt_minuten: 15, max_pro_slot: 1 }],
    buchungen: [buchung('2030-01-07', '08:00')],
  });
  const s = slots.berechneSlots(c).slots;
  const frei = Object.fromEntries(s.map((x) => [x.zeit, x.frei]));
  assert.equal(frei['08:00'], 0);
  assert.equal(frei['08:15'], 0); // überlappt 08:00–08:30
  assert.equal(frei['08:30'], 1);
});

test('voller Tag (max_pro_tag) sperrt alle Slots des Tages', () => {
  const b = ['08:00', '08:00', '08:30', '08:30', '09:00'].map((z) => buchung('2030-01-07', z));
  const s = slots.berechneSlots(ctx({ buchungen: b })).slots;
  assert.ok(s.every((x) => x.frei === 0), JSON.stringify(s));
});

test('anderer Termintyp zählt nicht für Slot und Tag', () => {
  const b = [buchung('2030-01-07', '08:00', 'abholung'), buchung('2030-01-07', '08:00', 'abholung')];
  const s = slots.berechneSlots(ctx({ buchungen: b })).slots;
  assert.equal(s[0].frei, 2);
});

test('volle Woche (max_pro_woche) zählt alle Termintypen der ISO-Woche', () => {
  const b = [buchung('2030-01-08', '08:00', 'abholung'), buchung('2030-01-13', '08:00')];
  const c = ctx({ maxProWoche: 2, buchungen: b, von: '2030-01-07', bis: '2030-01-14' });
  const s = slots.berechneSlots(c).slots;
  assert.ok(s.filter((x) => x.datum === '2030-01-07').every((x) => x.frei === 0));
  assert.ok(s.filter((x) => x.datum === '2030-01-14').every((x) => x.frei === 2), 'neue Woche ist frei');
});

test('Ressource voll: frei 0 überall', () => {
  const s = slots.berechneSlots(ctx({ ressourceFrei: 0 })).slots;
  assert.ok(s.length > 0 && s.every((x) => x.frei === 0));
});

test('Ressource begrenzt frei auf verbleibende Einheiten', () => {
  const s = slots.berechneSlots(ctx({ ressourceFrei: 1 })).slots;
  assert.ok(s.every((x) => x.frei === 1));
});

test('freiAm: gültiger Slot, falsche Uhrzeit, Sperrtag', () => {
  assert.equal(slots.freiAm(ctx(), ms('2030-01-07', '08:30')).frei, 2);
  assert.equal(slots.freiAm(ctx(), ms('2030-01-07', '08:15')), null);
  assert.equal(slots.freiAm(ctx({ sperrtage: ['2030-01-07'] }), ms('2030-01-07', '08:30')), null);
});

test('Datums-Helfer', () => {
  assert.equal(slots.wochentag('2030-01-07'), 1);
  assert.equal(slots.wochentag('2030-01-13'), 7);
  assert.equal(slots.wochenStart('2030-01-13'), '2030-01-07');
  assert.equal(slots.addTage('2030-12-31', 1), '2031-01-01');
  assert.ok(slots.istDatum('2030-02-28'));
  assert.ok(!slots.istDatum('2030-02-30'));
  assert.ok(!slots.istDatum('2030-1-1'));
});
