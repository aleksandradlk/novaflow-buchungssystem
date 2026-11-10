// Session and API access for the overview (staff only).
// The login token lives in sessionStorage; with "angemeldet bleiben" in localStorage
// (explicit choice of the staff member, never on the public pages).

import { el } from '/gemeinsam/nf.js';

const KEY = 'nf-uebersicht';
let sitzung = null;

function speicher(art) {
  try {
    return art === 'lokal' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function sitzungLaden() {
  for (const art of ['sitzung', 'lokal']) {
    try {
      const roh = speicher(art)?.getItem(KEY);
      if (roh) {
        sitzung = JSON.parse(roh);
        return sitzung;
      }
    } catch { /* ignore broken storage */ }
  }
  return null;
}

export function sitzungSetzen(token, record, merken) {
  sitzung = { token, record };
  sitzungLoeschen(false);
  try {
    speicher(merken ? 'lokal' : 'sitzung')?.setItem(KEY, JSON.stringify(sitzung));
  } catch { /* private mode: session only in memory */ }
  return sitzung;
}

export function sitzungLoeschen(auchSpeicher = true) {
  for (const art of ['sitzung', 'lokal']) {
    try { speicher(art)?.removeItem(KEY); } catch { /* ignore */ }
  }
  if (auchSpeicher) sitzung = null;
}

export function aktuell() {
  return sitzung;
}

export function istInhaber() {
  return !!sitzung && sitzung.record.rolle === 'inhaber';
}

let beiAbmeldung = () => {};
export function beiAbgelaufenerSitzung(fn) {
  beiAbmeldung = fn;
}

const FELD_CODES = {
  validation_required: 'Pflichtfeld.',
  validation_is_email: 'Bitte eine gültige E-Mail-Adresse angeben.',
  validation_invalid_email: 'Bitte eine gültige E-Mail-Adresse angeben.',
  validation_not_unique: 'Ist bereits vergeben.',
  validation_values_mismatch: 'Die Eingaben stimmen nicht überein.',
  validation_length_out_of_range: 'Ungültige Länge (Passwort: mindestens 8 Zeichen).',
  validation_length_too_short: 'Zu kurz.',
  validation_length_too_long: 'Zu lang.',
  validation_match_invalid: 'Ungültiges Format.',
  validation_min_greater_equal_than_required: 'Wert ist zu klein.',
  validation_max_less_equal_than_required: 'Wert ist zu groß.',
  validation_invalid_value: 'Ungültiger Wert.',
};

const STATUS_TEXT = {
  0: 'Keine Verbindung. Bitte die Internetverbindung prüfen.',
  400: 'Bitte die Eingaben prüfen.',
  401: 'Anmeldung fehlgeschlagen.',
  403: 'Dafür fehlt die Berechtigung.',
  404: 'Nicht gefunden.',
  429: 'Zu viele Versuche – bitte einen Moment warten.',
};

/** Our own hooks answer in German; the standard API in English → translate by status. */
function deutsch(text) {
  return /[äöüÄÖÜß]|\b(Bitte|nicht|Die|Der|Es|Mitarbeiter|Unbekannt|maximale)\b/.test(text || '');
}

export function fehlerText(r) {
  const m = r.json && r.json.message;
  if (m && deutsch(m)) return m;
  return STATUS_TEXT[r.status] || 'Es ist ein Fehler aufgetreten. Bitte später noch einmal versuchen.';
}

export function feldFehler(r) {
  const out = {};
  for (const [feld, f] of Object.entries((r.json && r.json.data) || {})) {
    out[feld] = f && f.message && deutsch(f.message) ? f.message : (FELD_CODES[f && f.code] || 'Ungültiger Wert.');
  }
  return out;
}

/** API call with the staff token. Never throws. 401 on a logged-in session → log out. */
export async function api(methode, pfad, daten) {
  const opt = { method: methode, headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' };
  if (sitzung) opt.headers.Authorization = sitzung.token;
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
  try { json = await res.json(); } catch { json = {}; }
  if (res.status === 401 && sitzung && !pfad.includes('/auth-with-')) {
    sitzungLoeschen();
    beiAbmeldung();
  }
  return { ok: res.ok, status: res.status, json };
}

/** All records of a collection (pages of 500). */
export async function alle(collection, params = {}) {
  const items = [];
  for (let seite = 1; seite < 100; seite++) {
    const q = new URLSearchParams({ perPage: '500', page: String(seite), skipTotal: '1', ...params });
    const r = await api('GET', `/api/collections/${collection}/records?${q}`);
    if (!r.ok) return { ok: false, r, items };
    items.push(...r.json.items);
    if (r.json.items.length < 500) break;
  }
  return { ok: true, items };
}

/** Short message at the top (success/error), announced to screen readers. */
export function hinweis(text, art = 'erfolg') {
  const ziel = document.getElementById('meldung');
  if (!ziel) return;
  ziel.className = text ? `meldung meldung-${art === 'fehler' ? 'fehler' : 'info'}` : 'meldung';
  ziel.textContent = text || '';
  if (text && art === 'fehler') ziel.focus();
}

/** Date string in the storage format, for API filters. */
export function pbDatum(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

export function filterWert(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function knopf(text, onclick, klasse = '') {
  return el('button', { type: 'button', class: `knopf ${klasse}`.trim(), text, onclick });
}
