// Collects rules, blocked days and existing bookings for slots.js.
// Every function takes `app` so it can run inside a transaction (txApp).

const basis = require(`${__hooks}/nf/basis.js`);
const slots = require(`${__hooks}/nf/slots.js`);

/** Bookable period for a type: follow-up type uses its own period. */
function zeitraumFuer(cfg, typCode) {
  if (cfg.folgetermin_typ && typCode === cfg.folgetermin_typ) {
    return { ab: cfg.folgetermin_ab, bis: cfg.folgetermin_bis };
  }
  return { ab: cfg.buchbar_ab, bis: cfg.buchbar_bis };
}

function regeln(app, typCode) {
  return app.findRecordsByFilter("terminregeln", "termintyp = {:typ}", "wochentag,von", 0, 0, { typ: typCode }).map(function (r) {
    return {
      wochentag: r.getInt("wochentag"),
      von: r.getString("von"),
      bis: r.getString("bis"),
      takt_minuten: r.getInt("takt_minuten"),
      max_pro_slot: r.getInt("max_pro_slot"),
      max_pro_tag: r.getInt("max_pro_tag"),
      gueltig_von: r.getString("gueltig_von"),
      gueltig_bis: r.getString("gueltig_bis"),
    };
  });
}

function sperrtage(app, von, bis) {
  return app.findRecordsByFilter("sperrtage", "datum >= {:von} && datum <= {:bis}", "datum", 0, 0, { von: von, bis: bis })
    .map(function (r) { return r.getString("datum"); });
}

/** Active bookings in [von, bis] (local dates), widened to full ISO weeks for the week limit. */
function aktiveBuchungen(app, cfg, von, bis, ausserId) {
  const z = basis.zeit(cfg);
  const ab = z.toUtcMs(slots.addTage(slots.wochenStart(von), -1), "00:00");
  const bisMs = z.toUtcMs(slots.addTage(slots.wochenStart(bis), 8), "00:00");
  return app.findRecordsByFilter(
    "buchungen",
    "termin_start >= {:ab} && termin_start < {:bis} && abgesagt_am = '' && id != {:ausser}",
    "termin_start", 0, 0,
    { ab: basis.pbDatum(ab), bis: basis.pbDatum(bisMs), ausser: ausserId || "" },
  ).map(function (r) {
    return {
      startMs: basis.alsMs(r.getString("termin_start")),
      endeMs: basis.alsMs(r.getString("termin_ende")),
      termintyp: r.getString("termintyp"),
    };
  });
}

/**
 * Free units for the given resource codes (minimum across all), or null if none.
 * A resource unit is occupied by every active booking in the bookable period that uses it.
 */
function ressourceFrei(app, cfg, codes, ausserId) {
  if (!codes || codes.length === 0) return null;
  const z = basis.zeit(cfg);
  const ab = basis.pbDatum(z.toUtcMs(cfg.buchbar_ab, "00:00"));
  const bis = basis.pbDatum(z.toUtcMs(slots.addTage(cfg.buchbar_bis, 1), "00:00"));
  let frei = null;
  codes.forEach(function (code) {
    let kap = null;
    cfg.ressourcen.forEach(function (r) { if (r.code === code) kap = r.kapazitaet; });
    if (kap === null) {
      $app.logger().warn("nf unknown resource", "code", code);
      return;
    }
    const belegt = app.findRecordsByFilter(
      "buchungen",
      "ressourcen ~ {:r} && abgesagt_am = '' && termin_start >= {:ab} && termin_start < {:bis} && id != {:ausser}",
      "", 0, 0,
      { r: '"' + code + '"', ab: ab, bis: bis, ausser: ausserId || "" },
    ).length;
    const f = Math.max(0, kap - belegt);
    frei = frei === null ? f : Math.min(frei, f);
  });
  return frei;
}

/** Full context for slots.berechneSlots / slots.freiAm. */
function kontext(app, cfg, typ, von, bis, ressCodes, ausserId) {
  return {
    typ: typ,
    regeln: regeln(app, typ.code),
    zeitraum: zeitraumFuer(cfg, typ.code),
    sperrtage: sperrtage(app, von, bis),
    maxProWoche: cfg.max_pro_woche,
    ressourceFrei: ressourceFrei(app, cfg, ressCodes, ausserId),
    buchungen: aktiveBuchungen(app, cfg, von, bis, ausserId),
    von: von,
    bis: bis,
    nowMs: Date.now(),
    zeit: basis.zeit(cfg),
  };
}

/** Context for exactly one start time (booking / moving). */
function kontextFuerStart(app, cfg, typ, startMs, ressCodes, ausserId) {
  const datum = basis.zeit(cfg).toLocal(startMs).datum;
  return kontext(app, cfg, typ, datum, datum, ressCodes, ausserId);
}

/** Resource codes a booking of this offer (+ chosen options) occupies. */
function ressourcenVon(angebotRec, optionen) {
  const codes = [];
  const r = angebotRec.getString("ressource");
  if (r) codes.push(r);
  const alle = basis.json(angebotRec, "zusatzoptionen", []);
  alle.forEach(function (o) {
    if (o.ressource && optionen.indexOf(o.code) !== -1 && codes.indexOf(o.ressource) === -1) codes.push(o.ressource);
  });
  return codes;
}

module.exports = {
  zeitraumFuer: zeitraumFuer,
  kontext: kontext,
  kontextFuerStart: kontextFuerStart,
  ressourcenVon: ressourcenVon,
};
