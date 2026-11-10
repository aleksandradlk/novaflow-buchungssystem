// Manage page (/verwalten/?t=…): view, move or cancel an appointment; book the follow-up.

import { api, el, fehlerText, formatDatum, formatTermin, meldung, query, rahmen, texter, vorlaeufig } from '/gemeinsam/nf.js';
import { kalender } from '/gemeinsam/kalender.js';

const app = document.getElementById('app');
const token = query('t');
let T = vorlaeufig;
let daten = null;

function details(b, zeitzone) {
  const optionen = b.zusatzoptionen.map((o) => o.name);
  return el('dl', { class: 'auswahl' },
    el('dt', { text: T('angebot') }),
    el('dd', {}, b.angebot.name, optionen.length ? el('span', { class: 'klein', text: ` (+ ${optionen.join(', ')})` }) : null,
      b.folgetermin_zu_buchung ? el('span', { class: 'klein block', text: b.termintyp.name }) : null),
    el('dt', { text: T('termin') }),
    el('dd', { class: b.abgesagt ? 'durchgestrichen' : '', text: formatTermin(b.start, zeitzone, T) }),
    el('dt', { text: T('status') }),
    el('dd', { text: b.status.name }));
}

/** Calendar + confirm button; resolves the chosen slot via onBestaetigen. */
function terminWahl({ typ, zeitraum, startDatum, knopfText, onBestaetigen }) {
  let slot = null;
  const knopf = el('button', { type: 'button', class: 'knopf haupt', text: knopfText, disabled: true });
  const kal = kalender({
    T,
    zeitzone: daten.seite.zeitzone,
    typ,
    zeitraum,
    startDatum,
    label: T('verwalten_neuer_termin'),
    onWahl: (s) => {
      slot = s;
      knopf.disabled = !s;
    },
  });
  knopf.addEventListener('click', async () => {
    if (!slot) return;
    knopf.disabled = true;
    knopf.textContent = T('senden');
    const ok = await onBestaetigen(slot);
    if (!ok) {
      knopf.textContent = knopfText;
      kal.neuLaden();
    }
  });
  return el('div', { class: 'terminwahl' },
    el('h3', { text: T('verwalten_neuer_termin') }),
    kal.element,
    el('div', { class: 'aktionen' },
      el('button', { type: 'button', class: 'knopf', text: T('abbrechen'), onclick: () => zeichnen() }),
      knopf));
}

function zeichnen(hinweis) {
  const { seite, buchung: b, aktionen, folgetermin: ft } = daten;
  const bereich = el('div', { class: 'bereich-aktion' });

  const knoepfe = [];
  if (aktionen.verschieben) {
    knoepfe.push(el('button', {
      type: 'button', class: 'knopf', text: T('verwalten_verschieben'),
      onclick: () => bereich.replaceChildren(terminWahl({
        typ: b.termintyp.code,
        startDatum: b.start.slice(0, 10),
        knopfText: T('verwalten_bestaetigen'),
        onBestaetigen: async (slot) => {
          const r = await api('POST', `/api/nf/verwalten?t=${encodeURIComponent(token)}`, { aktion: 'verschieben', start: slot.start });
          if (!r.ok) { meldung(fehlerText(r, T)); return false; }
          await laden(T('verwalten_verschoben'));
          return true;
        },
      })),
    }));
  }
  if (aktionen.absagen) {
    knoepfe.push(el('button', {
      type: 'button', class: 'knopf warnung', text: T('verwalten_absagen'),
      onclick: () => {
        const ja = el('button', {
          type: 'button', class: 'knopf warnung',
          text: T('verwalten_absagen_ja'),
          onclick: async () => {
            ja.disabled = true;
            const r = await api('POST', `/api/nf/verwalten?t=${encodeURIComponent(token)}`, { aktion: 'absagen' });
            if (!r.ok) { ja.disabled = false; meldung(fehlerText(r, T)); return; }
            await laden(T('verwalten_abgesagt_ok'));
          },
        });
        bereich.replaceChildren(el('div', { class: 'rueckfrage', role: 'alertdialog', 'aria-labelledby': 'frage' },
          el('p', { id: 'frage', text: T('verwalten_absagen_frage') }),
          el('div', { class: 'aktionen' }, el('button', { type: 'button', class: 'knopf', text: T('abbrechen'), onclick: () => zeichnen() }), ja)));
        ja.focus();
      },
    }));
  }

  const teile = [
    el('h1', { text: T('verwalten_titel') }),
    hinweis ? el('p', { class: 'erfolg', role: 'status', text: hinweis }) : null,
    b.abgesagt ? el('p', { class: 'hinweis-box', text: T('verwalten_abgesagt') }) : null,
    details(b, seite.zeitzone),
  ];
  if (knoepfe.length) teile.push(el('div', { class: 'aktionen links' }, knoepfe));
  else if (!b.abgesagt) teile.push(el('p', { class: 'hinweis-box', text: T('verwalten_nicht_aenderbar') }));
  teile.push(bereich);

  if (ft && ft.berechtigt) {
    const ftBereich = el('div', { class: 'bereich-aktion' });
    const ftTeile = [el('h2', { text: T('verwalten_folgetermin') })];
    if (ft.buchung) {
      ftTeile.push(details(ft.buchung, seite.zeitzone));
      ftTeile.push(el('p', {}, el('a', { href: `/verwalten/?t=${encodeURIComponent(ft.verwalten_token)}`, text: T('verwalten_folgetermin_ansehen') })));
    } else {
      ftTeile.push(el('p', { text: T('verwalten_folgetermin_zeitraum', { ab: formatDatum(ft.ab), bis: formatDatum(ft.bis) }) }));
      ftTeile.push(el('div', { class: 'aktionen links' }, el('button', {
        type: 'button', class: 'knopf haupt', text: T('verwalten_folgetermin_buchen'),
        onclick: () => ftBereich.replaceChildren(terminWahl({
          typ: ft.termintyp.code,
          zeitraum: { ab: ft.ab, bis: ft.bis },
          knopfText: T('verwalten_folgetermin_bestaetigen'),
          onBestaetigen: async (slot) => {
            const r = await api('POST', `/api/nf/folgetermin?t=${encodeURIComponent(token)}`, { start: slot.start });
            if (!r.ok) { meldung(fehlerText(r, T)); return false; }
            await laden(T('verwalten_folgetermin_gebucht'));
            return true;
          },
        })),
      })));
      ftTeile.push(ftBereich);
    }
    teile.push(el('section', { class: 'folgetermin' }, ftTeile));
  }

  app.replaceChildren(el('section', {}, teile));
}

async function laden(hinweis) {
  meldung('');
  const r = await api('GET', `/api/nf/verwalten?t=${encodeURIComponent(token)}`);
  if (!r.ok) {
    app.replaceChildren();
    meldung(fehlerText(r, T));
    return;
  }
  daten = r.json;
  T = texter(daten.seite);
  rahmen(daten.seite, T, T('verwalten_titel'));
  zeichnen(hinweis);
  const h = app.querySelector('h1');
  h.setAttribute('tabindex', '-1');
  h.focus({ preventScroll: true });
}

laden();
