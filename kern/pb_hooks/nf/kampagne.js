// Bulk mails (docs/ENTSCHEIDUNGEN.md E-011):
//   kampagne              – season mail to contacts with e-mail consent who have not booked yet
//   nachfass              – up to N reminders to non-bookers (gaps from nachrichten.json)
//   folgetermin_einladung – invitation to book the follow-up (transactional, eligible bookings)
// All are created as "geplant" and released in stages by etappe() inside the sending window.

const basis = require(`${__hooks}/nf/basis.js`);
const slots = require(`${__hooks}/nf/slots.js`);
const vorlagen = require(`${__hooks}/nf/mailvorlagen.js`);

const fehler = basis.fehler;
const WERBLICH = ["kampagne", "nachfass"];

function sofort() {
  return $os.getenv("NF_NACHHOLEN_SOFORT") === "1";
}

function oeffentlicheUrl(cfg) {
  return ($os.getenv("NF_OEFFENTLICHE_URL") || "https://" + cfg.betrieb.domain).replace(/\/+$/, "");
}

function settingsRecord(app) {
  return app.findFirstRecordByFilter("einstellungen", "id != ''");
}

/** Ids of contacts with an active booking in the current bookable period. */
function gebuchteKontakte(app, cfg) {
  const z = basis.zeit(cfg);
  const ab = basis.pbDatum(z.toUtcMs(cfg.buchbar_ab, "00:00"));
  const bis = basis.pbDatum(z.toUtcMs(slots.addTage(cfg.buchbar_bis, 1), "00:00"));
  const ids = {};
  app.findRecordsByFilter("buchungen", "termin_start >= {:ab} && termin_start < {:bis} && abgesagt_am = ''", "", 0, 0, { ab: ab, bis: bis })
    .forEach(function (b) { ids[b.getString("kontakt")] = true; });
  return ids;
}

/** Contacts an advertising mail may go to right now. */
function werblichErlaubt(kontakt, gebucht) {
  return kontakt.getBool("einwilligung_email") && !kontakt.getBool("abgemeldet") &&
    !!kontakt.getString("email") && !gebucht[kontakt.id];
}

function empfaenger(app, cfg) {
  const gebucht = gebuchteKontakte(app, cfg);
  return app.findRecordsByFilter("kontakte", "einwilligung_email = true && abgemeldet = false && email != ''", "created", 0, 0)
    .filter(function (k) { return werblichErlaubt(k, gebucht); });
}

/** Stores an advertising mail for a contact (status "geplant"). Returns the record or null if it exists. */
function erstellenWerblich(app, cfg, art, kontakt, schluessel) {
  if (app.findRecordsByFilter("nachrichten", "schluessel = {:s}", "", 1, 0, { s: schluessel }).length > 0) return null;
  const token = kontakt.getString("token");
  const mail = vorlagen.rendern({
    art: art,
    ansprache: cfg.ansprache,
    eigene: cfg.mailvorlagen,
    betrieb: { name: cfg.betrieb.name, firma: cfg.betrieb.firma, farbe: cfg.betrieb.farbe, auf_farbe: cfg.betrieb.auf_farbe },
    kontakt: { anrede: kontakt.getString("anrede"), vorname: kontakt.getString("vorname"), nachname: kontakt.getString("nachname") },
    buchungs_link: oeffentlicheUrl(cfg) + "/?t=" + token,
    abmelde_link: oeffentlicheUrl(cfg) + "/abmelden/?t=" + token,
  });
  const rec = new Record(app.findCollectionByNameOrId("nachrichten"));
  rec.set("art", art);
  rec.set("kontakt", kontakt.id);
  rec.set("schluessel", schluessel);
  rec.set("status", "geplant");
  rec.set("empfaenger", kontakt.getString("email"));
  rec.set("betreff", mail.betreff);
  rec.set("text", mail.text);
  rec.set("html", mail.html);
  rec.set("versuche", 0);
  app.save(rec);
  return rec;
}

// ---------------------------------------------------------------- start

/** Plans the season campaign for all eligible contacts. Same day twice = nothing new. */
function starten(app) {
  const cfg = basis.einstellungen(app);
  if (!cfg.module.kampagne) throw fehler(403, "Das Modul Kampagne ist nicht gebucht.");
  const heute = basis.heuteLokal(cfg);
  let geplant = 0;
  app.runInTransaction(function (tx) {
    const liste = empfaenger(tx, cfg);
    liste.forEach(function (k) {
      if (erstellenWerblich(tx, cfg, "kampagne", k, "kampagne:" + k.id + ":" + heute)) {
        // a new campaign starts a new follow-up series
        for (let i = 1; i <= 5; i++) k.set("nachfass_" + i + "_am", "");
        k.set("kampagne_am", "");
        tx.save(k);
        geplant++;
      }
    });
    const s = settingsRecord(tx);
    s.set("kampagne_start", heute);
    tx.save(s);
  });
  return { geplant: geplant, kampagne_start: heute };
}

// ---------------------------------------------------------------- stages

function imFenster(cfg) {
  const k = (cfg.nachrichten && cfg.nachrichten.kampagne) || {};
  const fenster = k.versandfenster || { von: "00:00", bis: "23:59" };
  const jetzt = basis.zeit(cfg).toLocal(Date.now()).zeit;
  return jetzt >= fenster.von && jetzt < fenster.bis;
}

/**
 * Releases the next stage: up to etappe_groesse planned mails become "offen" and their keys
 * are returned for "Mail senden". Respects the sending window and the gap between stages.
 */
function etappe(app) {
  const cfg = basis.einstellungen(app);
  const k = (cfg.nachrichten && cfg.nachrichten.kampagne) || {};
  const groesse = k.etappe_groesse || 50;
  const abstandMin = sofort() ? 0 : (k.etappe_abstand_minuten || 30);
  if (!imFenster(cfg)) return { schluessel: [], grund: "außerhalb des Versandfensters" };

  const out = [];
  let grund = "";
  app.runInTransaction(function (tx) {
    const s = settingsRecord(tx);
    const letzte = basis.alsMs(s.getString("letzte_etappe"));
    if (!isNaN(letzte) && Date.now() - letzte < abstandMin * 60000 - 5000) {
      grund = "nächste Etappe noch nicht fällig";
      return;
    }
    const gebucht = gebuchteKontakte(tx, cfg);
    const liste = tx.findRecordsByFilter("nachrichten", "status = 'geplant'", "created", groesse, 0);
    liste.forEach(function (n) {
      if (WERBLICH.indexOf(n.getString("art")) !== -1) {
        let kontakt = null;
        try { kontakt = tx.findRecordById("kontakte", n.getString("kontakt")); } catch (_) { kontakt = null; }
        if (!kontakt || !werblichErlaubt(kontakt, gebucht)) {
          n.set("status", "uebersprungen");
          n.set("ergebnis", "übersprungen: keine Einwilligung mehr, abgemeldet oder bereits gebucht");
          tx.save(n);
          return;
        }
      }
      n.set("status", "offen");
      tx.save(n);
      out.push(n.getString("schluessel"));
    });
    if (liste.length) {
      s.set("letzte_etappe", basis.pbDatum(Date.now()));
      tx.save(s);
    }
  });
  return grund ? { schluessel: out, grund: grund } : { schluessel: out };
}

// ---------------------------------------------------------------- follow-up reminders

/** Plans the next follow-up mail for non-bookers whose previous mail is old enough. */
function nachfass(app) {
  const cfg = basis.einstellungen(app);
  if (!cfg.module.kampagne) return { geplant: 0 };
  const abstaende = (cfg.nachrichten && cfg.nachrichten.nachfass && cfg.nachrichten.nachfass.abstaende_tage) || [];
  if (!abstaende.length) return { geplant: 0 };
  const kampagneStart = settingsRecord(app).getString("kampagne_start");
  let geplant = 0;
  app.runInTransaction(function (tx) {
    const gebucht = gebuchteKontakte(tx, cfg);
    tx.findRecordsByFilter("kontakte", "kampagne_am != '' && einwilligung_email = true && abgemeldet = false", "", 0, 0).forEach(function (k) {
      if (!werblichErlaubt(k, gebucht)) return;
      for (let i = 1; i <= abstaende.length; i++) {
        if (k.getString("nachfass_" + i + "_am")) continue;
        const vorher = basis.alsMs(i === 1 ? k.getString("kampagne_am") : k.getString("nachfass_" + (i - 1) + "_am"));
        const tage = sofort() ? 0 : abstaende[i - 1];
        if (isNaN(vorher) || Date.now() - vorher < tage * 86400000) return;
        if (erstellenWerblich(tx, cfg, "nachfass", k, "nachfass:" + k.id + ":" + i + ":" + kampagneStart)) geplant++;
        return; // at most one follow-up per contact and run
      }
    });
  });
  return { geplant: geplant };
}

// ---------------------------------------------------------------- follow-up appointment invitations

function folgeterminEinladungen(app) {
  const cfg = basis.einstellungen(app);
  if (!cfg.module.folgetermin || !cfg.folgetermin_ab) return { geplant: 0 };
  const heute = basis.heuteLokal(cfg);
  if (heute < cfg.folgetermin_ab || heute > cfg.folgetermin_bis) return { geplant: 0, grund: "außerhalb des Folgetermin-Zeitraums" };
  const nachrichten = require(`${__hooks}/nf/nachrichten.js`);
  let geplant = 0;
  app.runInTransaction(function (tx) {
    const berechtigt = {};
    tx.findRecordsByFilter("angebote", "folgetermin = true", "", 0, 0).forEach(function (a) { berechtigt[a.id] = true; });
    tx.findRecordsByFilter("buchungen", "eltern_buchung = '' && abgesagt_am = ''", "", 0, 0).forEach(function (b) {
      if (!berechtigt[b.getString("angebot")]) return;
      if (tx.findRecordsByFilter("buchungen", "eltern_buchung = {:id} && abgesagt_am = ''", "", 1, 0, { id: b.id }).length) return;
      const rec = nachrichten.erstellen(tx, cfg, "folgetermin_einladung", b, {
        schluessel: "folgetermin_einladung:" + b.id + ":" + cfg.folgetermin_ab,
        status: "geplant",
        folgetermin: { ab: cfg.folgetermin_ab, bis: cfg.folgetermin_bis },
      });
      if (rec) geplant++;
    });
  });
  return { geplant: geplant };
}

// ---------------------------------------------------------------- state for the overview

function stand(app) {
  const cfg = basis.einstellungen(app);
  const zaehlen = function (filter) { return app.findRecordsByFilter("nachrichten", filter, "", 0, 0).length; };
  const art = "(art = 'kampagne' || art = 'nachfass')";
  return {
    modul: !!cfg.module.kampagne,
    mail_modus: cfg.mail_modus,
    test_empfaenger: cfg.test_empfaenger,
    kampagne_start: settingsRecord(app).getString("kampagne_start"),
    empfaenger_moeglich: cfg.module.kampagne ? empfaenger(app, cfg).length : 0,
    geplant: zaehlen(art + " && status = 'geplant'"),
    unterwegs: zaehlen(art + " && (status = 'offen' || status = 'in_versand')"),
    gesendet: zaehlen(art + " && status = 'gesendet'"),
    uebersprungen: zaehlen(art + " && status = 'uebersprungen'"),
    fehler: zaehlen(art + " && status = 'fehler'"),
  };
}

/** Check at sending time (advertising mails only). */
function versandErlaubt(app, cfg, nachricht) {
  if (WERBLICH.indexOf(nachricht.getString("art")) === -1) return true;
  let kontakt;
  try { kontakt = app.findRecordById("kontakte", nachricht.getString("kontakt")); } catch (_) { return false; }
  return werblichErlaubt(kontakt, gebuchteKontakte(app, cfg));
}

module.exports = {
  WERBLICH: WERBLICH,
  starten: starten,
  etappe: etappe,
  nachfass: nachfass,
  folgeterminEinladungen: folgeterminEinladungen,
  stand: stand,
  versandErlaubt: versandErlaubt,
};
