// Automatic deletion after the periods in kunde.json → loeschfristen (docs/ENTSCHEIDUNGEN.md E-011).
//   fotos_monate_nach_abschluss     – photos of finished/cancelled bookings
//   buchungen_monate_nach_abschluss – finished/cancelled bookings (with status log and mails)
// Contacts whose last booking was deleted: deleted if they have no e-mail consent;
// unsubscribed contacts are reduced to e-mail + unsubscribe flag (so they are never mailed again).

const basis = require(`${__hooks}/nf/basis.js`);

function vorMonaten(monate) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - monate);
  return basis.pbDatum(d.getTime());
}

const ERLEDIGT = "((abgeschlossen_am != '' && abgeschlossen_am < {:grenze}) || (abgesagt_am != '' && abgesagt_am < {:grenze}))";

function ausfuehren(app) {
  const cfg = basis.einstellungen(app);
  const ergebnis = { fotos: 0, buchungen: 0, kontakte_geloescht: 0, kontakte_reduziert: 0 };
  if (!cfg.module.loeschung) return ergebnis;
  const f = cfg.loeschfristen || {};

  // 1. photos
  if (f.fotos_monate_nach_abschluss) {
    app.findRecordsByFilter("buchungen", "fotos:length > 0 && " + ERLEDIGT, "", 0, 0, { grenze: vorMonaten(f.fotos_monate_nach_abschluss) })
      .forEach(function (b) {
        b.set("fotos", []);
        app.save(b);
        ergebnis.fotos++;
      });
  }

  // 2. bookings (a booking with a follow-up that is not due yet stays)
  if (!f.buchungen_monate_nach_abschluss) return ergebnis;
  const grenze = vorMonaten(f.buchungen_monate_nach_abschluss);
  const betroffen = {};
  app.runInTransaction(function (tx) {
    tx.findRecordsByFilter("buchungen", "eltern_buchung = '' && " + ERLEDIGT, "", 0, 0, { grenze: grenze }).forEach(function (b) {
      const kinder = tx.findRecordsByFilter("buchungen", "eltern_buchung = {:id}", "", 0, 0, { id: b.id });
      const kinderFaellig = tx.findRecordsByFilter("buchungen", "eltern_buchung = {:id} && " + ERLEDIGT, "", 0, 0, { id: b.id, grenze: grenze });
      if (kinder.length !== kinderFaellig.length) return;
      betroffen[b.getString("kontakt")] = true;
      tx.delete(b); // status log, mails and follow-ups are deleted with it (cascade)
      ergebnis.buchungen += 1 + kinder.length;
    });

    // 3. contacts without any booking left
    Object.keys(betroffen).forEach(function (id) {
      let k;
      try { k = tx.findRecordById("kontakte", id); } catch (_) { return; }
      if (tx.findRecordsByFilter("buchungen", "kontakt = {:id}", "", 1, 0, { id: id }).length) return;
      if (k.getBool("abgemeldet")) {
        ["anrede", "vorname", "nachname", "telefon", "strasse", "plz", "ort", "notiz"].forEach(function (feld) { k.set(feld, ""); });
        k.set("zusatzfelder", {});
        tx.save(k);
        ergebnis.kontakte_reduziert++;
      } else if (!k.getBool("einwilligung_email")) {
        tx.delete(k);
        ergebnis.kontakte_geloescht++;
      }
    });
  });
  return ergebnis;
}

module.exports = { ausfuehren: ausfuehren };
