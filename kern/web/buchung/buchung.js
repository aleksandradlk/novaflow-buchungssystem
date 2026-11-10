// Booking page: 1 offer → 2 appointment → 3 details (+ photos, consents) → 4 confirmation.
// State lives only in memory (no cookies, no storage); steps are mirrored in the
// browser history so the phone's back button works.

import {
  api, el, feld, feldFehlerLeeren, feldFehlerZeigen, fehlerText, formatTermin, meldung, query, rahmen, texter, vorlaeufig,
} from '/gemeinsam/nf.js';
import { kalender } from '/gemeinsam/kalender.js';

const app = document.getElementById('app');
const token = query('t');

const zustand = {
  daten: null,
  T: vorlaeufig,
  angebot: null,
  optionen: [],
  slot: null,
  formular: null, // keeps entered values between steps
  ergebnis: null,
  schritt: 1,
};

// ---------------------------------------------------------------- frame

function schrittleiste(nr) {
  const T = zustand.T;
  return el('ol', { class: 'schritte', 'aria-label': T('schritt', { nr, von: 4 }) },
    [1, 2, 3, 4].map((i) => el('li', {
      class: i === nr ? 'aktiv' : i < nr ? 'erledigt' : '',
      'aria-current': i === nr ? 'step' : undefined,
    }, el('span', { class: 'nr', text: String(i) }), el('span', { class: 'kurz', text: T(`schritt_${i}_kurz`) }))));
}

function zeige(nr, { history = true } = {}) {
  zustand.schritt = nr;
  meldung('');
  if (history) window.history.pushState({ schritt: nr }, '');
  const inhalt = [schritt1, schritt2, schritt3, schritt4][nr - 1]();
  app.replaceChildren(schrittleiste(nr), inhalt);
  const h = app.querySelector('h2');
  if (h) {
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', (e) => {
  const nr = (e.state && e.state.schritt) || 1;
  if (zustand.ergebnis) return zeige(4, { history: false });
  if (nr >= 2 && !zustand.angebot) return zeige(1, { history: false });
  if (nr >= 3 && !zustand.slot) return zeige(2, { history: false });
  zeige(Math.min(nr, 3), { history: false });
});

function auswahlBox() {
  const T = zustand.T;
  const a = zustand.angebot;
  const optionen = a.zusatzoptionen.filter((o) => zustand.optionen.includes(o.code)).map((o) => o.name);
  return el('dl', { class: 'auswahl', 'aria-label': T('ihre_auswahl') },
    el('dt', { text: T('angebot') }),
    el('dd', {}, a.name, optionen.length ? el('span', { class: 'klein', text: ` (+ ${optionen.join(', ')})` }) : null),
    zustand.slot ? el('dt', { text: T('termin') }) : null,
    zustand.slot ? el('dd', { text: formatTermin(zustand.slot.start, zustand.daten.seite.zeitzone, T) }) : null);
}

// ---------------------------------------------------------------- step 1: offer

function schritt1() {
  const T = zustand.T;
  const d = zustand.daten;
  const optionenBox = el('div', { class: 'optionen' });

  function optionenZeigen() {
    const a = zustand.angebot;
    if (!a || a.zusatzoptionen.length === 0) return optionenBox.replaceChildren();
    optionenBox.replaceChildren(el('fieldset', { class: 'gruppe' },
      el('legend', { text: T('zusatzoptionen') }),
      a.zusatzoptionen.map((o) => el('label', { class: 'wahl' },
        el('input', {
          type: 'checkbox', value: o.code, checked: zustand.optionen.includes(o.code),
          onchange: (e) => {
            zustand.optionen = e.target.checked
              ? [...zustand.optionen, o.code]
              : zustand.optionen.filter((c) => c !== o.code);
          },
        }),
        el('span', {}, el('strong', { text: o.name }), o.preis_text ? el('span', { class: 'preis', text: ` ${o.preis_text}` }) : null,
          o.beschreibung ? el('span', { class: 'klein block', text: o.beschreibung }) : null)))));
  }

  const karten = el('fieldset', { class: 'gruppe karten' },
    el('legend', { class: 'unsichtbar', text: T('angebot') }),
    d.angebote.map((a) => el('label', { class: 'karte' },
      el('input', {
        type: 'radio', name: 'angebot', value: a.code, checked: zustand.angebot && zustand.angebot.code === a.code,
        onchange: () => {
          if (!zustand.angebot || zustand.angebot.code !== a.code) {
            zustand.angebot = a;
            zustand.optionen = [];
            zustand.slot = null;
          }
          optionenZeigen();
        },
      }),
      el('span', { class: 'karte-inhalt' },
        el('span', { class: 'karte-titel', text: a.name }),
        a.preis_text ? el('span', { class: 'preis', text: a.preis_text }) : null,
        a.beschreibung ? el('span', { class: 'klein block', text: a.beschreibung }) : null))));

  optionenZeigen();
  return el('section', {},
    el('h1', { text: T('titel') }),
    el('p', { class: 'einleitung', text: T('einleitung') }),
    el('h2', { text: T('schritt_angebot') }),
    karten,
    optionenBox,
    el('div', { class: 'aktionen' },
      el('button', {
        type: 'button', class: 'knopf haupt', text: T('weiter'),
        onclick: () => (zustand.angebot ? zeige(2) : meldung(T('fehler_angebot_waehlen'))),
      })));
}

// ---------------------------------------------------------------- step 2: appointment

function schritt2() {
  const T = zustand.T;
  const d = zustand.daten;
  const a = zustand.angebot;
  const weiter = el('button', {
    type: 'button', class: 'knopf haupt', text: T('weiter'), disabled: !zustand.slot,
    onclick: () => (zustand.slot ? zeige(3) : meldung(T('fehler_termin_waehlen'))),
  });
  const kal = kalender({
    T,
    zeitzone: d.seite.zeitzone,
    typ: a.termintyp,
    angebot: a.code,
    optionen: zustand.optionen,
    zeitraum: d.zeitraum,
    startDatum: zustand.slot ? zustand.slot.datum : undefined,
    label: T('schritt_termin'),
    onWahl: (s) => {
      zustand.slot = s;
      weiter.disabled = !s;
    },
  });
  return el('section', {},
    el('h2', { text: T('schritt_termin') }),
    auswahlBox(),
    T('hinweis_termin') ? el('p', { class: 'hinweis-box', text: T('hinweis_termin') }) : null,
    kal.element,
    el('div', { class: 'aktionen' },
      el('button', { type: 'button', class: 'knopf', text: T('zurueck'), onclick: () => window.history.back() }),
      weiter));
}

// ---------------------------------------------------------------- step 3: details

function eingabe(attrs) {
  return el('input', { type: 'text', ...attrs });
}

function schritt3() {
  const T = zustand.T;
  const d = zustand.daten;
  const f = d.formular;
  const vorbelegt = zustand.formular || d.kontakt || {};
  const zf = (vorbelegt.zusatzfelder) || {};
  const wert = (k) => vorbelegt[k] || '';

  const felder = [];
  felder.push(feld({
    key: 'kontakt.anrede', label: T('feld_anrede'),
    eingabe: el('select', { name: 'anrede', autocomplete: 'honorific-prefix' },
      ['', 'Frau', 'Herr'].map((v) => el('option', {
        value: v, selected: wert('anrede') === v,
        text: v === '' ? T('feld_anrede_keine') : T(v === 'Frau' ? 'feld_anrede_frau' : 'feld_anrede_herr'),
      }))),
  }));
  felder.push(feld({ key: 'kontakt.vorname', label: T('feld_vorname'), pflicht: true, eingabe: eingabe({ name: 'vorname', autocomplete: 'given-name', value: wert('vorname'), maxlength: 100 }) }));
  felder.push(feld({ key: 'kontakt.nachname', label: T('feld_nachname'), pflicht: true, eingabe: eingabe({ name: 'nachname', autocomplete: 'family-name', value: wert('nachname'), maxlength: 100 }) }));
  felder.push(feld({ key: 'kontakt.email', label: T('feld_email'), pflicht: true, eingabe: eingabe({ name: 'email', type: 'email', autocomplete: 'email', inputmode: 'email', value: wert('email'), maxlength: 254 }) }));
  if (f.telefon !== 'aus') {
    felder.push(feld({ key: 'kontakt.telefon', label: T('feld_telefon'), pflicht: f.telefon === 'pflicht', eingabe: eingabe({ name: 'telefon', type: 'tel', autocomplete: 'tel', value: wert('telefon'), maxlength: 30 }) }));
  }
  if (f.adresse !== 'aus') {
    const p = f.adresse === 'pflicht';
    felder.push(feld({ key: 'kontakt.strasse', label: T('feld_strasse'), pflicht: p, eingabe: eingabe({ name: 'strasse', autocomplete: 'street-address', value: wert('strasse'), maxlength: 200 }) }));
    felder.push(el('div', { class: 'zeile' },
      feld({ key: 'kontakt.plz', label: T('feld_plz'), pflicht: p, eingabe: eingabe({ name: 'plz', autocomplete: 'postal-code', inputmode: 'numeric', value: wert('plz'), maxlength: 5 }) }),
      feld({ key: 'kontakt.ort', label: T('feld_ort'), pflicht: p, eingabe: eingabe({ name: 'ort', autocomplete: 'address-level2', value: wert('ort'), maxlength: 100 }) })));
  }

  for (const z of f.zusatzfelder || []) {
    const name = `zf_${z.key}`;
    const v = zf[z.key] !== undefined ? String(zf[z.key]) : '';
    let e;
    if (z.typ === 'auswahl') {
      e = el('select', { name }, el('option', { value: '', text: '–' }), z.optionen.map((o) => el('option', { value: o, selected: v === o, text: o })));
    } else if (z.typ === 'mehrzeilig') {
      e = el('textarea', { name, rows: 3, maxlength: 2000 }, v);
    } else if (z.typ === 'zahl') {
      e = eingabe({ name, inputmode: 'decimal', value: v });
    } else {
      e = eingabe({ name, value: v, maxlength: 200 });
    }
    felder.push(feld({ key: `zusatzfelder.${z.key}`, label: z.label, pflicht: z.pflicht, eingabe: e }));
  }

  felder.push(feld({ key: 'bemerkung', label: `${T('feld_bemerkung')} (${T('optional')})`, eingabe: el('textarea', { name: 'bemerkung', rows: 3, maxlength: 2000 }, wert('bemerkung')) }));

  if (f.fotos && f.fotos.erlaubt) {
    felder.push(feld({
      key: 'fotos',
      label: `${T('feld_fotos')} (${T('optional')})`,
      hinweis: T('fotos_hinweis', { anzahl: f.fotos.max_anzahl, mb: f.fotos.max_mb }),
      eingabe: el('input', { type: 'file', name: 'fotos', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif', multiple: f.fotos.max_anzahl > 1 }),
    }));
  }

  const einwilligungen = d.einwilligungen.length ? el('fieldset', { class: 'gruppe' },
    el('legend', { text: T('einwilligungen') }),
    d.einwilligungen.map((w) => el('div', { class: 'feld', 'data-feld': `einwilligungen.${w.kanal}` },
      el('label', { class: 'wahl' },
        el('input', { type: 'checkbox', name: `einwilligung_${w.kanal}`, checked: !!(zustand.formular && zustand.formular.einwilligungen && zustand.formular.einwilligungen[w.kanal]) }),
        el('span', { text: w.text }))))) : null;

  const knopf = el('button', { type: 'submit', class: 'knopf haupt', text: T('buchen') });
  const form = el('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); absenden(form, knopf); } },
    el('p', { class: 'klein', text: T('pflichtfelder') }),
    felder,
    einwilligungen,
    el('p', { class: 'klein datenschutz' }, `${T('datenschutz_hinweis')} `,
      el('a', { href: d.seite.rechtliches.datenschutz_url, rel: 'noopener noreferrer', target: '_blank', text: T('datenschutzerklaerung') }), '.'),
    el('div', { class: 'aktionen' },
      el('button', { type: 'button', class: 'knopf', text: T('zurueck'), onclick: () => { merken(form); window.history.back(); } }),
      knopf));

  return el('section', {}, el('h2', { text: T('schritt_daten') }), auswahlBox(), form);
}

function formularWerte(form) {
  const v = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
  const zusatzfelder = {};
  for (const z of zustand.daten.formular.zusatzfelder || []) {
    const w = v(`zf_${z.key}`);
    if (w !== '') zusatzfelder[z.key] = w;
  }
  const einwilligungen = {};
  for (const w of zustand.daten.einwilligungen) {
    einwilligungen[w.kanal] = !!form.elements[`einwilligung_${w.kanal}`]?.checked;
  }
  return {
    anrede: v('anrede'), vorname: v('vorname'), nachname: v('nachname'), email: v('email'), telefon: v('telefon'),
    strasse: v('strasse'), plz: v('plz'), ort: v('ort'), bemerkung: v('bemerkung'), zusatzfelder, einwilligungen,
  };
}

function merken(form) {
  zustand.formular = formularWerte(form);
}

async function absenden(form, knopf) {
  const T = zustand.T;
  const f = zustand.daten.formular;
  feldFehlerLeeren(form);
  meldung('');
  merken(form);
  const w = zustand.formular;

  const dateien = form.elements.fotos ? [...form.elements.fotos.files] : [];
  if (dateien.length && f.fotos) {
    let text = '';
    if (dateien.length > f.fotos.max_anzahl) text = T('fotos_zu_viele', { anzahl: f.fotos.max_anzahl });
    else if (dateien.some((x) => x.size > f.fotos.max_mb * 1024 * 1024)) text = T('fotos_zu_gross', { mb: f.fotos.max_mb });
    if (text) {
      feldFehlerZeigen(form, { fotos: { message: text } });
      return;
    }
  }

  const daten = {
    angebot: zustand.angebot.code,
    zusatzoptionen: zustand.optionen,
    start: zustand.slot.start,
    kontakt: {
      anrede: w.anrede, vorname: w.vorname, nachname: w.nachname, email: w.email,
      telefon: w.telefon, strasse: w.strasse, plz: w.plz, ort: w.ort,
    },
    zusatzfelder: w.zusatzfelder,
    einwilligungen: w.einwilligungen,
    bemerkung: w.bemerkung,
  };

  let body = daten;
  if (dateien.length) {
    body = new FormData();
    body.set('daten', JSON.stringify(daten));
    dateien.forEach((x) => body.append('fotos', x, x.name));
  }

  knopf.disabled = true;
  knopf.textContent = T('senden');
  const r = await api('POST', `/api/nf/buchen${token ? `?t=${encodeURIComponent(token)}` : ''}`, body);
  knopf.disabled = false;
  knopf.textContent = T('buchen');

  if (r.status === 201) {
    zustand.ergebnis = r.json;
    zeige(4);
    return;
  }
  if (r.status === 409) {
    zustand.slot = null;
    zeige(2);
    meldung(r.json.message || T('fehler_slot_weg'));
    return;
  }
  if (r.status === 400 && r.json.data && Object.keys(r.json.data).length) {
    const rest = feldFehlerZeigen(form, r.json.data);
    if (rest.includes('angebot') || rest.includes('zusatzoptionen')) {
      zeige(1);
      meldung(T('fehler_angebot_waehlen'));
    } else if (rest.includes('start')) {
      zeige(2);
      meldung(T('fehler_termin_waehlen'));
    } else if (rest.length === Object.keys(r.json.data).length) {
      meldung(r.json.message || T('fehler_eingaben'));
    }
    return;
  }
  meldung(fehlerText(r, T));
}

// ---------------------------------------------------------------- step 4: confirmation

function schritt4() {
  const T = zustand.T;
  const e = zustand.ergebnis;
  const link = `/verwalten/?t=${encodeURIComponent(e.verwalten_token)}`;
  return el('section', { class: 'bestaetigung' },
    el('h2', { text: T('bestaetigung_titel') }),
    el('p', { class: 'erfolg', text: T('bestaetigung', { vorname: e.buchung.kontakt.vorname }) }),
    auswahlBox(),
    el('p', {}, el('a', { class: 'knopf', href: link, text: T('bestaetigung_verwalten') })),
    el('p', { class: 'klein', text: T('bestaetigung_verwalten_hinweis') }));
}

// ---------------------------------------------------------------- start

async function start() {
  const r = await api('GET', `/api/nf/angebot${token ? `?t=${encodeURIComponent(token)}` : ''}`);
  if (!r.ok) {
    app.replaceChildren();
    meldung(fehlerText(r, vorlaeufig));
    return;
  }
  zustand.daten = r.json;
  zustand.T = texter(r.json.seite);
  rahmen(r.json.seite, zustand.T, zustand.T('titel'));
  window.history.replaceState({ schritt: 1 }, '');
  zeige(1, { history: false });
}

start();
