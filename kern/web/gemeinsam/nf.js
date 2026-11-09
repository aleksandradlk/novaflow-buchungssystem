// Shared helpers for the public pages.
// Rules: no cookies, no localStorage, no external requests – only relative /api/nf/ calls.

import STANDARD from './texte.js';

/** Creates an element. attrs: class, text, html is NOT supported (XSS-safe). on* = listeners. */
export function el(tag, attrs = {}, ...kinder) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const kind of kinder.flat()) {
    if (kind === null || kind === undefined || kind === false) continue;
    e.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
  }
  return e;
}

export function query(name) {
  return new URLSearchParams(location.search).get(name) || '';
}

/** Calls the instance API. Never throws; returns { ok, status, json }. */
export async function api(method, pfad, daten) {
  const opt = { method, headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' };
  if (daten instanceof FormData) opt.body = daten;
  else if (daten !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(daten);
  }
  let res;
  try {
    res = await fetch(pfad, opt);
  } catch {
    return { ok: false, status: 0, json: {} };
  }
  let json = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  return { ok: res.ok, status: res.status, json };
}

/** Text lookup: customer texts override the defaults; {{x}} placeholders are filled. */
export function texter(seite) {
  const basis = STANDARD[seite && seite.ansprache === 'du' ? 'du' : 'sie'];
  const alle = { ...basis, ...((seite && seite.texte) || {}) };
  return (key, werte = {}) => {
    const roh = alle[key] ?? '';
    return roh.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, n) => (werte[n] ?? ''));
  };
}

/** Default texts before the settings are loaded (form of address unknown → Sie). */
export const vorlaeufig = texter(null);

/** Applies name, logo, title and footer links of the customer. */
export function rahmen(seite, T, titel) {
  const name = seite.betrieb.name || '';
  document.title = titel ? `${titel} – ${name}` : name;
  const logo = document.querySelector('.kopf .logo');
  if (logo && seite.betrieb.logo) {
    logo.src = seite.betrieb.logo;
    logo.alt = name;
    logo.hidden = false;
  }
  const kopfName = document.querySelector('.kopf .name');
  if (kopfName && !seite.betrieb.logo) kopfName.textContent = name;
  const fuss = document.querySelector('.fuss nav');
  if (fuss) {
    fuss.replaceChildren(
      el('a', { href: seite.rechtliches.impressum_url, rel: 'noopener noreferrer', text: T('impressum') }),
      el('a', { href: seite.rechtliches.datenschutz_url, rel: 'noopener noreferrer', text: T('datenschutz') }),
    );
  }
}

/** Shows a page-level message (error or info) at the top of main. */
export function meldung(text, art = 'fehler') {
  const ziel = document.querySelector('#meldung');
  if (!ziel) return;
  ziel.className = text ? `meldung meldung-${art}` : 'meldung';
  ziel.textContent = text || '';
  if (text) ziel.focus();
}

export function fehlerText(antwort, T) {
  if (antwort.status === 0) return T('netzfehler');
  return antwort.json && antwort.json.message ? antwort.json.message : T('fehler_allgemein');
}

// ---------------------------------------------------------------- dates (customer time zone)

const TAG_MS = 86400000;

export function heute(zeitzone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zeitzone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function datumPlus(datum, tage) {
  const [y, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + tage * TAG_MS).toISOString().slice(0, 10);
}

/** "Montag, 7. Januar 2030" for a plain date (no time zone shift). */
export function formatDatum(datum) {
  const [y, m, d] = datum.split('-').map(Number);
  return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Montag, 7. Januar 2030, 08:00 Uhr" for an ISO timestamp in the customer's time zone. */
export function formatTermin(iso, zeitzone, T) {
  const d = new Date(iso);
  const tag = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: zeitzone }).format(d);
  const zeit = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: zeitzone }).format(d);
  return `${tag}, ${zeit} ${T('uhr')}`;
}

// ---------------------------------------------------------------- forms

/** Removes all field errors inside root. */
export function feldFehlerLeeren(root) {
  root.querySelectorAll('.feld-fehler').forEach((n) => n.remove());
  root.querySelectorAll('[aria-invalid]').forEach((n) => {
    n.removeAttribute('aria-invalid');
    const ids = (n.getAttribute('aria-describedby') || '').split(' ').filter((id) => !id.startsWith('fehler-'));
    if (ids.length) n.setAttribute('aria-describedby', ids.join(' '));
    else n.removeAttribute('aria-describedby');
  });
}

/**
 * Shows API field errors ({ "kontakt.email": { message } }) next to the matching
 * [data-feld] wrapper. Returns the keys that had no matching field.
 */
export function feldFehlerZeigen(root, data) {
  const unbekannt = [];
  for (const [key, wert] of Object.entries(data || {})) {
    const huelle = root.querySelector(`[data-feld="${CSS.escape(key)}"]`);
    if (!huelle) {
      unbekannt.push(key);
      continue;
    }
    const id = `fehler-${key.replace(/[^a-z0-9]/gi, '-')}`;
    huelle.append(el('p', { class: 'feld-fehler', id, text: (wert && wert.message) || '' }));
    const eingabe = huelle.querySelector('input, select, textarea');
    if (eingabe) {
      eingabe.setAttribute('aria-invalid', 'true');
      const beschr = eingabe.getAttribute('aria-describedby');
      eingabe.setAttribute('aria-describedby', beschr ? `${beschr} ${id}` : id);
    }
  }
  // focus the first invalid field in page order (the API sorts its keys alphabetically)
  const erstes = root.querySelector('[aria-invalid="true"]');
  if (erstes) erstes.focus();
  return unbekannt;
}

/** Labeled form field wrapper with optional hint. */
export function feld({ key, label, pflicht = false, hinweis, eingabe }) {
  const id = `f-${key.replace(/[^a-z0-9]/gi, '-')}`;
  eingabe.id = id;
  if (pflicht) eingabe.setAttribute('aria-required', 'true');
  const kinder = [el('label', { for: id }, label, pflicht ? el('span', { class: 'pflicht', 'aria-hidden': 'true', text: ' *' }) : null)];
  if (hinweis) {
    const hid = `${id}-hinweis`;
    kinder.push(el('p', { class: 'hinweis', id: hid, text: hinweis }));
    eingabe.setAttribute('aria-describedby', hid);
  }
  kinder.push(eingabe);
  return el('div', { class: 'feld', 'data-feld': key }, kinder);
}
