// Administration (inhaber only): settings, offers, appointment rules, blocked days, users.
// The JSON files in kunden/<kunde>/ are only start values; from here on the owner maintains them.

import { el, feld, feldFehlerLeeren, feldFehlerZeigen, formatDatum, heute } from '/gemeinsam/nf.js';
import { cfgAus, kontext } from './app.js';
import { alle, aktuell, api, feldFehler, fehlerText, hinweis } from './team.js';
import { exportBereich, importBereich, kampagneBereich } from './ansicht-daten.js';

const BEREICHE = [
  ['einstellungen', 'Einstellungen'],
  ['angebote', 'Angebote'],
  ['terminregeln', 'Terminregeln'],
  ['sperrtage', 'Sperrtage'],
  ['benutzer', 'Benutzer'],
  ['import', 'Import', 'import'],
  ['kampagne', 'Kampagne', 'kampagne'],
  ['export', 'Export', 'export'],
];

/** Areas of booked modules only. */
function bereiche() {
  return BEREICHE.filter(([, , modul]) => !modul || kontext.cfg.module[modul]);
}
const WOCHENTAGE = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// ---------------------------------------------------------------- helpers

function eingabe(attrs) {
  return el('input', { type: 'text', ...attrs });
}

function fehlerAnzeigen(form, r) {
  const felder = feldFehler(r);
  const data = Object.fromEntries(Object.entries(felder).map(([k, v]) => [k, { message: v }]));
  const rest = feldFehlerZeigen(form, data);
  hinweis(rest.length || !Object.keys(data).length ? `${fehlerText(r)} ${rest.map((k) => `${k}: ${felder[k]}`).join(' ')}`.trim() : 'Bitte die markierten Angaben prüfen.', 'fehler');
}

/** Lower-case code from a name, unique within `vorhanden`. */
export function codeAus(name, vorhanden = []) {
  let basis = String(name).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 34) || 'angebot';
  if (!/^[a-z]/.test(basis)) basis = `a_${basis}`;
  let code = basis;
  for (let i = 2; vorhanden.includes(code); i++) code = `${basis}_${i}`;
  return code;
}

async function cfgNeuLaden() {
  const r = await api('GET', `/api/collections/einstellungen/records/${kontext.cfg.id}`);
  if (r.ok) kontext.cfg = cfgAus(r.json);
}

/** Field with ids unique per form (prefix). */
function feldP(prefix, opts) {
  opts.eingabe.id = `${prefix}-${opts.key}`;
  return feld(opts);
}

function speichernKnopf(text = 'Speichern') {
  return el('button', { type: 'submit', class: 'knopf haupt', text });
}

async function absenden(form, knopf, aufruf, erfolg) {
  feldFehlerLeeren(form);
  hinweis('');
  knopf.disabled = true;
  const r = await aufruf();
  knopf.disabled = false;
  if (!r.ok) {
    fehlerAnzeigen(form, r);
    return null;
  }
  hinweis(erfolg);
  return r;
}

// ---------------------------------------------------------------- settings

function einstellungen() {
  const c = kontext.cfg.roh;
  const m = kontext.cfg.module;
  const knopf = speichernKnopf();
  const kapazitaeten = kontext.cfg.ressourcen.map((r) => feld({
    key: `ressource_${r.code}`, label: `Kapazität: ${r.name}`,
    eingabe: eingabe({ name: `ressource_${r.code}`, type: 'number', min: 1, value: r.kapazitaet }),
  }));
  const form = el('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const v = (n) => form.elements[n] && form.elements[n].value.trim();
      const daten = {
        buchbar_ab: v('buchbar_ab'),
        buchbar_bis: v('buchbar_bis'),
        max_pro_woche: Number(v('max_pro_woche') || 0),
        ansprache: v('ansprache'),
        mail_modus: v('mail_modus'),
        test_empfaenger: v('test_empfaenger'),
        ressourcen: kontext.cfg.ressourcen.map((r) => ({ ...r, kapazitaet: Number(v(`ressource_${r.code}`)) || r.kapazitaet })),
      };
      if (m.folgetermin) {
        daten.folgetermin_ab = v('folgetermin_ab');
        daten.folgetermin_bis = v('folgetermin_bis');
      }
      if (daten.mail_modus === 'live' && c.mail_modus !== 'live'
        && !window.confirm('Live-Betrieb: Ab jetzt gehen alle Mails an die echten Kunden. Fortfahren?')) return;
      const r = await absenden(form, knopf, () => api('PATCH', `/api/collections/einstellungen/records/${kontext.cfg.id}`, daten), 'Einstellungen gespeichert.');
      if (r) kontext.cfg = cfgAus(r.json);
    },
  },
  el('h2', { text: 'Buchungszeitraum' }),
  el('div', { class: 'zeile2' },
    feld({ key: 'buchbar_ab', label: 'Buchbar ab', eingabe: eingabe({ name: 'buchbar_ab', type: 'date', value: c.buchbar_ab }) }),
    feld({ key: 'buchbar_bis', label: 'Buchbar bis', eingabe: eingabe({ name: 'buchbar_bis', type: 'date', value: c.buchbar_bis }) })),
  m.folgetermin ? el('div', { class: 'zeile2' },
    feld({ key: 'folgetermin_ab', label: 'Folgetermin ab', eingabe: eingabe({ name: 'folgetermin_ab', type: 'date', value: c.folgetermin_ab }) }),
    feld({ key: 'folgetermin_bis', label: 'Folgetermin bis', eingabe: eingabe({ name: 'folgetermin_bis', type: 'date', value: c.folgetermin_bis }) })) : null,
  el('h2', { text: 'Kapazitäten' }),
  feld({ key: 'max_pro_woche', label: 'Höchstens Termine pro Woche (0 = unbegrenzt)', eingabe: eingabe({ name: 'max_pro_woche', type: 'number', min: 0, value: c.max_pro_woche || 0 }) }),
  kapazitaeten,
  el('h2', { text: 'Mails' }),
  feld({
    key: 'ansprache', label: 'Ansprache',
    eingabe: el('select', { name: 'ansprache' }, el('option', { value: 'sie', selected: c.ansprache === 'sie', text: 'Sie' }), el('option', { value: 'du', selected: c.ansprache === 'du', text: 'du' })),
  }),
  feld({
    key: 'mail_modus', label: 'Versand',
    hinweis: 'Im Testmodus gehen alle Mails an die Test-Adresse.',
    eingabe: el('select', { name: 'mail_modus' }, el('option', { value: 'test', selected: c.mail_modus === 'test', text: 'Testmodus' }), el('option', { value: 'live', selected: c.mail_modus === 'live', text: 'Live (an echte Kunden)' })),
  }),
  feld({ key: 'test_empfaenger', label: 'Test-Adresse', eingabe: eingabe({ name: 'test_empfaenger', type: 'email', value: c.test_empfaenger }) }),
  el('div', { class: 'aktionen links' }, knopf));
  return form;
}

// ---------------------------------------------------------------- offers

function optionenEditor(optionen) {
  const box = el('div', { class: 'optionen-editor' });
  const zeileAus = (o = {}) => {
    const z = el('div', { class: 'option-zeile', 'data-code': o.code || '' },
      eingabe({ 'aria-label': 'Name der Zusatzoption', placeholder: 'Name', value: o.name || '', 'data-teil': 'name' }),
      eingabe({ 'aria-label': 'Preis-Anzeige der Zusatzoption', placeholder: 'Preis, z. B. + 10 €', value: o.preis_text || '', 'data-teil': 'preis_text' }),
      el('button', { type: 'button', class: 'knopf klein', text: 'Entfernen', onclick: () => z.remove() }));
    return z;
  };
  box.append(...optionen.map(zeileAus));
  const liste = el('div', {}, el('p', { class: 'feld-titel', text: 'Zusatzoptionen' }), box,
    el('button', { type: 'button', class: 'knopf klein', text: 'Zusatzoption hinzufügen', onclick: () => box.append(zeileAus()) }));
  liste.werte = (alteOptionen) => {
    const codes = [];
    return [...box.querySelectorAll('.option-zeile')].map((z) => {
      const name = z.querySelector('[data-teil=name]').value.trim();
      if (!name) return null;
      const alt = alteOptionen.find((o) => o.code === z.dataset.code);
      const code = z.dataset.code || codeAus(name, codes.concat(alteOptionen.map((o) => o.code)));
      codes.push(code);
      return { ...(alt || {}), code, name, preis_text: z.querySelector('[data-teil=preis_text]').value.trim() };
    }).filter(Boolean);
  };
  return liste;
}

function angebotForm(a, typen, ressourcen, neu, nachSpeichern) {
  const knopf = speichernKnopf(neu ? 'Angebot anlegen' : 'Speichern');
  const optionen = optionenEditor(a.zusatzoptionen || []);
  const id = neu ? 'neu' : a.id;
  const form = el('form', {
    class: 'karte-box', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const v = (n) => form.elements[n].value.trim();
      const daten = {
        name: v('name'),
        beschreibung: v('beschreibung'),
        preis_text: v('preis_text'),
        sortierung: Number(v('sortierung') || 0),
        aktiv: form.elements.aktiv.checked,
        zusatzoptionen: optionen.werte(a.zusatzoptionen || []),
      };
      if (form.elements.folgetermin) daten.folgetermin = form.elements.folgetermin.checked;
      if (neu) {
        daten.code = codeAus(daten.name, nachSpeichern.codes);
        daten.termintyp = v('termintyp');
        daten.ressource = v('ressource');
      }
      const r = await absenden(form, knopf, () => (neu
        ? api('POST', '/api/collections/angebote/records', daten)
        : api('PATCH', `/api/collections/angebote/records/${a.id}`, daten)), neu ? 'Angebot angelegt.' : 'Angebot gespeichert.');
      if (r) nachSpeichern();
    },
  },
  el('h3', { text: neu ? 'Neues Angebot' : a.name }),
  neu ? null : el('p', { class: 'klein', text: `Termintyp: ${(typen.find((t) => t.code === a.termintyp) || {}).name || a.termintyp}${a.ressource ? ` · belegt: ${(ressourcen.find((r) => r.code === a.ressource) || {}).name || a.ressource}` : ''}` }),
  feldP(`a-${id}`, { key: 'name', label: 'Name', pflicht: true, eingabe: eingabe({ name: 'name', value: a.name || '', maxlength: 200 }) }),
  feldP(`a-${id}`, { key: 'beschreibung', label: 'Beschreibung', eingabe: el('textarea', { name: 'beschreibung', rows: 2, maxlength: 2000 }, a.beschreibung || '') }),
  el('div', { class: 'zeile2' },
    feldP(`a-${id}`, { key: 'preis_text', label: 'Preis-Anzeige', eingabe: eingabe({ name: 'preis_text', value: a.preis_text || '', maxlength: 200 }) }),
    feldP(`a-${id}`, { key: 'sortierung', label: 'Reihenfolge', eingabe: eingabe({ name: 'sortierung', type: 'number', min: 0, value: a.sortierung || 0 }) })),
  neu ? el('div', { class: 'zeile2' },
    feldP(`a-${id}`, { key: 'termintyp', label: 'Termintyp', eingabe: el('select', { name: 'termintyp' }, typen.filter((t) => t.code !== kontext.cfg.roh.folgetermin_typ).map((t) => el('option', { value: t.code, text: t.name }))) }),
    feldP(`a-${id}`, { key: 'ressource', label: 'Belegt Ressource', eingabe: el('select', { name: 'ressource' }, el('option', { value: '', text: 'keine' }), ressourcen.map((r) => el('option', { value: r.code, text: r.name }))) })) : null,
  optionen,
  el('label', { class: 'wahl' }, el('input', { type: 'checkbox', name: 'aktiv', checked: neu ? true : !!a.aktiv }), el('span', { text: 'Online buchbar' })),
  kontext.cfg.module.folgetermin ? el('label', { class: 'wahl' }, el('input', { type: 'checkbox', name: 'folgetermin', checked: !!a.folgetermin }), el('span', { text: 'Berechtigt zum Folgetermin' })) : null,
  el('div', { class: 'aktionen links' }, knopf));
  return form;
}

async function angebote(neuZeichnen) {
  const r = await alle('angebote', { sort: 'sortierung,name' });
  if (!r.ok) return el('p', { text: fehlerText(r.r) });
  const typen = kontext.cfg.termintypen;
  const ressourcen = kontext.cfg.ressourcen;
  const nachSpeichern = () => neuZeichnen();
  nachSpeichern.codes = r.items.map((a) => a.code);
  return el('div', { class: 'stapel' },
    r.items.map((a) => angebotForm(a, typen, ressourcen, false, nachSpeichern)),
    angebotForm({}, typen, ressourcen, true, nachSpeichern));
}

// ---------------------------------------------------------------- rules

function regelForm(regel, typ, nachSpeichern) {
  const neu = !regel.id;
  const knopf = speichernKnopf(neu ? 'Regel anlegen' : 'Speichern');
  const zahl = (name, label, wert, min) => feldP(`r-${regel.id || `neu-${typ.code}`}`, { key: name, label, eingabe: eingabe({ name, type: 'number', min, value: wert ?? '' }) });
  const zeit = (name, label, wert) => feldP(`r-${regel.id || `neu-${typ.code}`}`, { key: name, label, eingabe: eingabe({ name, type: 'time', value: wert || '' }) });
  const form = el('form', {
    class: 'regel', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const v = (n) => form.elements[n].value.trim();
      const daten = {
        termintyp: typ.code,
        wochentag: Number(v('wochentag')),
        von: v('von'),
        bis: v('bis'),
        takt_minuten: Number(v('takt_minuten')),
        max_pro_slot: Number(v('max_pro_slot')),
        max_pro_tag: Number(v('max_pro_tag') || 0),
        gueltig_von: v('gueltig_von'),
        gueltig_bis: v('gueltig_bis'),
      };
      const r = await absenden(form, knopf, () => (neu
        ? api('POST', '/api/collections/terminregeln/records', daten)
        : api('PATCH', `/api/collections/terminregeln/records/${regel.id}`, daten)), neu ? 'Regel angelegt.' : 'Regel gespeichert.');
      if (r) nachSpeichern();
    },
  },
  el('div', { class: 'regel-felder' },
    feldP(`r-${regel.id || `neu-${typ.code}`}`, { key: 'wochentag', label: 'Wochentag', eingabe: el('select', { name: 'wochentag' }, [1, 2, 3, 4, 5, 6, 7].map((w) => el('option', { value: w, selected: Number(regel.wochentag) === w, text: WOCHENTAGE[w] }))) }),
    zeit('von', 'Von', regel.von),
    zeit('bis', 'Bis', regel.bis),
    zahl('takt_minuten', 'Takt (Min.)', regel.takt_minuten ?? typ.dauer_minuten, 5),
    zahl('max_pro_slot', 'Plätze je Termin', regel.max_pro_slot ?? 1, 1),
    zahl('max_pro_tag', 'Höchstens pro Tag (0 = egal)', regel.max_pro_tag ?? 0, 0),
    feldP(`r-${regel.id || `neu-${typ.code}`}`, { key: 'gueltig_von', label: 'Gültig ab (optional)', eingabe: eingabe({ name: 'gueltig_von', type: 'date', value: regel.gueltig_von || '' }) }),
    feldP(`r-${regel.id || `neu-${typ.code}`}`, { key: 'gueltig_bis', label: 'Gültig bis (optional)', eingabe: eingabe({ name: 'gueltig_bis', type: 'date', value: regel.gueltig_bis || '' }) })),
  el('div', { class: 'aktionen links' }, knopf,
    neu ? null : el('button', {
      type: 'button', class: 'knopf warnung', text: 'Löschen',
      onclick: async () => {
        if (!window.confirm(`Regel ${WOCHENTAGE[regel.wochentag]} ${regel.von}–${regel.bis} löschen?`)) return;
        const r = await api('DELETE', `/api/collections/terminregeln/records/${regel.id}`);
        if (!r.ok) return hinweis(fehlerText(r), 'fehler');
        hinweis('Regel gelöscht.');
        nachSpeichern();
      },
    })));
  return form;
}

async function terminregeln(neuZeichnen) {
  const r = await alle('terminregeln', { sort: 'termintyp,wochentag,von' });
  if (!r.ok) return el('p', { text: fehlerText(r.r) });
  return el('div', { class: 'stapel' }, kontext.cfg.termintypen.map((typ) => el('section', { class: 'karte-box' },
    el('h3', { text: `${typ.name} (${typ.dauer_minuten} Min.)` }),
    r.items.filter((x) => x.termintyp === typ.code).map((x) => regelForm(x, typ, neuZeichnen)),
    el('details', {}, el('summary', { text: 'Neue Regel' }), regelForm({}, typ, neuZeichnen)))));
}

// ---------------------------------------------------------------- blocked days

async function sperrtage(neuZeichnen) {
  const tz = kontext.cfg.betrieb.zeitzone || 'Europe/Berlin';
  const r = await alle('sperrtage', { sort: 'datum', filter: `datum >= "${heute(tz)}"` });
  if (!r.ok) return el('p', { text: fehlerText(r.r) });
  const knopf = speichernKnopf('Sperrtag hinzufügen');
  const form = el('form', {
    class: 'karte-box', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const daten = { datum: form.elements.datum.value, grund: form.elements.grund.value.trim() };
      const a = await absenden(form, knopf, () => api('POST', '/api/collections/sperrtage/records', daten), 'Sperrtag hinzugefügt.');
      if (a) neuZeichnen();
    },
  },
  el('h3', { text: 'Neuer Sperrtag' }),
  el('div', { class: 'zeile2' },
    feld({ key: 'datum', label: 'Datum', pflicht: true, eingabe: eingabe({ name: 'datum', type: 'date' }) }),
    feld({ key: 'grund', label: 'Grund (optional)', eingabe: eingabe({ name: 'grund', maxlength: 200 }) })),
  el('div', { class: 'aktionen links' }, knopf));
  return el('div', { class: 'stapel' },
    el('p', { class: 'klein', text: 'An Sperrtagen sind keine Termine buchbar. Bestehende Buchungen bleiben bestehen.' }),
    r.items.length ? el('ul', { class: 'liste' }, r.items.map((s) => el('li', {},
      el('span', { text: `${formatDatum(s.datum)}${s.grund ? ` – ${s.grund}` : ''}` }),
      el('button', {
        type: 'button', class: 'knopf klein warnung', text: 'Entfernen', 'aria-label': `Sperrtag ${formatDatum(s.datum)} entfernen`,
        onclick: async () => {
          const d = await api('DELETE', `/api/collections/sperrtage/records/${s.id}`);
          if (!d.ok) return hinweis(fehlerText(d), 'fehler');
          hinweis('Sperrtag entfernt.');
          neuZeichnen();
        },
      })))) : el('p', { class: 'leer', text: 'Keine künftigen Sperrtage.' }),
    form);
}

// ---------------------------------------------------------------- users

async function benutzer(neuZeichnen) {
  const r = await alle('users', { sort: 'rolle,name' });
  if (!r.ok) return el('p', { text: fehlerText(r.r) });
  const ich = aktuell().record.id;
  const max = kontext.cfg.rollen.max_mitarbeiter ?? 0;
  const anzahl = r.items.filter((u) => u.rolle === 'mitarbeiter').length;
  const knopf = speichernKnopf('Zugang anlegen');
  const form = el('form', {
    class: 'karte-box', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const v = (n) => form.elements[n].value.trim();
      const daten = { name: v('name'), email: v('email'), rolle: v('rolle'), password: form.elements.password.value, passwordConfirm: form.elements.password.value };
      const a = await absenden(form, knopf, () => api('POST', '/api/collections/users/records', daten), 'Zugang angelegt. Die Anmeldung erfolgt mit Passwort und Code per E-Mail.');
      if (a) neuZeichnen();
    },
  },
  el('h3', { text: 'Neuer Zugang' }),
  feld({ key: 'name', label: 'Name', pflicht: true, eingabe: eingabe({ name: 'name', maxlength: 100 }) }),
  feld({ key: 'email', label: 'E-Mail', pflicht: true, eingabe: eingabe({ name: 'email', type: 'email' }) }),
  feld({ key: 'rolle', label: 'Rolle', eingabe: el('select', { name: 'rolle' }, el('option', { value: 'mitarbeiter', text: 'Mitarbeiter (sehen + Status setzen)' }), el('option', { value: 'inhaber', text: 'Inhaber (alles)' })) }),
  feld({ key: 'password', label: 'Startpasswort (mind. 8 Zeichen)', pflicht: true, eingabe: eingabe({ name: 'password', type: 'password', autocomplete: 'new-password' }) }),
  el('div', { class: 'aktionen links' }, knopf));

  return el('div', { class: 'stapel' },
    el('p', { class: 'klein', text: `${anzahl} von ${max} Mitarbeiter-Zugängen belegt.` }),
    el('ul', { class: 'liste' }, r.items.map((u) => el('li', {},
      el('span', {}, el('strong', { text: u.name || u.email }), el('span', { class: 'klein block', text: `${u.email} · ${u.rolle === 'inhaber' ? 'Inhaber' : 'Mitarbeiter'}${u.id === ich ? ' (Sie)' : ''}` })),
      el('span', { class: 'knopf-gruppe' },
        el('button', {
          type: 'button', class: 'knopf klein', text: 'Neues Passwort', 'aria-label': `Neues Passwort für ${u.email}`,
          onclick: async () => {
            const pw = window.prompt(`Neues Passwort für ${u.email} (mind. 8 Zeichen):`);
            if (!pw) return;
            const p = await api('PATCH', `/api/collections/users/records/${u.id}`, { password: pw, passwordConfirm: pw, ...(u.id === ich ? { oldPassword: window.prompt('Bitte das bisherige Passwort eingeben:') || '' } : {}) });
            if (!p.ok) return hinweis(Object.values(feldFehler(p))[0] || fehlerText(p), 'fehler');
            hinweis('Passwort geändert.');
          },
        }),
        u.id === ich ? null : el('button', {
          type: 'button', class: 'knopf klein warnung', text: 'Löschen', 'aria-label': `Zugang ${u.email} löschen`,
          onclick: async () => {
            if (!window.confirm(`Zugang ${u.email} löschen?`)) return;
            const d = await api('DELETE', `/api/collections/users/records/${u.id}`);
            if (!d.ok) return hinweis(fehlerText(d), 'fehler');
            hinweis('Zugang gelöscht.');
            neuZeichnen();
          },
        }))))),
    form);
}

// ---------------------------------------------------------------- frame

export async function verwaltungAnsicht(arg) {
  const sichtbar = bereiche();
  const bereich = sichtbar.some(([k]) => k === arg) ? arg : 'einstellungen';
  const box = el('div', { class: 'verwaltung-inhalt' });
  const neuZeichnen = async () => {
    const inhalt = await {
      einstellungen: async () => { await cfgNeuLaden(); return einstellungen(); },
      angebote: () => angebote(neuZeichnen),
      terminregeln: () => terminregeln(neuZeichnen),
      sperrtage: () => sperrtage(neuZeichnen),
      benutzer: () => benutzer(neuZeichnen),
      import: async () => importBereich(),
      kampagne: () => kampagneBereich(neuZeichnen),
      export: async () => exportBereich(),
    }[bereich]();
    box.replaceChildren(inhalt);
  };
  await neuZeichnen();
  const titel = sichtbar.find(([k]) => k === bereich)[1];
  return {
    titel: `Verwaltung: ${titel}`,
    element: el('section', { class: 'verwaltung' },
      el('h1', { text: 'Verwaltung' }),
      el('nav', { class: 'reiter', 'aria-label': 'Bereiche der Verwaltung' },
        sichtbar.map(([k, t]) => el('a', { href: `#/verwaltung/${k}`, 'aria-current': k === bereich ? 'page' : undefined, text: t }))),
      el('h2', { class: 'unsichtbar', text: titel }),
      box),
  };
}
