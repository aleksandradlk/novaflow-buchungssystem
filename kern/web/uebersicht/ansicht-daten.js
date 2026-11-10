// Administration (owner): import of a customer list, season campaign, export of all data.

import { el, formatDatum, heute } from '/gemeinsam/nf.js';
import { kontext } from './app.js';
import { alle, api, fehlerText, hinweis } from './team.js';
import { csvLesen, xlsxLesen, zeilenAufbereiten, zuordnungRaten } from './tabelle.js';
import { csvErstellen, zipErstellen } from './zip.js';

// ---------------------------------------------------------------- import

const ZIELE = [
  ['vorname', 'Vorname'], ['nachname', 'Nachname'], ['email', 'E-Mail'], ['telefon', 'Telefon'], ['anrede', 'Anrede'],
  ['strasse', 'Straße'], ['plz', 'PLZ'], ['ort', 'Ort'],
  ['einwilligung_email', 'Einwilligung E-Mail (ja/x/1)'], ['einwilligung_datum', 'Einwilligung am (Datum)'],
];
const PAKET = 500;

export function importBereich() {
  const zusatz = (kontext.cfg.formular.zusatzfelder || []).filter((z) => z.ziel === 'kontakt');
  const box = el('div', { class: 'stapel' });
  const datei = el('input', { type: 'file', id: 'imp-datei', accept: '.csv,.xlsx,text/csv' });

  datei.addEventListener('change', async () => {
    const f = datei.files[0];
    if (!f) return;
    hinweis('');
    let zeilen;
    try {
      zeilen = /\.xlsx$/i.test(f.name) ? await xlsxLesen(await f.arrayBuffer()) : csvLesen(await f.text());
    } catch (err) {
      hinweis(`Die Datei konnte nicht gelesen werden: ${err.message}`, 'fehler');
      return;
    }
    if (zeilen.length < 2) {
      hinweis('Die Datei enthält keine Datenzeilen (erste Zeile = Spaltenköpfe).', 'fehler');
      return;
    }
    zuordnen(zeilen[0], zeilen.slice(1));
  });

  function zuordnen(kopf, daten) {
    const ziele = [...ZIELE, ...zusatz.map((z) => [`zf_${z.key}`, z.label])];
    const zuordnung = zuordnungRaten(kopf, zusatz);
    const auswahl = ziele.map(([ziel, text]) => {
      const s = el('select', { id: `imp-${ziel}`, 'data-ziel': ziel },
        el('option', { value: '-1', text: '– nicht importieren –' }),
        kopf.map((k, i) => el('option', { value: String(i), selected: zuordnung[ziel] === i, text: k || `Spalte ${i + 1}` })));
      return el('div', { class: 'feld' }, el('label', { for: `imp-${ziel}`, text }), s);
    });
    const vorschau = el('div', { class: 'vorschau' });
    const bestaetigt = el('input', { type: 'checkbox', id: 'imp-ok' });
    const knopf = el('button', { type: 'button', class: 'knopf haupt', text: `${daten.length} Zeilen importieren` });

    const aktuell = () => Object.fromEntries([...box.querySelectorAll('select[data-ziel]')].map((s) => [s.dataset.ziel, Number(s.value)]));
    const zeigen = () => {
      const z = zeilenAufbereiten(daten.slice(0, 5), aktuell(), zusatz);
      vorschau.replaceChildren(el('h3', { text: 'Vorschau (erste Zeilen)' }), el('ul', { class: 'liste' }, z.map((x) => el('li', {},
        el('span', { text: `${[x.vorname, x.nachname].filter(Boolean).join(' ') || '–'} · ${x.email || x.telefon || 'ohne Kontakt'}${x.ort ? ` · ${x.ort}` : ''} · ${x.einwilligung_email ? 'Einwilligung ✓' : 'keine Einwilligung'}` })))));
    };
    box.addEventListener('change', (e) => { if (e.target.matches('select[data-ziel]')) zeigen(); });

    knopf.addEventListener('click', async () => {
      const z = aktuell();
      if (z.email < 0 && z.telefon < 0) return hinweis('Bitte mindestens E-Mail oder Telefon zuordnen.', 'fehler');
      if (z.einwilligung_email >= 0 && !bestaetigt.checked) return hinweis('Bitte bestätigen, dass die Einwilligungen nachweisbar vorliegen.', 'fehler');
      const alleZeilen = zeilenAufbereiten(daten, z, zusatz);
      knopf.disabled = true;
      const summe = { neu: 0, ergaenzt: 0, uebersprungen: [] };
      for (let i = 0; i < alleZeilen.length; i += PAKET) {
        knopf.textContent = `Importiere … ${Math.min(i + PAKET, alleZeilen.length)} / ${alleZeilen.length}`;
        const r = await api('POST', '/api/nf-team/import', { zeilen: alleZeilen.slice(i, i + PAKET) });
        if (!r.ok) {
          knopf.disabled = false;
          knopf.textContent = 'Erneut versuchen';
          return hinweis(fehlerText(r), 'fehler');
        }
        summe.neu += r.json.neu;
        summe.ergaenzt += r.json.ergaenzt;
        summe.uebersprungen.push(...r.json.uebersprungen);
      }
      box.replaceChildren(el('section', { class: 'karte-box', role: 'status' },
        el('h3', { text: 'Import abgeschlossen' }),
        el('p', { text: `${summe.neu} neu angelegt, ${summe.ergaenzt} vorhandene Kontakte ergänzt, ${summe.uebersprungen.length} übersprungen.` }),
        summe.uebersprungen.length ? el('ul', { class: 'liste' }, summe.uebersprungen.map((u) => el('li', { text: `Zeile ${u.zeile}: ${u.grund}` }))) : null));
      hinweis('Import abgeschlossen.');
    });

    box.replaceChildren(
      el('section', { class: 'karte-box' }, el('h3', { text: `Spalten zuordnen (${daten.length} Zeilen)` }), el('div', { class: 'zeile2' }, auswahl)),
      vorschau,
      el('label', { class: 'wahl', for: 'imp-ok' }, bestaetigt, el('span', { text: 'Die Einwilligungen in der Datei liegen nachweisbar vor (z. B. schriftlich oder per Formular).' })),
      el('div', { class: 'aktionen links' }, knopf));
    zeigen();
  }

  return el('div', { class: 'stapel' },
    el('p', { class: 'klein', text: 'Bestandskunden aus einer CSV- oder Excel-Datei übernehmen. Die Datei wird nur in diesem Browser gelesen und nicht hochgeladen. Vorhandene Kontakte (gleiche E-Mail) werden nur ergänzt, Abmeldungen bleiben bestehen.' }),
    el('div', { class: 'feld' }, el('label', { for: 'imp-datei', text: 'Datei (CSV oder Excel .xlsx)' }), datei),
    box);
}

// ---------------------------------------------------------------- campaign

export async function kampagneBereich(neuZeichnen) {
  const r = await api('GET', '/api/nf-team/kampagne/stand');
  if (!r.ok) return el('p', { text: fehlerText(r) });
  const s = r.json;
  const test = s.mail_modus !== 'live';
  const knopf = el('button', {
    type: 'button', class: 'knopf haupt', text: 'Kampagne jetzt starten', disabled: s.empfaenger_moeglich === 0,
    onclick: async () => {
      const ziel = test ? `alle an die Test-Adresse ${s.test_empfaenger}` : 'an die echten Kunden';
      if (!window.confirm(`Kampagne an ${s.empfaenger_moeglich} Kontakte starten? Versand ${ziel}, in Etappen.`)) return;
      knopf.disabled = true;
      const a = await api('POST', '/api/nf-team/kampagne/start');
      if (!a.ok) {
        knopf.disabled = false;
        return hinweis(fehlerText(a), 'fehler');
      }
      hinweis(`${a.json.geplant} Mails geplant. Sie werden automatisch in Etappen verschickt.`);
      neuZeichnen();
    },
  });
  return el('div', { class: 'stapel' },
    el('p', { class: 'klein', text: 'Saison-Mail an alle Kontakte mit E-Mail-Einwilligung, die im aktuellen Buchungszeitraum noch nicht gebucht haben – mit persönlichem Buchungslink und Abmeldelink. Danach folgen automatisch Erinnerungen an alle, die nicht buchen.' }),
    el('p', { class: test ? 'hinweis-box' : 'meldung meldung-fehler', text: test ? `Testmodus: Alle Mails gehen an ${s.test_empfaenger}.` : 'Live-Betrieb: Die Mails gehen an die echten Kunden.' }),
    el('dl', { class: 'auswahl' },
      el('dt', { text: 'Mögliche Empfänger' }), el('dd', { text: String(s.empfaenger_moeglich) }),
      el('dt', { text: 'Letzter Start' }), el('dd', { text: s.kampagne_start ? formatDatum(s.kampagne_start) : '–' }),
      el('dt', { text: 'Geplant' }), el('dd', { text: String(s.geplant) }),
      el('dt', { text: 'Unterwegs' }), el('dd', { text: String(s.unterwegs) }),
      el('dt', { text: 'Gesendet' }), el('dd', { text: String(s.gesendet) }),
      el('dt', { text: 'Übersprungen' }), el('dd', { text: `${s.uebersprungen} (abgemeldet oder schon gebucht)` }),
      el('dt', { text: 'Fehler' }), el('dd', { text: String(s.fehler) })),
    el('div', { class: 'aktionen links' }, knopf));
}

// ---------------------------------------------------------------- export

const SAMMLUNGEN = ['einstellungen', 'angebote', 'terminregeln', 'sperrtage', 'kontakte', 'buchungen', 'status_log', 'nachrichten', 'users'];

async function fotosLaden(buchungen, status) {
  const dateien = [];
  let token = '';
  let tokenZeit = 0;
  const gesamt = buchungen.reduce((n, b) => n + (b.fotos || []).length, 0);
  for (const b of buchungen) {
    for (const f of b.fotos || []) {
      if (Date.now() - tokenZeit > 60000) {
        const t = await api('POST', '/api/files/token');
        token = t.ok ? t.json.token : '';
        tokenZeit = Date.now();
      }
      status(`Fotos ${dateien.length + 1} / ${gesamt} …`);
      const res = await fetch(`/api/files/buchungen/${b.id}/${encodeURIComponent(f)}?token=${encodeURIComponent(token)}`, { credentials: 'omit', cache: 'no-store' });
      if (res.ok) dateien.push({ name: `fotos/${b.id}/${f}`, daten: new Uint8Array(await res.arrayBuffer()) });
    }
  }
  return dateien;
}

export function exportBereich() {
  const mitFotos = el('input', { type: 'checkbox', id: 'exp-fotos' });
  const knopf = el('button', { type: 'button', class: 'knopf haupt', text: 'Alle Daten exportieren' });
  knopf.addEventListener('click', async () => {
    knopf.disabled = true;
    const status = (t) => { knopf.textContent = t; };
    const dateien = [];
    let buchungen = [];
    for (const name of SAMMLUNGEN) {
      status(`Lade ${name} …`);
      const r = await alle(name, { sort: 'created' });
      if (!r.ok) {
        knopf.disabled = false;
        knopf.textContent = 'Alle Daten exportieren';
        return hinweis(fehlerText(r.r), 'fehler');
      }
      if (name === 'buchungen') buchungen = r.items;
      dateien.push({ name: `${name}.csv`, daten: csvErstellen(r.items) });
    }
    if (mitFotos.checked) dateien.push(...await fotosLaden(buchungen, status));
    const tz = kontext.cfg.betrieb.zeitzone || 'Europe/Berlin';
    const name = `export-${kontext.cfg.betrieb.kennung || 'daten'}-${heute(tz)}.zip`;
    const url = URL.createObjectURL(new Blob([zipErstellen(dateien)], { type: 'application/zip' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    knopf.disabled = false;
    knopf.textContent = 'Alle Daten exportieren';
    hinweis(`Export „${name}“ erstellt (${dateien.length} Dateien).`);
  });
  return el('div', { class: 'stapel' },
    el('p', { class: 'klein', text: 'ZIP-Datei mit einer CSV-Datei je Bereich (Einstellungen, Angebote, Terminregeln, Sperrtage, Kontakte, Buchungen, Status-Verlauf, Nachrichten, Benutzer). Die CSV-Dateien öffnen sich direkt in Excel.' }),
    el('p', { class: 'hinweis-box', text: 'Der Export enthält personenbezogene Daten. Bitte sicher aufbewahren und nach Gebrauch löschen.' }),
    el('label', { class: 'wahl', for: 'exp-fotos' }, mitFotos, el('span', { text: 'Fotos einschließen (kann groß werden)' })),
    el('div', { class: 'aktionen links' }, knopf));
}
