// Overview (/uebersicht/): login with two factors, navigation, routing (#/…).
// Roles: inhaber sees everything, mitarbeiter sees appointments/contacts/tours and sets status.

import { el } from '/gemeinsam/nf.js';
import {
  aktuell, api, beiAbgelaufenerSitzung, fehlerText, hinweis, istInhaber, sitzungLaden, sitzungLoeschen, sitzungSetzen,
} from './team.js';
import { buchungAnsicht, tagAnsicht, wocheAnsicht } from './ansicht-termine.js';
import { kontakteAnsicht } from './ansicht-kontakte.js';
import { tourenAnsicht } from './ansicht-touren.js';
import { verwaltungAnsicht } from './ansicht-verwaltung.js';

const app = document.getElementById('app');
const nav = document.querySelector('.team-nav');

/** Settings of the instance (time zone, status list, modules …), loaded after login. */
export const kontext = { cfg: null };

function rahmen(cfg) {
  const name = cfg.betrieb.name || '';
  const logo = document.querySelector('.kopf .logo');
  if (cfg.betrieb.logo) {
    logo.src = `/kunde/${cfg.betrieb.logo}`;
    logo.alt = name;
    logo.hidden = false;
  } else {
    document.querySelector('.kopf .name').textContent = name;
  }
}

function titel(text) {
  const name = kontext.cfg ? kontext.cfg.betrieb.name : '';
  document.title = name ? `${text} – Übersicht ${name}` : `${text} – Übersicht`;
}

function navZeichnen(aktiv) {
  const s = aktuell();
  if (!s || !kontext.cfg) {
    nav.hidden = true;
    return;
  }
  const punkte = [['woche', 'Termine'], ['kontakte', 'Kontakte']];
  if (kontext.cfg.module.touren) punkte.push(['touren', 'Touren']);
  if (istInhaber()) punkte.push(['verwaltung', 'Verwaltung']);
  nav.hidden = false;
  nav.replaceChildren(
    el('ul', {}, punkte.map(([ziel, text]) => el('li', {},
      el('a', { href: `#/${ziel}`, 'aria-current': aktiv === ziel ? 'page' : undefined, text })))),
    el('span', { class: 'wer', text: `${s.record.name || s.record.email} · ${s.record.rolle === 'inhaber' ? 'Inhaber' : 'Mitarbeiter'}` }),
    el('button', { type: 'button', class: 'knopf klein', text: 'Abmelden', onclick: abmelden }),
  );
}

function abmelden() {
  sitzungLoeschen();
  kontext.cfg = null;
  location.hash = '#/';
  login();
}

// ---------------------------------------------------------------- login (password + code)

function login(meldung) {
  navZeichnen();
  titel('Anmelden');
  hinweis(meldung || '', meldung ? 'fehler' : 'erfolg');
  const email = el('input', { type: 'email', id: 'l-email', name: 'email', autocomplete: 'username', required: true });
  const passwort = el('input', { type: 'password', id: 'l-passwort', name: 'passwort', autocomplete: 'current-password', required: true });
  const merken = el('input', { type: 'checkbox', id: 'l-merken' });
  const knopf = el('button', { type: 'submit', class: 'knopf haupt', text: 'Weiter' });

  const form = el('form', {
    class: 'karte-box anmeldung',
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      knopf.disabled = true;
      const r = await api('POST', '/api/collections/users/auth-with-password', { identity: email.value.trim(), password: passwort.value });
      knopf.disabled = false;
      if (r.ok && r.json.token) return angemeldet(r.json, merken.checked);
      if (r.json && r.json.mfaId) return codeAbfragen(email.value.trim(), r.json.mfaId, merken.checked);
      hinweis(r.status === 400 || r.status === 401 ? 'E-Mail oder Passwort ist falsch.' : fehlerText(r), 'fehler');
    },
  },
  el('h1', { text: 'Anmelden' }),
  el('div', { class: 'feld' }, el('label', { for: 'l-email', text: 'E-Mail' }), email),
  el('div', { class: 'feld' }, el('label', { for: 'l-passwort', text: 'Passwort' }), passwort),
  el('label', { class: 'wahl', for: 'l-merken' }, merken, el('span', { text: 'Auf diesem Gerät 7 Tage angemeldet bleiben' })),
  el('div', { class: 'aktionen' }, knopf));
  app.replaceChildren(form);
  email.focus();
}

async function codeAbfragen(email, mfaId, merken) {
  const r = await api('POST', '/api/collections/users/request-otp', { email });
  if (!r.ok) return login(fehlerText(r));
  const otpId = r.json.otpId;
  const code = el('input', {
    type: 'text', id: 'l-code', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true,
  });
  const knopf = el('button', { type: 'submit', class: 'knopf haupt', text: 'Anmelden' });
  app.replaceChildren(el('form', {
    class: 'karte-box anmeldung',
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      knopf.disabled = true;
      const a = await api('POST', '/api/collections/users/auth-with-otp', { otpId, password: code.value.trim(), mfaId });
      knopf.disabled = false;
      if (a.ok && a.json.token) return angemeldet(a.json, merken);
      hinweis(a.status === 400 || a.status === 401 ? 'Der Code ist falsch oder abgelaufen.' : fehlerText(a), 'fehler');
    },
  },
  el('h1', { text: 'Code eingeben' }),
  el('p', { text: `Wir haben einen Anmeldecode an ${email} geschickt. Er gilt 10 Minuten.` }),
  el('div', { class: 'feld' }, el('label', { for: 'l-code', text: 'Code (6 Ziffern)' }), code),
  el('div', { class: 'aktionen' },
    el('button', { type: 'button', class: 'knopf', text: 'Zurück', onclick: () => login() }),
    knopf)));
  hinweis('');
  code.focus();
}

async function angemeldet(auth, merken) {
  if (!['inhaber', 'mitarbeiter'].includes(auth.record.rolle)) {
    sitzungLoeschen();
    return login('Dieser Zugang hat keine Rolle für die Übersicht.');
  }
  sitzungSetzen(auth.token, auth.record, merken);
  await start();
}

// ---------------------------------------------------------------- settings + routing

export function cfgAus(rec) {
  return {
    id: rec.id,
    betrieb: rec.betrieb || {},
    module: rec.module || {},
    formular: rec.formular || {},
    termintypen: rec.termintypen || [],
    status_liste: rec.status_liste || [],
    ressourcen: rec.ressourcen || [],
    rollen: rec.rollen || {},
    roh: rec,
  };
}

async function cfgLaden() {
  const r = await api('GET', '/api/collections/einstellungen/records?perPage=1');
  if (!r.ok || !r.json.items.length) return false;
  kontext.cfg = cfgAus(r.json.items[0]);
  rahmen(kontext.cfg);
  return true;
}

async function route() {
  if (!aktuell() || !kontext.cfg) return;
  const [, bereich = 'woche', arg = ''] = (location.hash || '#/woche').replace(/^#/, '').split('/');
  hinweis('');
  navZeichnen(bereich === 'tag' || bereich === 'buchung' ? 'woche' : bereich);
  const ziel = {
    woche: () => wocheAnsicht(arg),
    tag: () => tagAnsicht(arg),
    buchung: () => buchungAnsicht(arg),
    kontakte: () => kontakteAnsicht(),
    touren: () => (kontext.cfg.module.touren ? tourenAnsicht(arg) : null),
    verwaltung: () => (istInhaber() ? verwaltungAnsicht(arg) : null),
  }[bereich];
  const inhalt = ziel ? await ziel() : null;
  if (!inhalt) {
    location.hash = '#/woche';
    return;
  }
  titel(inhalt.titel);
  app.replaceChildren(inhalt.element);
  const h = app.querySelector('h1');
  if (h) {
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }
}

async function start() {
  if (!(await cfgLaden())) {
    if (!aktuell()) return; // session expired → login already shown
    sitzungLoeschen();
    return login('Die Übersicht ist für diesen Zugang nicht verfügbar.');
  }
  if (!location.hash || location.hash === '#/') location.hash = '#/woche';
  else route();
}

window.addEventListener('hashchange', route);
beiAbgelaufenerSitzung(() => login('Die Anmeldung ist abgelaufen. Bitte erneut anmelden.'));

if (sitzungLaden()) start();
else login();
