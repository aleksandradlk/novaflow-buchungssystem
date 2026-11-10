// Month calendar with day and time selection, used by the booking and the manage page.
// Free days are selectable, fully booked and closed days are shown greyed out.

import { api, datumPlus, el, fehlerText, formatDatum, heute } from './nf.js';

function monatsErster(datum) {
  return `${datum.slice(0, 7)}-01`;
}

function monatsLetzter(erster) {
  const [y, m] = erster.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function monatPlus(erster, n) {
  const [y, m] = erster.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

function monatsName(erster) {
  const [y, m] = erster.split('-').map(Number);
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function wochentag(datum) {
  const [y, m, d] = datum.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/**
 * @param {object} o
 * @param {Function} o.T            text function
 * @param {string} o.zeitzone
 * @param {string} o.typ            appointment type code
 * @param {string} [o.angebot]      offer code (resource check)
 * @param {string[]} [o.optionen]
 * @param {{ab:string,bis:string}} [o.zeitraum]  known period (else taken from first response)
 * @param {string} [o.startDatum]   month to show first
 * @param {Function} o.onWahl       called with the chosen slot or null
 * @param {string} [o.label]        accessible name of the calendar
 */
export function kalender(o) {
  const T = o.T;
  const heuteDatum = heute(o.zeitzone);
  let zeitraum = o.zeitraum || null;
  let monat = monatsErster(o.startDatum && o.startDatum > heuteDatum ? o.startDatum : heuteDatum);
  if (zeitraum && zeitraum.ab > heuteDatum && !o.startDatum) monat = monatsErster(zeitraum.ab);
  let tage = new Map(); // datum -> { slots: [], gesperrt }
  let gewaehlterTag = null;
  let gewaehlterSlot = null;
  let ladeNr = 0;

  const titel = el('h3', { class: 'kal-titel', 'aria-live': 'polite' });
  const vor = el('button', { type: 'button', class: 'kal-nav', 'aria-label': T('kalender_vorher'), text: '‹', onclick: () => wechsle(-1) });
  const nach = el('button', { type: 'button', class: 'kal-nav', 'aria-label': T('kalender_nachher'), text: '›', onclick: () => wechsle(1) });
  const raster = el('div', { class: 'kal-raster', role: 'group', 'aria-label': o.label || T('termin') });
  const status = el('p', { class: 'kal-status', role: 'status' });
  const zeiten = el('div', { class: 'kal-zeiten' });
  const wurzel = el('div', { class: 'kalender' },
    el('div', { class: 'kal-kopf' }, vor, titel, nach),
    el('div', { class: 'kal-wochentage', 'aria-hidden': 'true' }, T('kalender_wochentage').split(',').map((w) => el('span', { text: w }))),
    raster,
    status,
    zeiten);

  function bereich() {
    let von = monat;
    let bis = monatsLetzter(monat);
    if (von < heuteDatum) von = heuteDatum;
    if (zeitraum) {
      if (von < zeitraum.ab) von = zeitraum.ab;
      if (bis > zeitraum.bis) bis = zeitraum.bis;
    }
    return { von, bis };
  }

  function navAktualisieren() {
    vor.disabled = monat <= monatsErster(heuteDatum) || (zeitraum && monat <= monatsErster(zeitraum.ab));
    nach.disabled = !!zeitraum && monatPlus(monat, 1) > zeitraum.bis;
  }

  async function laden() {
    const nr = ++ladeNr;
    titel.textContent = monatsName(monat);
    status.textContent = T('laden');
    raster.setAttribute('aria-busy', 'true');
    const { von, bis } = bereich();
    tage = new Map();
    if (von <= bis) {
      const q = new URLSearchParams({ typ: o.typ, von, bis });
      if (o.angebot) q.set('angebot', o.angebot);
      if (o.optionen && o.optionen.length) q.set('optionen', o.optionen.join(','));
      const r = await api('GET', `/api/nf/slots?${q}`);
      if (nr !== ladeNr) return;
      if (!r.ok) {
        status.textContent = fehlerText(r, T);
        raster.removeAttribute('aria-busy');
        return;
      }
      if (!zeitraum) {
        zeitraum = r.json.zeitraum;
        // first answer told us the period: jump into it if the current month is before it
        if (monatsErster(zeitraum.ab) > monat && zeitraum.ab > heuteDatum) {
          monat = monatsErster(zeitraum.ab);
          return laden();
        }
      }
      for (const s of r.json.slots) {
        if (!tage.has(s.datum)) tage.set(s.datum, { slots: [], gesperrt: false });
        tage.get(s.datum).slots.push(s);
      }
      for (const d of r.json.sperrtage) tage.set(d, { slots: [], gesperrt: true });
    }
    if (gewaehlterSlot) {
      const info = tage.get(gewaehlterSlot.datum);
      const aktuell = info && info.slots.find((x) => x.start === gewaehlterSlot.start);
      if (!aktuell || aktuell.frei < 1) {
        gewaehlterSlot = null;
        o.onWahl(null);
      }
    }
    raster.removeAttribute('aria-busy');
    navAktualisieren();
    zeichnen();
  }

  function tagFrei(info) {
    return !!info && info.slots.some((s) => s.frei > 0);
  }

  function zeichnen() {
    raster.replaceChildren();
    const erster = monat;
    const letzter = monatsLetzter(monat);
    for (let i = 1; i < wochentag(erster); i++) raster.append(el('span', { class: 'kal-leer' }));

    let ersterFreier = null;
    for (let d = erster; d <= letzter; d = datumPlus(d, 1)) {
      const info = tage.get(d);
      const frei = tagFrei(info);
      if (frei && !ersterFreier) ersterFreier = d;
      let zustand = 'kal-aus';
      let zusatz = '';
      if (info && info.gesperrt) { zustand = 'kal-geschlossen'; zusatz = T('kalender_tag_geschlossen'); }
      else if (frei) { zustand = 'kal-frei'; zusatz = T('kalender_tag_frei'); }
      else if (info && info.slots.length) { zustand = 'kal-voll'; zusatz = T('kalender_tag_voll'); }
      const knopf = el('button', {
        type: 'button',
        class: `kal-tag ${zustand}${d === gewaehlterTag ? ' gewaehlt' : ''}`,
        disabled: !frei,
        'aria-pressed': frei ? String(d === gewaehlterTag) : undefined,
        'aria-label': `${formatDatum(d)}${zusatz ? `, ${zusatz}` : ''}`,
        'data-datum': d,
        text: String(Number(d.slice(8))),
        onclick: () => tagWaehlen(d, true),
      });
      raster.append(knopf);
    }

    if (gewaehlterTag && !(gewaehlterTag >= erster && gewaehlterTag <= letzter && tagFrei(tage.get(gewaehlterTag)))) {
      gewaehlterTag = null;
    }
    if (!gewaehlterTag && ersterFreier) gewaehlterTag = ersterFreier;
    if (gewaehlterTag) {
      raster.querySelector(`[data-datum="${gewaehlterTag}"]`)?.classList.add('gewaehlt');
      raster.querySelector(`[data-datum="${gewaehlterTag}"]`)?.setAttribute('aria-pressed', 'true');
      status.textContent = '';
      zeitenZeichnen();
    } else {
      zeiten.replaceChildren();
      const amEnde = zeitraum && monatPlus(monat, 1) > zeitraum.bis;
      status.textContent = amEnde && ![...tage.values()].some(tagFrei) && monat === monatsErster(bereich().von)
        ? T('kalender_zeitraum_leer') : T('kalender_monat_leer');
    }
  }

  function tagWaehlen(d, fokus) {
    gewaehlterTag = d;
    raster.querySelectorAll('.kal-tag').forEach((b) => {
      const an = b.dataset.datum === d;
      b.classList.toggle('gewaehlt', an);
      if (!b.disabled) b.setAttribute('aria-pressed', String(an));
    });
    if (gewaehlterSlot && gewaehlterSlot.datum !== d) slotWaehlen(null);
    zeitenZeichnen();
    if (fokus) zeiten.querySelector('button:not([disabled])')?.focus();
  }

  function zeitenZeichnen() {
    const info = tage.get(gewaehlterTag);
    const liste = el('div', { class: 'kal-zeitliste', role: 'group', 'aria-label': `${T('kalender_uhrzeit')}, ${formatDatum(gewaehlterTag)}` });
    for (const s of (info ? info.slots : [])) {
      const voll = s.frei < 1;
      liste.append(el('button', {
        type: 'button',
        class: `kal-zeit${voll ? ' kal-voll' : ''}${gewaehlterSlot && gewaehlterSlot.start === s.start ? ' gewaehlt' : ''}`,
        disabled: voll,
        'aria-pressed': voll ? undefined : String(!!gewaehlterSlot && gewaehlterSlot.start === s.start),
        'aria-label': voll ? `${s.zeit} ${T('uhr')}, ${T('kalender_voll')}` : `${s.zeit} ${T('uhr')}`,
        'data-start': s.start,
        text: s.zeit,
        onclick: () => slotWaehlen(s),
      }));
    }
    zeiten.replaceChildren(el('h4', { class: 'kal-tagtitel', text: formatDatum(gewaehlterTag) }), liste);
  }

  function slotWaehlen(s) {
    gewaehlterSlot = s;
    zeiten.querySelectorAll('.kal-zeit').forEach((b) => {
      const an = !!s && b.dataset.start === s.start;
      b.classList.toggle('gewaehlt', an);
      if (!b.disabled) b.setAttribute('aria-pressed', String(an));
    });
    o.onWahl(s);
  }

  function wechsle(n) {
    monat = monatPlus(monat, n);
    gewaehlterTag = null;
    laden();
  }

  laden();
  return {
    element: wurzel,
    neuLaden: () => laden(),
    get slot() { return gewaehlterSlot; },
  };
}
