// Handlers for the public routes /api/nf/* (docs/BAUAUFTRAG_VORLAGE.md, section 5).

const basis = require(`${__hooks}/nf/basis.js`);
const slots = require(`${__hooks}/nf/slots.js`);
const kap = require(`${__hooks}/nf/kapazitaet.js`);

const fehler = basis.fehler;
const MAX_TAGE_SLOTS = 62;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEFON = /^\+?[0-9 ()\/-]{6,30}$/;
const PLZ = /^[0-9]{5}$/;
const BILD = /\.(jpe?g|png|webp|heic|heif)$/i;
const KANAELE = ["email", "whatsapp"];

const TEXT = {
  nichtAktiv: "Die Online-Buchung ist derzeit nicht aktiv.",
  angebotFehlt: "Dieses Angebot ist nicht verfügbar.",
  slotUngueltig: "Dieser Termin ist nicht buchbar. Bitte einen anderen Termin wählen.",
  slotVoll: "Dieser Termin ist leider gerade vergeben. Bitte einen anderen Termin wählen.",
  nichtAenderbar: "Dieser Termin kann nicht mehr online geändert werden.",
  folgeNicht: "Für diese Buchung ist kein Folgetermin möglich.",
  folgeSchon: "Für diese Buchung ist bereits ein Folgetermin gebucht.",
};

// ---------------------------------------------------------------- helpers

function iso(s) {
  const ms = basis.alsMs(s);
  return isNaN(ms) ? "" : new Date(ms).toISOString();
}

function str(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function angebotAktiv(app, code) {
  if (typeof code !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(code)) return null;
  try {
    const a = app.findFirstRecordByFilter("angebote", "code = {:c} && aktiv = true", { c: code });
    return a;
  } catch (_) {
    return null;
  }
}

function findeBuchung(app, t) {
  if (!t) return null;
  try {
    return app.findFirstRecordByFilter("buchungen", "token_verwalten = {:t}", { t: t });
  } catch (_) {
    return null;
  }
}

function findeKontakt(app, filter, params) {
  try {
    return app.findFirstRecordByFilter("kontakte", filter, params);
  } catch (_) {
    return null;
  }
}

function aktivesKind(app, elternId) {
  const kinder = app.findRecordsByFilter("buchungen", "eltern_buchung = {:id} && abgesagt_am = ''", "termin_start", 1, 0, { id: elternId });
  return kinder.length > 0 ? kinder[0] : null;
}

function buchungDto(app, cfg, b) {
  const angebot = app.findRecordById("angebote", b.getString("angebot"));
  const typ = basis.termintyp(cfg, b.getString("termintyp")) || { code: b.getString("termintyp"), name: b.getString("termintyp") };
  const st = basis.status(cfg, b.getString("status")) || { code: b.getString("status"), name: b.getString("status") };
  const kontakt = app.findRecordById("kontakte", b.getString("kontakt"));
  const optionen = basis.json(b, "zusatzoptionen", []);
  const alleOptionen = basis.json(angebot, "zusatzoptionen", []);
  return {
    angebot: { code: angebot.getString("code"), name: angebot.getString("name") },
    zusatzoptionen: alleOptionen.filter(function (o) { return optionen.indexOf(o.code) !== -1; })
      .map(function (o) { return { code: o.code, name: o.name }; }),
    termintyp: { code: typ.code, name: typ.name },
    start: iso(b.getString("termin_start")),
    ende: iso(b.getString("termin_ende")),
    status: { code: st.code, name: st.name },
    abgesagt: b.getString("abgesagt_am") !== "",
    folgetermin_zu_buchung: b.getString("eltern_buchung") !== "",
    kontakt: { vorname: kontakt.getString("vorname"), nachname: kontakt.getString("nachname") },
  };
}

/** Webhook payload – everything the automation needs for the mail. */
function payload(app, cfg, art, b, extra) {
  const kontakt = app.findRecordById("kontakte", b.getString("kontakt"));
  return Object.assign({
    art: art,
    kunde: cfg.betrieb.kennung,
    ansprache: cfg.ansprache,
    buchung_id: b.id,
    buchung: buchungDto(app, cfg, b),
    verwalten_token: b.getString("token_verwalten"),
    kontakt: {
      id: kontakt.id,
      anrede: kontakt.getString("anrede"),
      vorname: kontakt.getString("vorname"),
      nachname: kontakt.getString("nachname"),
      email: kontakt.getString("email"),
    },
  }, extra || {});
}

function aenderbar(b) {
  return b.getString("abgesagt_am") === "" &&
    b.getString("abgeschlossen_am") === "" &&
    basis.alsMs(b.getString("termin_start")) > Date.now();
}

function folgeterminInfo(app, cfg, b) {
  const angebot = app.findRecordById("angebote", b.getString("angebot"));
  const berechtigt = !!cfg.module.folgetermin && !!cfg.folgetermin_typ &&
    angebot.getBool("folgetermin") &&
    b.getString("eltern_buchung") === "" &&
    b.getString("abgesagt_am") === "";
  if (!berechtigt) return { berechtigt: false };
  const typ = basis.termintyp(cfg, cfg.folgetermin_typ);
  const kind = aktivesKind(app, b.id);
  return {
    berechtigt: true,
    termintyp: typ ? { code: typ.code, name: typ.name } : null,
    ab: cfg.folgetermin_ab,
    bis: cfg.folgetermin_bis,
    buchung: kind ? buchungDto(app, cfg, kind) : null,
    verwalten_token: kind ? kind.getString("token_verwalten") : null,
  };
}

/** Parses a start time sent by the page (ISO string). */
function startAus(wert, feld) {
  const ms = typeof wert === "string" ? Date.parse(wert) : NaN;
  if (isNaN(ms)) {
    const f = {};
    f[feld || "start"] = "Bitte einen Termin auswählen.";
    throw basis.fehlerFelder(f);
  }
  return ms;
}

/** Runs fn in a transaction; ApiErrors pass through, save validation errors become German. */
function transaktion(fn) {
  let ergebnis;
  try {
    $app.runInTransaction(function (tx) {
      ergebnis = fn(tx);
    });
  } catch (err) {
    const api = basis.apiFehler(err);
    if (api) throw api;
    const s = String(err);
    if (s.indexOf("fotos") !== -1) {
      throw basis.fehlerFelder({ fotos: "Bitte nur Bilder (JPG, PNG, WebP, HEIC) im erlaubten Umfang hochladen." });
    }
    throw err;
  }
  return ergebnis;
}

// ---------------------------------------------------------------- validation of booking data

function pruefeBuchungsdaten(cfg, d, angebot, dateien) {
  const f = {};
  const form = cfg.formular;
  const k = d.kontakt || {};
  const kontakt = {
    anrede: str(k.anrede),
    vorname: str(k.vorname),
    nachname: str(k.nachname),
    email: str(k.email).toLowerCase(),
    telefon: str(k.telefon),
    strasse: str(k.strasse),
    plz: str(k.plz),
    ort: str(k.ort),
  };

  if (["", "Frau", "Herr"].indexOf(kontakt.anrede) === -1) f["kontakt.anrede"] = "Bitte eine gültige Anrede wählen.";
  if (!kontakt.vorname || kontakt.vorname.length > 100) f["kontakt.vorname"] = "Bitte den Vornamen angeben.";
  if (!kontakt.nachname || kontakt.nachname.length > 100) f["kontakt.nachname"] = "Bitte den Nachnamen angeben.";
  if (!EMAIL.test(kontakt.email) || kontakt.email.length > 254) f["kontakt.email"] = "Bitte eine gültige E-Mail-Adresse angeben.";

  if (form.telefon === "aus") kontakt.telefon = "";
  else if (kontakt.telefon && !TELEFON.test(kontakt.telefon)) f["kontakt.telefon"] = "Bitte eine gültige Telefonnummer angeben.";
  else if (!kontakt.telefon && form.telefon === "pflicht") f["kontakt.telefon"] = "Bitte eine Telefonnummer angeben.";

  if (form.adresse === "aus") {
    kontakt.strasse = kontakt.plz = kontakt.ort = "";
  } else {
    const teil = kontakt.strasse || kontakt.plz || kontakt.ort;
    if (form.adresse === "pflicht" || teil) {
      if (!kontakt.strasse || kontakt.strasse.length > 200) f["kontakt.strasse"] = "Bitte Straße und Hausnummer angeben.";
      if (!PLZ.test(kontakt.plz)) f["kontakt.plz"] = "Bitte eine gültige Postleitzahl angeben.";
      if (!kontakt.ort || kontakt.ort.length > 100) f["kontakt.ort"] = "Bitte den Ort angeben.";
    }
  }

  // extra fields from the customer configuration
  const zf = d.zusatzfelder || {};
  const zusatzKontakt = {};
  const zusatzBuchung = {};
  (form.zusatzfelder || []).forEach(function (feld) {
    const roh = zf[feld.key];
    const wert = str(roh);
    const key = "zusatzfelder." + feld.key;
    if (!wert) {
      if (feld.pflicht) f[key] = "Bitte „" + feld.label + "“ angeben.";
      return;
    }
    let ok = true;
    let v = wert;
    if (feld.typ === "text") ok = wert.length <= 200;
    else if (feld.typ === "mehrzeilig") ok = wert.length <= 2000;
    else if (feld.typ === "zahl") { v = Number(wert.replace(",", ".")); ok = isFinite(v); }
    else if (feld.typ === "auswahl") ok = (feld.optionen || []).indexOf(wert) !== -1;
    if (!ok) { f[key] = "Bitte „" + feld.label + "“ prüfen."; return; }
    (feld.ziel === "kontakt" ? zusatzKontakt : zusatzBuchung)[feld.key] = v;
  });

  // options of the chosen offer
  const gewaehlt = Array.isArray(d.zusatzoptionen) ? d.zusatzoptionen : [];
  const erlaubt = basis.json(angebot, "zusatzoptionen", []).map(function (o) { return o.code; });
  const optionen = [];
  gewaehlt.forEach(function (c) {
    if (erlaubt.indexOf(c) === -1) f.zusatzoptionen = "Bitte nur angebotene Zusatzoptionen wählen.";
    else if (optionen.indexOf(c) === -1) optionen.push(c);
  });

  // consents: only configured channels, never preselected
  const konfiguriert = (cfg.rechtliches.einwilligungen || []).map(function (e) { return e.kanal; });
  const einw = d.einwilligungen || {};
  const einwilligungen = {};
  KANAELE.forEach(function (kanal) {
    einwilligungen[kanal] = konfiguriert.indexOf(kanal) !== -1 && einw[kanal] === true;
  });

  const bemerkung = str(d.bemerkung);
  if (bemerkung.length > 2000) f.bemerkung = "Die Bemerkung ist zu lang (höchstens 2000 Zeichen).";

  // photos
  const fotos = form.fotos || { erlaubt: false };
  if (dateien.length > 0) {
    if (!fotos.erlaubt) f.fotos = "Fotos können hier nicht hochgeladen werden.";
    else if (dateien.length > fotos.max_anzahl) f.fotos = "Bitte höchstens " + fotos.max_anzahl + " Fotos hochladen.";
    else {
      dateien.forEach(function (file) {
        if (!BILD.test(file.originalName)) f.fotos = "Bitte nur Bilder (JPG, PNG, WebP, HEIC) hochladen.";
        else if (file.size > fotos.max_mb * 1024 * 1024) f.fotos = "Jedes Foto darf höchstens " + fotos.max_mb + " MB groß sein.";
      });
    }
  }

  if (Object.keys(f).length > 0) throw basis.fehlerFelder(f);
  return {
    kontakt: kontakt,
    zusatzKontakt: zusatzKontakt,
    zusatzBuchung: zusatzBuchung,
    optionen: optionen,
    einwilligungen: einwilligungen,
    bemerkung: bemerkung,
  };
}

/** Finds the contact (token > e-mail) or creates it; stores consents with date and source. */
function kontaktSpeichern(tx, cfg, daten, t) {
  let k = t ? findeKontakt(tx, "token = {:t}", { t: t }) : null;
  const perToken = !!k;
  if (!k) k = findeKontakt(tx, "email = {:e}", { e: daten.kontakt.email });
  const neu = !k;
  if (neu) {
    k = new Record(tx.findCollectionByNameOrId("kontakte"));
    k.set("token", basis.neuesToken());
  }
  const ueberschreiben = neu || perToken;

  Object.keys(daten.kontakt).forEach(function (feld) {
    const v = daten.kontakt[feld];
    if (!v) return;
    if (ueberschreiben || !k.getString(feld)) k.set(feld, v);
  });
  const zusatz = basis.json(k, "zusatzfelder", {});
  Object.keys(daten.zusatzKontakt).forEach(function (key) {
    if (ueberschreiben || zusatz[key] === undefined || zusatz[key] === "") zusatz[key] = daten.zusatzKontakt[key];
  });
  k.set("zusatzfelder", zusatz);

  const jetzt = basis.pbDatum(Date.now());
  KANAELE.forEach(function (kanal) {
    if (!daten.einwilligungen[kanal]) return;
    if (!k.getBool("einwilligung_" + kanal)) {
      k.set("einwilligung_" + kanal, true);
      k.set("einwilligung_" + kanal + "_am", jetzt);
      k.set("einwilligung_" + kanal + "_quelle", "buchung");
    }
    if (kanal === "email" && k.getBool("abgemeldet")) {
      k.set("abgemeldet", false);
      k.set("abgemeldet_am", "");
    }
  });
  tx.save(k);
  return k;
}

// ---------------------------------------------------------------- GET /api/nf/angebot?t=

function angebot(e) {
  const cfg = basis.einstellungen($app);
  if (!cfg.module.buchung) throw fehler(403, TEXT.nichtAktiv);
  const ansprache = cfg.ansprache === "du" ? "du" : "sie";

  const angebote = $app.findRecordsByFilter("angebote", "aktiv = true", "sortierung,name", 0, 0).map(function (a) {
    return {
      code: a.getString("code"),
      name: a.getString("name"),
      beschreibung: a.getString("beschreibung"),
      preis_text: a.getString("preis_text"),
      termintyp: a.getString("termintyp"),
      folgetermin: !!cfg.module.folgetermin && a.getBool("folgetermin"),
      zusatzoptionen: basis.json(a, "zusatzoptionen", []).map(function (o) {
        return { code: o.code, name: o.name, beschreibung: o.beschreibung || "", preis_text: o.preis_text || "" };
      }),
    };
  });
  const typen = cfg.termintypen.filter(function (t) {
    return angebote.some(function (a) { return a.termintyp === t.code; });
  });

  let kontakt = null;
  const t = basis.token(e);
  const k = t ? findeKontakt($app, "token = {:t}", { t: t }) : null;
  if (k) {
    const zusatz = basis.json(k, "zusatzfelder", {});
    const erlaubt = (cfg.formular.zusatzfelder || []).filter(function (f) { return f.ziel === "kontakt"; }).map(function (f) { return f.key; });
    const zf = {};
    erlaubt.forEach(function (key) { if (zusatz[key] !== undefined) zf[key] = zusatz[key]; });
    kontakt = {
      anrede: k.getString("anrede"),
      vorname: k.getString("vorname"),
      nachname: k.getString("nachname"),
      email: k.getString("email"),
      telefon: k.getString("telefon"),
      strasse: k.getString("strasse"),
      plz: k.getString("plz"),
      ort: k.getString("ort"),
      zusatzfelder: zf,
      einwilligungen: { email: k.getBool("einwilligung_email"), whatsapp: k.getBool("einwilligung_whatsapp") },
    };
  }

  return e.json(200, {
    betrieb: { name: cfg.betrieb.name, logo: cfg.betrieb.logo ? "/kunde/" + cfg.betrieb.logo : "" },
    ansprache: ansprache,
    texte: cfg.hinweistexte[ansprache] || {},
    angebote: angebote,
    termintypen: typen.map(function (t) { return { code: t.code, name: t.name, dauer_minuten: t.dauer_minuten }; }),
    zeitraum: { ab: cfg.buchbar_ab, bis: cfg.buchbar_bis },
    formular: cfg.formular,
    einwilligungen: (cfg.rechtliches.einwilligungen || []).map(function (x) {
      return { kanal: x.kanal, text: x.text[ansprache] };
    }),
    rechtliches: { impressum_url: cfg.rechtliches.impressum_url, datenschutz_url: cfg.rechtliches.datenschutz_url },
    kontakt: kontakt,
  });
}

// ---------------------------------------------------------------- GET /api/nf/slots?typ=&von=&bis=[&angebot=&optionen=]

function slotsRoute(e) {
  const cfg = basis.einstellungen($app);
  if (!cfg.module.buchung) throw fehler(403, TEXT.nichtAktiv);
  const q = e.request.url.query();
  const von = q.get("von");
  const bis = q.get("bis");
  const typ = basis.termintyp(cfg, q.get("typ"));

  const f = {};
  if (!typ) f.typ = "Unbekannter Termintyp.";
  if (!slots.istDatum(von)) f.von = "Bitte ein gültiges Startdatum angeben (JJJJ-MM-TT).";
  if (!slots.istDatum(bis)) f.bis = "Bitte ein gültiges Enddatum angeben (JJJJ-MM-TT).";
  if (!f.von && !f.bis) {
    if (bis < von) f.bis = "Das Enddatum liegt vor dem Startdatum.";
    else if (slots.tageZwischen(von, bis) > MAX_TAGE_SLOTS) f.bis = "Bitte höchstens " + MAX_TAGE_SLOTS + " Tage auf einmal abfragen.";
  }
  if (Object.keys(f).length > 0) throw basis.fehlerFelder(f);

  let ress = [];
  const code = q.get("angebot");
  if (code) {
    const a = angebotAktiv($app, code);
    if (!a || a.getString("termintyp") !== typ.code) throw basis.fehlerFelder({ angebot: TEXT.angebotFehlt });
    const optionen = q.get("optionen") ? q.get("optionen").split(",") : [];
    ress = kap.ressourcenVon(a, optionen);
  }

  const ctx = kap.kontext($app, cfg, typ, von, bis, ress, "");
  const res = slots.berechneSlots(ctx);
  return e.json(200, {
    typ: { code: typ.code, name: typ.name, dauer_minuten: typ.dauer_minuten },
    zeitraum: ctx.zeitraum,
    slots: res.slots,
    sperrtage: res.sperrtage,
  });
}

// ---------------------------------------------------------------- POST /api/nf/buchen

function buchen(e) {
  const cfg = basis.einstellungen($app);
  if (!cfg.module.buchung) throw fehler(403, TEXT.nichtAktiv);
  const d = basis.body(e);

  const a = angebotAktiv($app, d.angebot);
  if (!a) throw basis.fehlerFelder({ angebot: TEXT.angebotFehlt });
  const typ = basis.termintyp(cfg, a.getString("termintyp"));
  if (!typ || typ.code === cfg.folgetermin_typ) throw basis.fehlerFelder({ angebot: TEXT.angebotFehlt });
  const startMs = startAus(d.start);

  let dateien = [];
  try {
    dateien = e.findUploadedFiles("fotos") || [];
  } catch (_) {
    dateien = [];
  }
  const daten = pruefeBuchungsdaten(cfg, d, a, dateien);
  const ress = kap.ressourcenVon(a, daten.optionen);
  const t = basis.token(e) || (typeof d.t === "string" && /^[A-Za-z0-9]{32,64}$/.test(d.t) ? d.t : "");
  const start = basis.startStatus(cfg);

  const b = transaktion(function (tx) {
    const ctx = kap.kontextFuerStart(tx, cfg, typ, startMs, ress, "");
    const slot = slots.freiAm(ctx, startMs);
    if (!slot) throw fehler(409, TEXT.slotUngueltig);
    if (slot.frei < 1) throw fehler(409, TEXT.slotVoll);

    const k = kontaktSpeichern(tx, cfg, daten, t);
    const rec = new Record(tx.findCollectionByNameOrId("buchungen"));
    rec.set("kontakt", k.id);
    rec.set("angebot", a.id);
    rec.set("zusatzoptionen", daten.optionen);
    rec.set("termintyp", typ.code);
    rec.set("termin_start", basis.pbDatum(startMs));
    rec.set("termin_ende", basis.pbDatum(startMs + typ.dauer_minuten * 60000));
    rec.set("zusatzfelder", daten.zusatzBuchung);
    rec.set("status", start.code);
    rec.set("ressourcen", ress);
    rec.set("token_verwalten", basis.neuesToken());
    rec.set("bemerkung", daten.bemerkung);
    if (dateien.length > 0) rec.set("fotos", dateien);
    tx.save(rec);
    return rec;
  });

  basis.webhook("neue-buchung", payload($app, cfg, "neue-buchung", b));
  return e.json(201, {
    ok: true,
    buchung: buchungDto($app, cfg, b),
    verwalten_token: b.getString("token_verwalten"),
  });
}

// ---------------------------------------------------------------- GET/POST /api/nf/verwalten?t=

function verwaltenLesen(e) {
  const cfg = basis.einstellungen($app);
  const b = findeBuchung($app, basis.token(e));
  if (!b) throw fehler(404, basis.MELDUNG.linkUngueltig);
  const offen = aenderbar(b);
  return e.json(200, {
    buchung: buchungDto($app, cfg, b),
    aktionen: { verschieben: offen, absagen: offen },
    folgetermin: folgeterminInfo($app, cfg, b),
  });
}

function verwaltenAendern(e) {
  const cfg = basis.einstellungen($app);
  const t = basis.token(e);
  if (!findeBuchung($app, t)) throw fehler(404, basis.MELDUNG.linkUngueltig);
  const d = basis.body(e);

  if (d.aktion === "verschieben") {
    const startMs = startAus(d.start);
    let altStart = "";
    const b = transaktion(function (tx) {
      const rec = findeBuchung(tx, t);
      if (!aenderbar(rec)) throw fehler(409, TEXT.nichtAenderbar);
      altStart = iso(rec.getString("termin_start"));
      const typ = basis.termintyp(cfg, rec.getString("termintyp"));
      if (!typ) throw fehler(409, TEXT.nichtAenderbar);
      const ctx = kap.kontextFuerStart(tx, cfg, typ, startMs, basis.json(rec, "ressourcen", []), rec.id);
      const slot = slots.freiAm(ctx, startMs);
      if (!slot) throw fehler(409, TEXT.slotUngueltig);
      if (slot.frei < 1) throw fehler(409, TEXT.slotVoll);
      rec.set("termin_start", basis.pbDatum(startMs));
      rec.set("termin_ende", basis.pbDatum(startMs + typ.dauer_minuten * 60000));
      tx.save(rec);
      return rec;
    });
    basis.webhook("verschoben-abgesagt", payload($app, cfg, "verschoben", b, { alter_start: altStart }));
    return e.json(200, { ok: true, buchung: buchungDto($app, cfg, b) });
  }

  if (d.aktion === "absagen") {
    const abgesagt = [];
    transaktion(function (tx) {
      const rec = findeBuchung(tx, t);
      if (!aenderbar(rec)) throw fehler(409, TEXT.nichtAenderbar);
      const jetzt = basis.pbDatum(Date.now());
      rec.set("abgesagt_am", jetzt);
      tx.save(rec);
      abgesagt.push(rec);
      // a follow-up appointment makes no sense without its booking
      tx.findRecordsByFilter("buchungen", "eltern_buchung = {:id} && abgesagt_am = ''", "", 0, 0, { id: rec.id }).forEach(function (kind) {
        kind.set("abgesagt_am", jetzt);
        tx.save(kind);
        abgesagt.push(kind);
      });
    });
    abgesagt.forEach(function (rec) {
      basis.webhook("verschoben-abgesagt", payload($app, cfg, "abgesagt", rec));
    });
    return e.json(200, { ok: true, buchung: buchungDto($app, cfg, abgesagt[0]) });
  }

  throw basis.fehlerFelder({ aktion: "Unbekannte Aktion." });
}

// ---------------------------------------------------------------- GET/POST /api/nf/folgetermin?t=

function folgeterminLesen(e) {
  const cfg = basis.einstellungen($app);
  const b = findeBuchung($app, basis.token(e));
  if (!b) throw fehler(404, basis.MELDUNG.linkUngueltig);
  return e.json(200, { buchung: buchungDto($app, cfg, b), folgetermin: folgeterminInfo($app, cfg, b) });
}

function folgeterminBuchen(e) {
  const cfg = basis.einstellungen($app);
  const t = basis.token(e);
  if (!findeBuchung($app, t)) throw fehler(404, basis.MELDUNG.linkUngueltig);
  const d = basis.body(e);
  const startMs = startAus(d.start);
  const typ = basis.termintyp(cfg, cfg.folgetermin_typ);
  const start = basis.startStatus(cfg);

  const kind = transaktion(function (tx) {
    const eltern = findeBuchung(tx, t);
    const info = folgeterminInfo(tx, cfg, eltern);
    if (!info.berechtigt || !typ) throw fehler(403, TEXT.folgeNicht);
    if (info.buchung) throw fehler(409, TEXT.folgeSchon);
    const ctx = kap.kontextFuerStart(tx, cfg, typ, startMs, [], "");
    const slot = slots.freiAm(ctx, startMs);
    if (!slot) throw fehler(409, TEXT.slotUngueltig);
    if (slot.frei < 1) throw fehler(409, TEXT.slotVoll);

    const rec = new Record(tx.findCollectionByNameOrId("buchungen"));
    rec.set("kontakt", eltern.getString("kontakt"));
    rec.set("angebot", eltern.getString("angebot"));
    rec.set("zusatzoptionen", []);
    rec.set("termintyp", typ.code);
    rec.set("termin_start", basis.pbDatum(startMs));
    rec.set("termin_ende", basis.pbDatum(startMs + typ.dauer_minuten * 60000));
    rec.set("zusatzfelder", {});
    rec.set("status", start.code);
    rec.set("ressourcen", []);
    rec.set("token_verwalten", basis.neuesToken());
    rec.set("eltern_buchung", eltern.id);
    tx.save(rec);
    return rec;
  });

  basis.webhook("neue-buchung", payload($app, cfg, "folgetermin", kind));
  return e.json(201, {
    ok: true,
    buchung: buchungDto($app, cfg, kind),
    verwalten_token: kind.getString("token_verwalten"),
  });
}

// ---------------------------------------------------------------- GET /api/nf/abmelden?t=

function abmelden(e) {
  const t = basis.token(e);
  const k = t ? findeKontakt($app, "token = {:t}", { t: t }) : null;
  if (!k) throw fehler(404, basis.MELDUNG.linkUngueltig);
  if (!k.getBool("abgemeldet")) {
    k.set("abgemeldet", true);
    k.set("abgemeldet_am", basis.pbDatum(Date.now()));
    $app.save(k);
  }
  return e.json(200, { ok: true });
}

module.exports = {
  angebot: angebot,
  slots: slotsRoute,
  buchen: buchen,
  verwaltenLesen: verwaltenLesen,
  verwaltenAendern: verwaltenAendern,
  folgeterminLesen: folgeterminLesen,
  folgeterminBuchen: folgeterminBuchen,
  abmelden: abmelden,
};
