// Open contacts: contacts without an active booking in the current bookable period
// (e.g. imported customers or cancellations) – the people a follow-up could reach.

import { datumPlus, el, formatDatum } from '/gemeinsam/nf.js';
import { kontext } from './app.js';
import { buchungenZwischen } from './ansicht-termine.js';
import { alle, fehlerText, hinweis } from './team.js';

export async function kontakteAnsicht() {
  const { buchbar_ab: ab, buchbar_bis: bis } = kontext.cfg.roh;
  const [kontakte, buchungen] = await Promise.all([
    alle('kontakte', { sort: 'nachname,vorname', fields: 'id,anrede,vorname,nachname,email,telefon,plz,ort,einwilligung_email,abgemeldet,created' }),
    buchungenZwischen(ab, datumPlus(bis, 1), " && abgesagt_am = ''"),
  ]);
  if (!kontakte.ok || !buchungen.ok) {
    hinweis(fehlerText(kontakte.ok ? buchungen : kontakte.r), 'fehler');
    return { titel: 'Kontakte', element: el('h1', { text: 'Kontakte' }) };
  }
  const gebucht = new Set(buchungen.json.items.map((b) => b.kontakt));
  const offen = kontakte.items.filter((k) => !gebucht.has(k.id));

  const liste = el('ul', { class: 'kontakte' });
  const zaehler = el('p', { class: 'klein', role: 'status' });
  function zeichnen(suche) {
    const s = suche.trim().toLowerCase();
    const treffer = offen.filter((k) => !s || [k.vorname, k.nachname, k.email, k.ort, k.plz].join(' ').toLowerCase().includes(s));
    zaehler.textContent = `${treffer.length} von ${kontakte.items.length} Kontakten ohne Buchung im Zeitraum ${formatDatum(ab)} bis ${formatDatum(bis)}.`;
    liste.replaceChildren(...treffer.map((k) => el('li', { class: 'kontakt' },
      el('strong', { text: [k.vorname, k.nachname].filter(Boolean).join(' ') || '–' }),
      el('span', { class: 'klein block' }, k.email ? el('a', { href: `mailto:${k.email}`, text: k.email }) : null,
        k.telefon ? ' · ' : null, k.telefon ? el('a', { href: `tel:${k.telefon.replace(/[^\d+]/g, '')}`, text: k.telefon }) : null),
      el('span', { class: 'klein block', text: [[k.plz, k.ort].filter(Boolean).join(' '), k.abgemeldet ? 'abgemeldet' : k.einwilligung_email ? 'Werbe-Mails erlaubt' : 'keine Einwilligung für Werbe-Mails'].filter(Boolean).join(' · ') }))));
  }
  const suche = el('input', { type: 'search', id: 'k-suche', placeholder: 'Name, E-Mail oder Ort', oninput: (e) => zeichnen(e.target.value) });
  zeichnen('');
  return {
    titel: 'Kontakte',
    element: el('section', {},
      el('h1', { text: 'Offene Kontakte' }),
      el('p', { text: 'Kontakte ohne Buchung im aktuellen Buchungszeitraum.' }),
      el('div', { class: 'feld' }, el('label', { for: 'k-suche', text: 'Suchen' }), suche),
      zaehler,
      liste),
  };
}
