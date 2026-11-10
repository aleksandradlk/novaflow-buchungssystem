// Appointments: week (ISO week), day and booking details with status buttons.

import { datumPlus, el, formatDatum, heute, lokal, utcAusLokal } from '/gemeinsam/nf.js';
import { kontext } from './app.js';
import { api, fehlerText, filterWert, hinweis, knopf, pbDatum } from './team.js';

function tz() {
  return kontext.cfg.betrieb.zeitzone || 'Europe/Berlin';
}

export function montag(datum) {
  const [y, m, d] = datum.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return datumPlus(datum, -((w + 6) % 7));
}

export function kalenderwoche(datum) {
  const [y, m, d] = datum.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jahrStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - jahrStart) / 86400000 + 1) / 7);
}

function kurz(datum) {
  const [y, m, d] = datum.split('-');
  return `${d}.${m}.${y}`;
}

export function statusVon(code) {
  return kontext.cfg.status_liste.find((s) => s.code === code) || { code, name: code };
}

function typName(code) {
  const t = kontext.cfg.termintypen.find((x) => x.code === code);
  return t ? t.name : code;
}

function name(k) {
  return k ? [k.vorname, k.nachname].filter(Boolean).join(' ') || k.email : '–';
}

/** Bookings between two local dates (inclusive von, exclusive bis). */
export async function buchungenZwischen(von, bis, extraFilter = '') {
  const filter = `termin_start >= ${filterWert(pbDatum(utcAusLokal(von, '00:00', tz())))} && termin_start < ${filterWert(pbDatum(utcAusLokal(bis, '00:00', tz())))}${extraFilter}`;
  const q = new URLSearchParams({ filter, sort: 'termin_start', expand: 'kontakt,angebot', perPage: '500', skipTotal: '1' });
  return api('GET', `/api/collections/buchungen/records?${q}`);
}

function statusChip(b) {
  if (b.abgesagt_am) return el('span', { class: 'chip chip-abgesagt', text: 'abgesagt' });
  const s = statusVon(b.status);
  return el('span', { class: `chip${s.abschluss ? ' chip-fertig' : ''}`, text: s.name });
}

function zeile(b, mitDetails) {
  const k = b.expand?.kontakt;
  const a = b.expand?.angebot;
  const zeit = lokal(b.termin_start, tz()).zeit;
  return el('li', {},
    el('a', { class: `termin-zeile${b.abgesagt_am ? ' abgesagt' : ''}`, href: `#/buchung/${b.id}` },
      el('span', { class: 'zeit', text: zeit }),
      el('span', { class: 'wer' }, el('strong', { text: name(k) }),
        el('span', { class: 'klein block', text: `${a ? a.name : ''} · ${typName(b.termintyp)}${b.eltern_buchung ? ' (Folgetermin)' : ''}` }),
        mitDetails && k ? el('span', { class: 'klein block', text: [k.telefon, [k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(' · ') }) : null),
      statusChip(b)));
}

function tagListe(datum, buchungen, mitDetails) {
  const liste = buchungen.filter((b) => lokal(b.termin_start, tz()).datum === datum);
  const aktiv = liste.filter((b) => !b.abgesagt_am).length;
  return el('section', { class: `tag${datum === heute(tz()) ? ' heute' : ''}`, 'aria-label': formatDatum(datum) },
    el('h2', {}, el('a', { href: `#/tag/${datum}`, text: formatDatum(datum) }), el('span', { class: 'anzahl', text: aktiv ? ` · ${aktiv} Termin${aktiv === 1 ? '' : 'e'}` : '' })),
    liste.length ? el('ul', { class: 'termine' }, liste.map((b) => zeile(b, mitDetails))) : el('p', { class: 'leer', text: 'Keine Termine.' }));
}

export async function wocheAnsicht(arg) {
  const start = montag(/^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : heute(tz()));
  const r = await buchungenZwischen(start, datumPlus(start, 7));
  const kw = kalenderwoche(start);
  const kopf = el('div', { class: 'werkzeug' },
    el('a', { class: 'knopf klein', href: `#/woche/${datumPlus(start, -7)}`, 'aria-label': 'Vorherige Woche', text: '‹' }),
    el('h1', { text: `KW ${kw}` }),
    el('a', { class: 'knopf klein', href: `#/woche/${datumPlus(start, 7)}`, 'aria-label': 'Nächste Woche', text: '›' }),
    el('a', { class: 'knopf klein', href: `#/woche/${montag(heute(tz()))}`, text: 'Heute' }));
  const zeitraum = el('p', { class: 'klein', text: `${kurz(start)} – ${kurz(datumPlus(start, 6))}` });
  if (!r.ok) {
    hinweis(fehlerText(r), 'fehler');
    return { titel: `KW ${kw}`, element: el('section', {}, kopf, zeitraum) };
  }
  const tage = [0, 1, 2, 3, 4, 5, 6].map((i) => tagListe(datumPlus(start, i), r.json.items, false));
  return { titel: `KW ${kw}`, element: el('section', { class: 'woche' }, kopf, zeitraum, tage) };
}

export async function tagAnsicht(arg) {
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : heute(tz());
  const r = await buchungenZwischen(datum, datumPlus(datum, 1));
  const kopf = el('div', { class: 'werkzeug' },
    el('a', { class: 'knopf klein', href: `#/tag/${datumPlus(datum, -1)}`, 'aria-label': 'Vorheriger Tag', text: '‹' }),
    el('h1', { text: formatDatum(datum) }),
    el('a', { class: 'knopf klein', href: `#/tag/${datumPlus(datum, 1)}`, 'aria-label': 'Nächster Tag', text: '›' }),
    el('a', { class: 'knopf klein', href: `#/woche/${montag(datum)}`, text: 'Woche' }));
  if (!r.ok) hinweis(fehlerText(r), 'fehler');
  return { titel: formatDatum(datum), element: el('section', {}, kopf, tagListe(datum, r.ok ? r.json.items : [], true)) };
}

// ---------------------------------------------------------------- details

async function fotoToken() {
  const r = await api('POST', '/api/files/token');
  return r.ok ? r.json.token : '';
}

function fotos(b, token) {
  if (!b.fotos || !b.fotos.length) return null;
  const pfad = (datei, thumb) => `/api/files/buchungen/${b.id}/${encodeURIComponent(datei)}?token=${encodeURIComponent(token)}${thumb ? '&thumb=400x0' : ''}`;
  return el('section', { class: 'fotos' }, el('h2', { text: `Fotos (${b.fotos.length})` }),
    el('ul', {}, b.fotos.map((f, i) => el('li', {},
      el('a', { href: pfad(f, false), target: '_blank', rel: 'noopener noreferrer' },
        el('img', { src: pfad(f, true), alt: `Foto ${i + 1}`, loading: 'lazy' }))))));
}

function zusatzfelder(werte) {
  const defs = (kontext.cfg.formular.zusatzfelder || []);
  return defs.filter((d) => werte && werte[d.key] !== undefined && werte[d.key] !== '')
    .flatMap((d) => [el('dt', { text: d.label }), el('dd', { text: String(werte[d.key]) })]);
}

function zeitText(wert) {
  const l = lokal(wert, tz());
  return `${formatDatum(l.datum)}, ${l.zeit} Uhr`;
}

export async function buchungAnsicht(id) {
  if (!/^[a-z0-9]{15}$/.test(id)) return null;
  const r = await api('GET', `/api/collections/buchungen/records/${id}?expand=kontakt,angebot,eltern_buchung`);
  if (!r.ok) {
    hinweis(fehlerText(r), 'fehler');
    return { titel: 'Buchung', element: el('p', {}, el('a', { href: '#/woche', text: 'Zur Woche' })) };
  }
  const b = r.json;
  const k = b.expand?.kontakt || {};
  const a = b.expand?.angebot || {};
  const [log, token] = await Promise.all([
    api('GET', `/api/collections/status_log/records?${new URLSearchParams({ filter: `buchung = ${filterWert(id)}`, sort: '-zeit', perPage: '100' })}`),
    b.fotos && b.fotos.length ? fotoToken() : Promise.resolve(''),
  ]);
  const optionen = (a.zusatzoptionen || []).filter((o) => (b.zusatzoptionen || []).includes(o.code)).map((o) => o.name);
  const termin = lokal(b.termin_start, tz());

  const statusBox = el('section', { class: 'status-box' }, el('h2', { text: 'Status' }));
  const knoepfe = el('div', { class: 'status-knoepfe', role: 'group', 'aria-label': 'Status setzen' });
  if (b.abgesagt_am) {
    statusBox.append(el('p', { class: 'hinweis-box', text: `Abgesagt am ${zeitText(b.abgesagt_am)}.` }));
  } else {
    for (const s of kontext.cfg.status_liste) {
      const aktiv = s.code === b.status;
      knoepfe.append(el('button', {
        type: 'button',
        class: `knopf${aktiv ? ' haupt' : ''}`,
        'aria-pressed': String(aktiv),
        text: s.name + (s.mail && kontext.cfg.module.status ? ' ✉' : ''),
        title: s.mail && kontext.cfg.module.status ? 'Löst eine Mail an den Kunden aus' : undefined,
        disabled: aktiv,
        onclick: async () => {
          knoepfe.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          const p = await api('PATCH', `/api/collections/buchungen/records/${id}`, { status: s.code });
          if (!p.ok) {
            hinweis(fehlerText(p), 'fehler');
            knoepfe.querySelectorAll('button').forEach((x) => { x.disabled = x.getAttribute('aria-pressed') === 'true'; });
            return;
          }
          const neu = await buchungAnsicht(id);
          document.getElementById('app').replaceChildren(neu.element);
          hinweis(`Status „${s.name}“ gesetzt.${s.mail && kontext.cfg.module.status ? ' Die Mail an den Kunden wird verschickt.' : ''}`);
        },
      }));
    }
    statusBox.append(knoepfe, el('p', { class: 'klein', text: '✉ = der Kunde bekommt automatisch eine Mail.' }));
  }
  if (log.ok && log.json.items.length) {
    statusBox.append(el('h3', { text: 'Verlauf' }), el('ul', { class: 'verlauf' }, log.json.items.map((l) => el('li', {},
      `${zeitText(l.zeit)}: ${statusVon(l.status).name}`,
      l.mail_gesendet ? el('span', { class: 'klein', text: ' · Mail verschickt' }) : null))));
  }

  const adresse = [k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const element = el('section', { class: 'details' },
    el('p', {}, el('a', { href: `#/woche/${montag(termin.datum)}`, text: '‹ Zur Woche' })),
    el('h1', { text: name(k) }),
    b.abgesagt_am ? el('p', { class: 'chip chip-abgesagt', text: 'abgesagt' }) : null,
    el('dl', { class: 'auswahl' },
      el('dt', { text: 'Termin' }), el('dd', { text: `${zeitText(b.termin_start)} · ${typName(b.termintyp)}` }),
      el('dt', { text: 'Angebot' }), el('dd', { text: (a.name || '') + (optionen.length ? ` (+ ${optionen.join(', ')})` : '') }),
      b.eltern_buchung ? el('dt', { text: 'Folgetermin zu' }) : null,
      b.eltern_buchung ? el('dd', {}, el('a', { href: `#/buchung/${b.eltern_buchung}`, text: b.expand?.eltern_buchung ? zeitText(b.expand.eltern_buchung.termin_start) : 'Buchung' })) : null,
      zusatzfelder(b.zusatzfelder),
      b.bemerkung ? el('dt', { text: 'Bemerkung' }) : null,
      b.bemerkung ? el('dd', { class: 'mehrzeilig', text: b.bemerkung }) : null),
    statusBox,
    el('section', {}, el('h2', { text: 'Kontakt' }),
      el('dl', { class: 'auswahl' },
        el('dt', { text: 'Name' }), el('dd', { text: [k.anrede, k.vorname, k.nachname].filter(Boolean).join(' ') }),
        el('dt', { text: 'E-Mail' }), el('dd', {}, k.email ? el('a', { href: `mailto:${k.email}`, text: k.email }) : '–'),
        el('dt', { text: 'Telefon' }), el('dd', {}, k.telefon ? el('a', { href: `tel:${k.telefon.replace(/[^\d+]/g, '')}`, text: k.telefon }) : '–'),
        el('dt', { text: 'Adresse' }), el('dd', { text: adresse || '–' }),
        zusatzfelder(k.zusatzfelder),
        el('dt', { text: 'Werbe-Mails' }), el('dd', { text: k.abgemeldet ? 'abgemeldet' : k.einwilligung_email ? 'Einwilligung erteilt' : 'keine Einwilligung' }))),
    fotos(b, token));
  return { titel: name(k), element };
}
