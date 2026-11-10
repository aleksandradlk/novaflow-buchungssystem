// Unsubscribe page (/abmelden/?t=…). Opening the link changes nothing –
// only the button does (mail programs may open links automatically).

import { api, el, fehlerText, meldung, query, rahmen, texter, vorlaeufig } from '/gemeinsam/nf.js';

const app = document.getElementById('app');
const token = query('t');
const pfad = `/api/nf/abmelden?t=${encodeURIComponent(token)}`;

function fertig(T, text) {
  app.replaceChildren(el('section', {},
    el('h1', { text: T('abmelden_titel') }),
    el('p', { class: 'erfolg', role: 'status', text }),
    el('p', { class: 'klein', text: T('abmelden_hinweis') })));
}

async function start() {
  const r = await api('GET', pfad);
  if (!r.ok) {
    app.replaceChildren();
    meldung(fehlerText(r, vorlaeufig));
    return;
  }
  const T = texter(r.json.seite);
  rahmen(r.json.seite, T, T('abmelden_titel'));
  if (r.json.abgemeldet) return fertig(T, T('abmelden_bereits'));

  const knopf = el('button', {
    type: 'button', class: 'knopf haupt', text: T('abmelden_knopf'),
    onclick: async () => {
      knopf.disabled = true;
      const a = await api('POST', pfad);
      if (!a.ok) {
        knopf.disabled = false;
        meldung(fehlerText(a, T));
        return;
      }
      fertig(T, T('abmelden_erledigt'));
    },
  });
  app.replaceChildren(el('section', {},
    el('h1', { text: T('abmelden_titel') }),
    el('p', { text: T('abmelden_frage') }),
    el('div', { class: 'aktionen links' }, knopf),
    el('p', { class: 'klein', text: T('abmelden_hinweis') })));
}

start();
