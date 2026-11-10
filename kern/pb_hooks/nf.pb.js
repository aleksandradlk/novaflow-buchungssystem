// Registrations only – the logic lives in nf/*.js.
// Handlers run in isolated VMs, so every handler requires its modules itself.

// ---------------------------------------------------------------- error translation for /api/nf/*
// Runs before the built-in rate limiter (-1000) and body limit (-990) and translates their
// English errors; anything else unexpected becomes a German 500 without technical details.
routerUse(new Middleware((e) => {
  if (!e.request.url.path.startsWith("/api/nf/")) return e.next();
  const basis = require(`${__hooks}/nf/basis.js`);
  try {
    return e.next();
  } catch (err) {
    const api = basis.apiFehler(err);
    if (api) {
      if (api.status === 429) throw basis.fehler(429, basis.MELDUNG.zuViele);
      if (api.status === 413) throw basis.fehler(413, basis.MELDUNG.zuGross);
      throw api;
    }
    $app.logger().error("nf unexpected error", "path", e.request.url.path, "error", String(err));
    throw basis.fehler(500, basis.MELDUNG.intern);
  }
}, -1005, "nfFehler"));

// ---------------------------------------------------------------- public routes (section 5)
routerAdd("GET", "/api/nf/angebot", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/routen.js`).angebot(e));
});

routerAdd("GET", "/api/nf/slots", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/routen.js`).slots(e));
});

routerAdd("POST", "/api/nf/buchen", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/routen.js`).buchen(e));
}, $apis.bodyLimit(110 * 1024 * 1024)); // fits max_anzahl × max_mb ≤ 100 MB (checked in kern/tools)

routerAdd("GET", "/api/nf/verwalten", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/routen.js`).verwaltenLesen(e));
});

routerAdd("POST", "/api/nf/verwalten", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/routen.js`).verwaltenAendern(e));
});

routerAdd("GET", "/api/nf/folgetermin", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/routen.js`).folgeterminLesen(e));
});

routerAdd("POST", "/api/nf/folgetermin", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/routen.js`).folgeterminBuchen(e));
});

routerAdd("GET", "/api/nf/abmelden", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/routen.js`).abmeldenLesen(e));
});

routerAdd("POST", "/api/nf/abmelden", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/routen.js`).abmelden(e));
});

// ---------------------------------------------------------------- internal routes for the automation
// Header X-NF-Secret required; blocked from outside by the web server (phase 7).

routerAdd("POST", "/api/nf-intern/versand/start", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/nachrichten.js`).versandStart(e));
});

routerAdd("POST", "/api/nf-intern/versand/ergebnis", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/nachrichten.js`).versandErgebnis(e));
});

routerAdd("POST", "/api/nf-intern/erinnerungen", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/nachrichten.js`).erinnerungen(e));
});

routerAdd("GET", "/api/nf-intern/offen", (e) => {
  const basis = require(`${__hooks}/nf/basis.js`);
  return basis.sicher(e, () => require(`${__hooks}/nf/nachrichten.js`).offen(e));
});

// ---------------------------------------------------------------- record hooks
onRecordUpdateRequest((e) => {
  require(`${__hooks}/nf/datensaetze.js`).buchungAktualisieren(e);
}, "buchungen");

onRecordCreateRequest((e) => {
  require(`${__hooks}/nf/datensaetze.js`).benutzerAnlegen(e);
}, "users");

onRecordUpdateRequest((e) => {
  require(`${__hooks}/nf/datensaetze.js`).benutzerAktualisieren(e);
}, "users");

onRecordDeleteRequest((e) => {
  require(`${__hooks}/nf/datensaetze.js`).benutzerLoeschen(e);
}, "users");

onRecordCreate((e) => {
  require(`${__hooks}/nf/datensaetze.js`).tokenSetzen("token")(e);
}, "kontakte");

onRecordCreate((e) => {
  require(`${__hooks}/nf/datensaetze.js`).tokenSetzen("token_verwalten")(e);
}, "buchungen");

// ---------------------------------------------------------------- console command
$app.rootCmd.addCommand(new Command({
  use: "nf-startwerte <datei> [ersetzen]",
  short: "Startwerte aus der Kundenkonfiguration importieren",
  run: (cmd, args) => {
    if (!args || args.length < 1) throw new Error("Pfad zur Startwerte-Datei fehlt.");
    require(`${__hooks}/nf/startwerte.js`).importieren($app, args[0], args[1] === "ersetzen");
  },
}));
