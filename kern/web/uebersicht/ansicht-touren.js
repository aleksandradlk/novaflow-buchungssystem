// Tours of one week: appointments with an address, sorted by postcode, as route links.

import { datumPlus, el, formatDatum, heute, lokal } from '/gemeinsam/nf.js';
import { kontext } from './app.js';
import { buchungenZwischen, kalenderwoche, montag } from './ansicht-termine.js';
import { fehlerText, hinweis } from './team.js';
import { adresseVon, mapsLinks, tourPlanen } from './touren.js';

export async function tourenAnsicht(arg) {
  const tz = kontext.cfg.betrieb.zeitzone || 'Europe/Berlin';
  const [datumArg, typArg = ''] = decodeURIComponent(arg || '').split('~');
  const start = montag(/^\d{4}-\d{2}-\d{2}$/.test(datumArg) ? datumArg : heute(tz));
  const r = await buchungenZwischen(start, datumPlus(start, 7), " && abgesagt_am = ''");
  const kw = kalenderwoche(start);
  if (!r.ok) {
    hinweis(fehlerText(r), 'fehler');
    return { titel: `Touren KW ${kw}`, element: el('h1', { text: `Touren KW ${kw}` }) };
  }
  const typ = kontext.cfg.termintypen.some((t) => t.code === typArg) ? typArg : '';
  const buchungen = r.json.items
    .filter((b) => !typ || b.termintyp === typ)
    .map((b) => ({ ...b, kontakt: b.expand?.kontakt || {} }));
  const ohneAdresse = buchungen.filter((b) => !adresseVon(b.kontakt)).length;
  const stopps = tourPlanen(buchungen);
  const f = kontext.cfg.betrieb.firma || {};
  const startAdresse = adresseVon({ strasse: f.strasse, plz: f.plz, ort: f.ort });
  const links = stopps.length ? mapsLinks(startAdresse, stopps) : [];
  const pfad = (d, t) => `#/touren/${d}${t ? `~${t}` : ''}`;

  const filter = el('select', {
    id: 't-typ',
    onchange: (e) => { location.hash = pfad(start, e.target.value); },
  }, el('option', { value: '', text: 'alle Termintypen' }),
  kontext.cfg.termintypen.map((t) => el('option', { value: t.code, selected: t.code === typ, text: t.name })));

  const element = el('section', { class: 'touren' },
    el('div', { class: 'werkzeug' },
      el('a', { class: 'knopf klein', href: pfad(datumPlus(start, -7), typ), 'aria-label': 'Vorherige Woche', text: '‹' }),
      el('h1', { text: `Touren KW ${kw}` }),
      el('a', { class: 'knopf klein', href: pfad(datumPlus(start, 7), typ), 'aria-label': 'Nächste Woche', text: '›' })),
    el('div', { class: 'feld' }, el('label', { for: 't-typ', text: 'Termintyp' }), filter),
    el('p', { class: 'klein', text: `${stopps.length} Stopp${stopps.length === 1 ? '' : 's'}, nach PLZ sortiert. Start: ${startAdresse || 'Adresse des Betriebs fehlt'}.${ohneAdresse ? ` ${ohneAdresse} Termin(e) ohne Adresse sind nicht enthalten.` : ''}` }),
    links.length ? el('div', { class: 'routen' },
      links.map((l, i) => el('a', {
        class: 'knopf haupt', href: l.url, target: '_blank', rel: 'noopener noreferrer',
        text: links.length > 1 ? `Route ${i + 1}: Stopp ${l.ab}–${l.bis} in Google Maps` : 'Route in Google Maps öffnen',
      })),
      el('p', { class: 'klein', text: 'Öffnet Google Maps. Dabei werden die Adressen der Stopps an Google übertragen.' })) : null,
    stopps.length ? el('ol', { class: 'stopps' }, stopps.map((s) => el('li', {},
      el('strong', { text: s.adresse }),
      s.buchungen.map((b) => {
        const l = lokal(b.termin_start, tz);
        return el('a', { class: 'klein block', href: `#/buchung/${b.id}`, text: `${formatDatum(l.datum)}, ${l.zeit} Uhr · ${[b.kontakt.vorname, b.kontakt.nachname].filter(Boolean).join(' ')}` });
      })))) : el('p', { class: 'leer', text: 'In dieser Woche gibt es keine Termine mit Adresse.' }));
  return { titel: `Touren KW ${kw}`, element };
}
