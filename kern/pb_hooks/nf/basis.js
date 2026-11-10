// Shared helpers for the custom routes and hooks.
// Messages are German and impersonal, so they fit both du and Sie.

const MELDUNG = {
  intern: "Es ist ein Fehler aufgetreten. Bitte später noch einmal versuchen.",
  nichtEingerichtet: "Die Online-Buchung ist noch nicht eingerichtet.",
  linkUngueltig: "Dieser Link ist ungültig oder nicht mehr aktuell.",
  eingabe: "Bitte die markierten Angaben prüfen.",
  zuViele: "Zu viele Anfragen. Bitte einen Moment warten und dann erneut versuchen.",
  zuGross: "Die gesendeten Daten sind zu groß. Bitte weniger oder kleinere Fotos auswählen.",
};

/** Throwable German API error. */
function fehler(status, message, data) {
  return new ApiError(status, message, data || {});
}

/** Field validation error: fehlerFelder({ email: "Bitte …" }) */
function fehlerFelder(felder) {
  const data = {};
  Object.keys(felder).forEach(function (k) {
    data[k] = new ValidationError("ungueltig", felder[k]);
  });
  return fehler(400, MELDUNG.eingabe, data);
}

/** Returns the API error behind err (also when wrapped in a GoError), or null. */
function apiFehler(err) {
  const kandidaten = [err, err && err.value];
  for (let i = 0; i < kandidaten.length; i++) {
    const k = kandidaten[i];
    if (k && typeof k.status === "number" && k.status >= 400 && typeof k.message === "string") return k;
  }
  return null;
}

function istApiError(err) {
  return apiFehler(err) !== null;
}

/** Runs a route body; unknown errors become a generic German 500 without technical details. */
function sicher(e, fn) {
  try {
    return fn();
  } catch (err) {
    const api = apiFehler(err);
    if (api) throw api;
    $app.logger().error("nf route error", "path", e.request.url.path, "error", String(err));
    throw fehler(500, MELDUNG.intern);
  }
}

function json(rec, key, fallback) {
  const raw = rec.get(key);
  if (raw === null || raw === undefined) return fallback;
  const s = toString(raw);
  if (!s || s === "null") return fallback;
  return JSON.parse(s);
}

/** Loads the single settings record as plain object. */
function einstellungen(app) {
  let rec;
  try {
    rec = app.findFirstRecordByFilter("einstellungen", "id != ''");
  } catch (_) {
    throw fehler(503, MELDUNG.nichtEingerichtet);
  }
  return {
    buchbar_ab: rec.getString("buchbar_ab"),
    buchbar_bis: rec.getString("buchbar_bis"),
    folgetermin_ab: rec.getString("folgetermin_ab"),
    folgetermin_bis: rec.getString("folgetermin_bis"),
    folgetermin_typ: rec.getString("folgetermin_typ"),
    max_pro_woche: rec.getInt("max_pro_woche"),
    ressourcen: json(rec, "ressourcen", []),
    termintypen: json(rec, "termintypen", []),
    status_liste: json(rec, "status_liste", []),
    ansprache: rec.getString("ansprache"),
    hinweistexte: json(rec, "hinweistexte", { du: {}, sie: {} }),
    betrieb: json(rec, "betrieb", {}),
    module: json(rec, "module", {}),
    formular: json(rec, "formular", {}),
    rollen: json(rec, "rollen", {}),
    rechtliches: json(rec, "rechtliches", {}),
    mail_modus: rec.getString("mail_modus"),
    mail_adapter: rec.getString("mail_adapter"),
    test_empfaenger: rec.getString("test_empfaenger"),
    absender: json(rec, "absender", {}),
    nachrichten: json(rec, "nachrichten", {}),
    mailvorlagen: json(rec, "mailvorlagen", { du: {}, sie: {} }),
  };
}

function termintyp(cfg, code) {
  for (let i = 0; i < cfg.termintypen.length; i++) {
    if (cfg.termintypen[i].code === code) return cfg.termintypen[i];
  }
  return null;
}

function status(cfg, code) {
  for (let i = 0; i < cfg.status_liste.length; i++) {
    if (cfg.status_liste[i].code === code) return cfg.status_liste[i];
  }
  return null;
}

function startStatus(cfg) {
  for (let i = 0; i < cfg.status_liste.length; i++) {
    if (cfg.status_liste[i].start) return cfg.status_liste[i];
  }
  throw fehler(503, MELDUNG.nichtEingerichtet);
}

/** Time converters for the customer's time zone (see slots.js). */
function zeit(cfg) {
  const tz = cfg.betrieb.zeitzone || "Europe/Berlin";
  const loc = new Timezone(tz);
  return {
    toUtcMs: function (datum, uhrzeit) {
      return new DateTime(datum + " " + uhrzeit + ":00", tz).unix() * 1000;
    },
    toLocal: function (ms) {
      const s = new DateTime(pbDatum(ms)).time().in(loc).format("2006-01-02 15:04");
      return { datum: s.slice(0, 10), zeit: s.slice(11, 16) };
    },
  };
}

/** epoch ms -> "2030-01-07 07:00:00.000Z" (storage format) */
function pbDatum(ms) {
  return new Date(ms).toISOString().replace("T", " ");
}

/** stored date string -> epoch ms (NaN if empty) */
function alsMs(s) {
  return s ? Date.parse(String(s).replace(" ", "T")) : NaN;
}

/** Page frame info for every public page: name, logo, time zone, texts, legal links. */
function seite(cfg) {
  const ansprache = cfg.ansprache === "du" ? "du" : "sie";
  return {
    betrieb: { name: cfg.betrieb.name, logo: cfg.betrieb.logo ? "/kunde/" + cfg.betrieb.logo : "" },
    zeitzone: cfg.betrieb.zeitzone || "Europe/Berlin",
    ansprache: ansprache,
    texte: cfg.hinweistexte[ansprache] || {},
    rechtliches: { impressum_url: cfg.rechtliches.impressum_url, datenschutz_url: cfg.rechtliches.datenschutz_url },
  };
}

function heuteLokal(cfg) {
  return zeit(cfg).toLocal(Date.now()).datum;
}

/** Token from query; only plausible tokens hit the database. */
function token(e) {
  const t = e.request.url.query().get("t");
  return /^[A-Za-z0-9]{32,64}$/.test(t) ? t : "";
}

function neuesToken() {
  return $security.randomString(40);
}

/** Request body for JSON or multipart (multipart: JSON in field "daten"). */
function body(e) {
  const b = e.requestInfo().body || {};
  if (typeof b.daten === "string") {
    try {
      return JSON.parse(b.daten);
    } catch (_) {
      throw fehler(400, MELDUNG.eingabe);
    }
  }
  return b;
}

/**
 * Notifies the automation (n8n) via webhook. Never fails the request:
 * errors are logged without personal data.
 */
function webhook(art, payload) {
  const url = $os.getenv("NF_WEBHOOK_URL");
  if (!url) {
    $app.logger().info("nf webhook skipped (NF_WEBHOOK_URL not set)", "art", art);
    return false;
  }
  try {
    const res = $http.send({
      url: url.replace(/\/+$/, "") + "/" + art,
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json", "X-NF-Secret": $os.getenv("NF_WEBHOOK_SECRET") },
      timeout: 5,
    });
    if (res.statusCode >= 300) {
      $app.logger().error("nf webhook failed", "art", art, "status", res.statusCode);
      return false;
    }
    return true;
  } catch (err) {
    $app.logger().error("nf webhook error", "art", art, "error", String(err));
    return false;
  }
}

module.exports = {
  MELDUNG: MELDUNG,
  fehler: fehler,
  fehlerFelder: fehlerFelder,
  apiFehler: apiFehler,
  istApiError: istApiError,
  sicher: sicher,
  json: json,
  einstellungen: einstellungen,
  termintyp: termintyp,
  status: status,
  startStatus: startStatus,
  zeit: zeit,
  pbDatum: pbDatum,
  alsMs: alsMs,
  seite: seite,
  heuteLokal: heuteLokal,
  token: token,
  neuesToken: neuesToken,
  body: body,
  webhook: webhook,
};
