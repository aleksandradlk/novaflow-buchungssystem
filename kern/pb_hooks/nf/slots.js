// Slot calculation without backend APIs – used by the hooks and by the Node tests.
//
// Times: rules and days are local wall-clock values in the customer's time zone.
// The caller injects `zeit` with two converters:
//   zeit.toUtcMs("2030-01-07", "08:00") -> epoch ms
//   zeit.toLocal(epochMs)               -> { datum: "2030-01-07", zeit: "08:00" }

const TAG_MS = 86400000;

function pad(n) {
  return (n < 10 ? "0" : "") + n;
}

function minuten(hhmm) {
  const p = String(hhmm).split(":");
  return Number(p[0]) * 60 + Number(p[1]);
}

function alsUhrzeit(min) {
  return pad(Math.floor(min / 60)) + ":" + pad(min % 60);
}

function tagNummer(datum) {
  const p = datum.split("-");
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / TAG_MS;
}

function alsDatum(tag) {
  const d = new Date(tag * TAG_MS);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

/** ISO weekday: 1 = Monday … 7 = Sunday */
function wochentag(datum) {
  const w = new Date(tagNummer(datum) * TAG_MS).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Monday of the ISO week of `datum` – used as week key. */
function wochenStart(datum) {
  return alsDatum(tagNummer(datum) - (wochentag(datum) - 1));
}

function addTage(datum, n) {
  return alsDatum(tagNummer(datum) + n);
}

function istDatum(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return alsDatum(tagNummer(s)) === s;
}

function tageZwischen(von, bis) {
  return tagNummer(bis) - tagNummer(von);
}

/**
 * Computes bookable slots.
 *
 * ctx = {
 *   typ:           { code, dauer_minuten },
 *   regeln:        [{ wochentag, von, bis, takt_minuten, max_pro_slot, max_pro_tag, gueltig_von, gueltig_bis }],
 *   zeitraum:      { ab, bis }               bookable period (dates)
 *   sperrtage:     ["YYYY-MM-DD", ...]
 *   maxProWoche:   number (0 = no limit)     all active bookings of the ISO week
 *   ressourceFrei: number | null             free units of the required resource(s)
 *   buchungen:     [{ startMs, endeMs, termintyp }]   active bookings (not cancelled)
 *   von, bis:      requested range (dates, inclusive)
 *   nowMs:         current time
 *   zeit:          converters (see top)
 * }
 *
 * Capacity rules:
 *   slot  = bookings of this type overlapping the slot   < max_pro_slot
 *   day   = bookings of this type on that local day      < max_pro_tag (if set)
 *   week  = all bookings in that ISO week                < maxProWoche (if set)
 *   resource                                             < ressourceFrei (if set)
 */
function berechneSlots(ctx) {
  const typ = ctx.typ;
  const dauerMs = typ.dauer_minuten * 60000;
  const gesperrt = {};
  ctx.sperrtage.forEach(function (d) { gesperrt[d] = true; });

  const proWoche = {};
  const proTag = {};
  const eigene = [];
  ctx.buchungen.forEach(function (b) {
    const lokal = ctx.zeit.toLocal(b.startMs);
    const woche = wochenStart(lokal.datum);
    proWoche[woche] = (proWoche[woche] || 0) + 1;
    if (b.termintyp === typ.code) {
      proTag[lokal.datum] = (proTag[lokal.datum] || 0) + 1;
      eigene.push(b);
    }
  });

  const von = ctx.von > ctx.zeitraum.ab ? ctx.von : ctx.zeitraum.ab;
  const bis = ctx.bis < ctx.zeitraum.bis ? ctx.bis : ctx.zeitraum.bis;
  const slots = [];
  const gesperrtImBereich = [];
  const gesehen = {};

  for (let datum = von; datum <= bis; datum = addTage(datum, 1)) {
    if (gesperrt[datum]) {
      gesperrtImBereich.push(datum);
      continue;
    }
    const wt = wochentag(datum);
    const woche = wochenStart(datum);
    ctx.regeln.forEach(function (r) {
      if (Number(r.wochentag) !== wt) return;
      if (r.gueltig_von && datum < r.gueltig_von) return;
      if (r.gueltig_bis && datum > r.gueltig_bis) return;
      const ende = minuten(r.bis);
      for (let m = minuten(r.von); m + typ.dauer_minuten <= ende; m += r.takt_minuten) {
        const startMs = ctx.zeit.toUtcMs(datum, alsUhrzeit(m));
        if (startMs <= ctx.nowMs || gesehen[startMs]) continue;
        gesehen[startMs] = true;
        const endeMs = startMs + dauerMs;

        let belegt = 0;
        eigene.forEach(function (b) {
          if (b.startMs < endeMs && b.endeMs > startMs) belegt++;
        });
        let frei = r.max_pro_slot - belegt;
        if (r.max_pro_tag > 0) frei = Math.min(frei, r.max_pro_tag - (proTag[datum] || 0));
        if (ctx.maxProWoche > 0) frei = Math.min(frei, ctx.maxProWoche - (proWoche[woche] || 0));
        if (ctx.ressourceFrei !== null && ctx.ressourceFrei !== undefined) frei = Math.min(frei, ctx.ressourceFrei);

        slots.push({
          start: new Date(startMs).toISOString(),
          ende: new Date(endeMs).toISOString(),
          datum: datum,
          zeit: alsUhrzeit(m),
          frei: Math.max(0, frei),
        });
      }
    });
  }

  slots.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  return { slots: slots, sperrtage: gesperrtImBereich };
}

/**
 * Free places for exactly this start time, or null if it is not a valid slot
 * (wrong time, blocked day, outside the period, in the past).
 */
function freiAm(ctx, startMs) {
  const datum = ctx.zeit.toLocal(startMs).datum;
  const res = berechneSlots(Object.assign({}, ctx, { von: datum, bis: datum }));
  const iso = new Date(startMs).toISOString();
  for (let i = 0; i < res.slots.length; i++) {
    if (res.slots[i].start === iso) return res.slots[i];
  }
  return null;
}

module.exports = {
  berechneSlots: berechneSlots,
  freiAm: freiAm,
  wochentag: wochentag,
  wochenStart: wochenStart,
  addTage: addTage,
  istDatum: istDatum,
  tageZwischen: tageZwischen,
  minuten: minuten,
};
