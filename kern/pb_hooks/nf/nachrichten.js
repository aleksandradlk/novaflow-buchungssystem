// Outbox for all mails (docs/ENTSCHEIDUNGEN.md E-008).
//  1. erstellen(): render the mail and store it in "nachrichten" (status "offen").
//     The unique "schluessel" makes every event produce at most one mail.
//  2. melden(): webhook to the automation with the key only (no personal data).
//  3. The automation's sub-workflow "Mail senden" calls the internal routes below:
//     versandStart (lock + content, test mode applied) → send → versandErgebnis.
//  4. "nachholen" re-sends what stayed open or failed; "erinnerungen" creates due reminders.

const basis = require(`${__hooks}/nf/basis.js`);
const slots = require(`${__hooks}/nf/slots.js`);
const vorlagen = require(`${__hooks}/nf/mailvorlagen.js`);

const fehler = basis.fehler;

const WEBHOOK = {
  anmeldecode: "anmeldung",
  bestaetigung: "neue-buchung",
  folgetermin: "neue-buchung",
  verschoben: "verschoben-abgesagt",
  abgesagt: "verschoben-abgesagt",
  status: "status",
};

const NACHHOLEN = {
  offenNachMin: 2,       // open longer than this → webhook probably lost
  fehlerAbstandMin: 15,  // wait between retries of failed mails
  maxVersuche: 5,
  inVersandMin: 30,      // "in_versand" longer than this → treat as failed
  maxProLauf: 100,
};

/** Retry waiting times; NF_NACHHOLEN_SOFORT=1 sets them to 0 (tests only). The send lock stays. */
function warten(min) {
  return $os.getenv("NF_NACHHOLEN_SOFORT") === "1" ? 0 : min;
}

function oeffentlicheUrl(cfg) {
  const env = $os.getenv("NF_OEFFENTLICHE_URL");
  return (env || "https://" + cfg.betrieb.domain).replace(/\/+$/, "");
}

/** Is this mail type switched on for the customer? */
function aktiv(cfg, art) {
  if (art === "anmeldecode") return true;
  if (art === "status") return !!cfg.module.status;
  if (art === "kampagne" || art === "nachfass") return !!cfg.module.kampagne;
  if (art === "folgetermin_einladung") return !!cfg.module.folgetermin;
  return !!cfg.module.nachrichten;
}

/**
 * Renders and stores one mail. Returns the record, or null if the key exists already
 * or the mail type is switched off. Runs inside the caller's transaction when given txApp.
 * opts: { schluessel, status: {code,name}, tage, alter_start (stored date string) }
 */
function erstellen(app, cfg, art, buchung, opts) {
  opts = opts || {};
  if (!aktiv(cfg, art)) return null;
  const schluessel = opts.schluessel || art + ":" + buchung.id;
  if (app.findRecordsByFilter("nachrichten", "schluessel = {:s}", "", 1, 0, { s: schluessel }).length > 0) return null;

  const kontakt = app.findRecordById("kontakte", buchung.getString("kontakt"));
  if (!kontakt.getString("email")) return null;
  const angebot = app.findRecordById("angebote", buchung.getString("angebot"));
  const z = basis.zeit(cfg);
  const optionen = basis.json(buchung, "zusatzoptionen", []);
  const typ = basis.termintyp(cfg, buchung.getString("termintyp"));

  const mail = vorlagen.rendern({
    art: art,
    ansprache: cfg.ansprache,
    eigene: cfg.mailvorlagen,
    betrieb: { name: cfg.betrieb.name, firma: cfg.betrieb.firma, farbe: cfg.betrieb.farbe, auf_farbe: cfg.betrieb.auf_farbe },
    kontakt: { anrede: kontakt.getString("anrede"), vorname: kontakt.getString("vorname"), nachname: kontakt.getString("nachname") },
    buchung: {
      angebot: angebot.getString("name"),
      zusatzoptionen: basis.json(angebot, "zusatzoptionen", [])
        .filter(function (o) { return optionen.indexOf(o.code) !== -1; })
        .map(function (o) { return o.name; }),
      termintyp: typ ? typ.name : "",
      termin: z.toLocal(basis.alsMs(buchung.getString("termin_start"))),
      alter_termin: opts.alter_start ? z.toLocal(basis.alsMs(opts.alter_start)) : null,
    },
    status: opts.status && typeof opts.status === "object" ? opts.status : null,
    tage: opts.tage,
    folgetermin: opts.folgetermin || null,
    verwalten_link: oeffentlicheUrl(cfg) + "/verwalten/?t=" + buchung.getString("token_verwalten"),
  });

  const rec = new Record(app.findCollectionByNameOrId("nachrichten"));
  rec.set("art", art);
  rec.set("kontakt", kontakt.id);
  rec.set("buchung", buchung.id);
  rec.set("schluessel", schluessel);
  rec.set("status", typeof opts.status === "string" ? opts.status : "offen");
  rec.set("empfaenger", kontakt.getString("email"));
  rec.set("betreff", mail.betreff);
  rec.set("text", mail.text);
  rec.set("html", mail.html);
  rec.set("versuche", 0);
  app.save(rec);
  return rec;
}

/**
 * Login code for the overview (two-factor). Called from the backend's OTP mail hook
 * instead of its own mailer. Always goes to the real staff address, also in test mode.
 */
function anmeldecode(app, cfg, user, otpId, code) {
  const schluessel = "anmeldecode:" + otpId;
  const mail = vorlagen.rendern({
    art: "anmeldecode",
    ansprache: cfg.ansprache,
    eigene: cfg.mailvorlagen,
    betrieb: { name: cfg.betrieb.name, firma: cfg.betrieb.firma, farbe: cfg.betrieb.farbe, auf_farbe: cfg.betrieb.auf_farbe },
    kontakt: { vorname: user.getString("name"), nachname: "" },
    code: code,
  });
  const rec = new Record(app.findCollectionByNameOrId("nachrichten"));
  rec.set("art", "anmeldecode");
  rec.set("schluessel", schluessel);
  rec.set("status", "offen");
  rec.set("empfaenger", user.getString("email"));
  rec.set("betreff", mail.betreff);
  rec.set("text", mail.text);
  rec.set("html", mail.html);
  rec.set("versuche", 0);
  app.save(rec);
  if ($os.getenv("NF_DEV") === "1") console.log("Anmeldecode (nur lokal sichtbar): " + code + " für " + user.getString("email"));
  return rec;
}

/** Webhook to the automation – key only, never personal data. */
function melden(cfg, rec) {
  if (!rec) return false;
  const art = rec.getString("art");
  return basis.webhook(WEBHOOK[art] || art, { art: art, kunde: cfg.betrieb.kennung, schluessel: rec.getString("schluessel") });
}

// ---------------------------------------------------------------- internal routes (automation only)

/** Shared secret in header X-NF-Secret (same as for the webhooks). */
function pruefeSecret(e) {
  const soll = $os.getenv("NF_WEBHOOK_SECRET");
  const ist = e.request.header.get("X-NF-Secret");
  if (!soll || soll.length < 16 || !ist || !$security.equal(ist, soll)) {
    throw fehler(401, "Nicht berechtigt.");
  }
}

function schluesselAus(e) {
  const b = e.requestInfo().body || {};
  const s = typeof b.schluessel === "string" ? b.schluessel : "";
  if (!s || s.length > 200) throw basis.fehlerFelder({ schluessel: "Schlüssel fehlt." });
  return { s: s, body: b };
}

function minutenAlt(datum, jetzt) {
  const ms = basis.alsMs(datum);
  return isNaN(ms) ? Infinity : (jetzt - ms) / 60000;
}

/**
 * POST /api/nf-intern/versand/start { schluessel }
 * Locks the message for sending and returns its content. Test mode: recipient is
 * replaced by test_empfaenger and the subject shows the real recipient.
 */
function versandStart(e) {
  pruefeSecret(e);
  const s = schluesselAus(e).s;
  const cfg = basis.einstellungen($app);
  let antwort = null;
  $app.runInTransaction(function (tx) {
    let rec;
    try {
      rec = tx.findFirstRecordByFilter("nachrichten", "schluessel = {:s}", { s: s });
    } catch (_) {
      throw fehler(404, "Nachricht nicht gefunden.");
    }
    const jetzt = Date.now();
    const st = rec.getString("status");
    if (st === "gesendet") { antwort = { senden: false, grund: "bereits gesendet" }; return; }
    if (st === "geplant" || st === "uebersprungen") { antwort = { senden: false, grund: "nicht freigegeben" }; return; }
    // advertising mails: consent may have been withdrawn or the contact booked meanwhile
    if (!require(`${__hooks}/nf/kampagne.js`).versandErlaubt(tx, cfg, rec)) {
      rec.set("status", "uebersprungen");
      rec.set("ergebnis", "übersprungen: keine Einwilligung mehr, abgemeldet oder bereits gebucht");
      tx.save(rec);
      antwort = { senden: false, grund: "übersprungen" };
      return;
    }
    if (st === "in_versand" && minutenAlt(rec.getString("letzter_versuch"), jetzt) < NACHHOLEN.inVersandMin) {
      antwort = { senden: false, grund: "wird gerade gesendet" };
      return;
    }
    rec.set("status", "in_versand");
    rec.set("versuche", rec.getInt("versuche") + 1);
    rec.set("letzter_versuch", basis.pbDatum(jetzt));
    tx.save(rec);

    const echt = rec.getString("empfaenger");
    // login codes always go to the real staff address
    const test = cfg.mail_modus !== "live" && rec.getString("art") !== "anmeldecode";
    antwort = {
      senden: true,
      schluessel: s,
      art: rec.getString("art"),
      modus: test ? "test" : "live",
      adapter: cfg.mail_adapter,
      absender: { name: cfg.absender.name || cfg.betrieb.name, email: cfg.absender.email },
      antwort_an: cfg.absender.antwort_an || "",
      empfaenger: test ? cfg.test_empfaenger : echt,
      betreff: (test ? "[TEST → " + echt + "] " : "") + rec.getString("betreff"),
      text: rec.getString("text"),
      html: rec.getString("html"),
    };
  });
  return e.json(200, antwort);
}

/** POST /api/nf-intern/versand/ergebnis { schluessel, ok, adapter?, fehler? } */
function versandErgebnis(e) {
  pruefeSecret(e);
  const x = schluesselAus(e);
  const ok = x.body.ok === true;
  let rec;
  try {
    rec = $app.findFirstRecordByFilter("nachrichten", "schluessel = {:s}", { s: x.s });
  } catch (_) {
    throw fehler(404, "Nachricht nicht gefunden.");
  }
  const jetzt = basis.pbDatum(Date.now());
  if (ok) {
    rec.set("status", "gesendet");
    rec.set("gesendet_am", jetzt);
    rec.set("ergebnis", ("gesendet " + (x.body.adapter || "")).trim());
    // the code is not kept once it has been delivered
    if (rec.getString("art") === "anmeldecode") {
      rec.set("text", "");
      rec.set("html", "");
      rec.set("betreff", "Anmeldecode");
    }
  } else {
    rec.set("status", "fehler");
    rec.set("ergebnis", ("fehler: " + String(x.body.fehler || "unbekannt")).slice(0, 500));
  }
  $app.save(rec);

  // advertising mails: timestamps on the contact (basis for the follow-up series)
  const art = rec.getString("art");
  if (ok && (art === "kampagne" || art === "nachfass")) {
    try {
      const k = $app.findRecordById("kontakte", rec.getString("kontakt"));
      k.set(art === "kampagne" ? "kampagne_am" : "nachfass_" + x.s.split(":")[2] + "_am", jetzt);
      $app.save(k);
    } catch (_) { /* contact deleted meanwhile */ }
  }

  // status mails: remember in the status log that the mail went out
  if (ok && rec.getString("art") === "status") {
    const logId = x.s.split(":")[1];
    try {
      const log = $app.findRecordById("status_log", logId);
      log.set("mail_gesendet", true);
      $app.save(log);
    } catch (_) { /* log entry deleted meanwhile */ }
  }
  return e.json(200, {
    ok: true,
    status: rec.getString("status"),
    versuche: rec.getInt("versuche"),
    aufgegeben: !ok && rec.getInt("versuche") >= NACHHOLEN.maxVersuche,
  });
}

/**
 * POST /api/nf-intern/erinnerungen
 * Creates reminders for appointments exactly N days ahead (N from nachrichten.json),
 * returns the keys of the newly created ones. Running twice creates nothing new.
 */
function erinnerungen(e) {
  pruefeSecret(e);
  const cfg = basis.einstellungen($app);
  const neu = [];
  if (!cfg.module.nachrichten) return e.json(200, { schluessel: neu });
  const z = basis.zeit(cfg);
  const heute = basis.heuteLokal(cfg);
  const tage = (cfg.nachrichten && cfg.nachrichten.erinnerungen_tage_vorher) || [];
  tage.forEach(function (n) {
    const datum = slots.addTage(heute, n);
    const von = basis.pbDatum(z.toUtcMs(datum, "00:00"));
    const bis = basis.pbDatum(z.toUtcMs(slots.addTage(datum, 1), "00:00"));
    $app.findRecordsByFilter(
      "buchungen",
      "termin_start >= {:von} && termin_start < {:bis} && abgesagt_am = '' && abgeschlossen_am = ''",
      "termin_start", 0, 0, { von: von, bis: bis },
    ).forEach(function (b) {
      $app.runInTransaction(function (tx) {
        const rec = erstellen(tx, cfg, "erinnerung", b, { schluessel: "erinnerung:" + b.id + ":" + n, tage: n });
        if (rec) neu.push(rec.getString("schluessel"));
      });
    });
  });
  return e.json(200, { schluessel: neu });
}

/** GET /api/nf-intern/offen – keys of mails to (re)send: lost webhooks, failures, stuck sends. */
function offen(e) {
  pruefeSecret(e);
  const jetzt = Date.now();
  // +1 s so that "0 minutes" also covers records written in this very second
  const vor = function (min) { return basis.pbDatum(jetzt - min * 60000 + (min === 0 ? 1000 : 0)); };
  const liste = $app.findRecordsByFilter(
    "nachrichten",
    "(status = 'offen' && created < {:offen}) || " +
    "(status = 'fehler' && versuche < {:max} && letzter_versuch < {:fehler}) || " +
    "(status = 'in_versand' && letzter_versuch < {:haengt})",
    "created", NACHHOLEN.maxProLauf, 0,
    {
      offen: vor(warten(NACHHOLEN.offenNachMin)),
      max: NACHHOLEN.maxVersuche,
      fehler: vor(warten(NACHHOLEN.fehlerAbstandMin)),
      haengt: vor(NACHHOLEN.inVersandMin), // the send lock is never shortened
    },
  );
  return e.json(200, { schluessel: liste.map(function (r) { return r.getString("schluessel"); }) });
}

module.exports = {
  NACHHOLEN: NACHHOLEN,
  erstellen: erstellen,
  anmeldecode: anmeldecode,
  pruefeSecret: pruefeSecret,
  melden: melden,
  versandStart: versandStart,
  versandErgebnis: versandErgebnis,
  erinnerungen: erinnerungen,
  offen: offen,
};
