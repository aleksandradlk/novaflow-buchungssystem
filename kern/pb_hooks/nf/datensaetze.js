// Record hooks: booking status changes, staff roles and limits.

const basis = require(`${__hooks}/nf/basis.js`);

const fehler = basis.fehler;

function istSuperuser(e) {
  return !!e.auth && e.auth.isSuperuser();
}

function rolle(e) {
  return e.auth && !e.auth.isSuperuser() ? e.auth.getString("rolle") : "";
}

// ---------------------------------------------------------------- buchungen: status

/**
 * Update of a booking through the API (overview or admin).
 * - mitarbeiter may change the status only
 * - status must exist in the status list; "abschluss" sets abgeschlossen_am
 * - after saving: status_log entry + webhook "status" (only for statuses with mail flag)
 */
function buchungAktualisieren(e) {
  const cfg = basis.einstellungen(e.app);
  if (rolle(e) === "mitarbeiter") {
    const body = e.requestInfo().body || {};
    const erlaubt = ["status"];
    const andere = Object.keys(body).filter(function (k) { return erlaubt.indexOf(k) === -1; });
    if (andere.length > 0) throw fehler(403, "Mitarbeiter dürfen nur den Status ändern.");
  }

  const alt = e.record.original().getString("status");
  const neu = e.record.getString("status");
  const geaendert = alt !== neu;
  let st = null;
  if (geaendert) {
    st = basis.status(cfg, neu);
    if (!st) throw basis.fehlerFelder({ status: "Unbekannter Status." });
    if (st.abschluss && !e.record.getString("abgeschlossen_am")) {
      e.record.set("abgeschlossen_am", basis.pbDatum(Date.now()));
    }
  }

  e.next();

  if (!geaendert) return;
  const log = new Record(e.app.findCollectionByNameOrId("status_log"));
  log.set("buchung", e.record.id);
  log.set("status", neu);
  if (e.auth && !e.auth.isSuperuser()) log.set("gesetzt_von", e.auth.id);
  log.set("zeit", basis.pbDatum(Date.now()));
  log.set("mail_gesendet", false);
  e.app.save(log);

  if (st.mail && cfg.module.status && e.record.getString("abgesagt_am") === "") {
    const kontakt = e.app.findRecordById("kontakte", e.record.getString("kontakt"));
    basis.webhook("status", {
      art: "status",
      kunde: cfg.betrieb.kennung,
      ansprache: cfg.ansprache,
      buchung_id: e.record.id,
      status_log_id: log.id,
      status: { code: st.code, name: st.name },
      verwalten_token: e.record.getString("token_verwalten"),
      kontakt: {
        id: kontakt.id,
        anrede: kontakt.getString("anrede"),
        vorname: kontakt.getString("vorname"),
        nachname: kontakt.getString("nachname"),
        email: kontakt.getString("email"),
      },
    });
  }
}

// ---------------------------------------------------------------- users: roles

function anzahl(app, rolleName, ausserId) {
  return app.findRecordsByFilter("users", "rolle = {:r} && id != {:x}", "", 0, 0, { r: rolleName, x: ausserId || "" }).length;
}

function pruefeMitarbeiterLimit(e, ausserId) {
  if (e.record.getString("rolle") !== "mitarbeiter") return;
  const cfg = basis.einstellungen(e.app);
  const max = cfg.rollen && typeof cfg.rollen.max_mitarbeiter === "number" ? cfg.rollen.max_mitarbeiter : 0;
  if (anzahl(e.app, "mitarbeiter", ausserId) >= max) {
    throw fehler(400, "Die maximale Anzahl an Mitarbeiter-Zugängen (" + max + ") ist erreicht.");
  }
}

function benutzerAnlegen(e) {
  pruefeMitarbeiterLimit(e, "");
  e.next();
}

function benutzerAktualisieren(e) {
  const alt = e.record.original().getString("rolle");
  const neu = e.record.getString("rolle");
  if (alt !== neu) {
    if (neu === "mitarbeiter") pruefeMitarbeiterLimit(e, e.record.id);
    if (alt === "inhaber" && anzahl(e.app, "inhaber", e.record.id) === 0) {
      throw fehler(400, "Es muss mindestens ein Inhaber-Zugang bestehen bleiben.");
    }
  }
  e.next();
}

function benutzerLoeschen(e) {
  if (e.record.getString("rolle") === "inhaber" && anzahl(e.app, "inhaber", e.record.id) === 0 && !istSuperuser(e)) {
    throw fehler(400, "Es muss mindestens ein Inhaber-Zugang bestehen bleiben.");
  }
  e.next();
}

// ---------------------------------------------------------------- tokens

function tokenSetzen(feld) {
  return function (e) {
    if (!e.record.getString(feld)) e.record.set(feld, basis.neuesToken());
    e.next();
  };
}

module.exports = {
  buchungAktualisieren: buchungAktualisieren,
  benutzerAnlegen: benutzerAnlegen,
  benutzerAktualisieren: benutzerAktualisieren,
  benutzerLoeschen: benutzerLoeschen,
  tokenSetzen: tokenSetzen,
};
