// One-time import of a customer list (docs/ENTSCHEIDUNGEN.md E-011).
// The file is read in the owner's browser; only the mapped rows arrive here.
// Existing contacts (same e-mail) are only completed; consents get source "import";
// an unsubscribe is never overridden by an import.

const basis = require(`${__hooks}/nf/basis.js`);

const fehler = basis.fehler;
const EMAIL = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const FELDER = { anrede: 20, vorname: 100, nachname: 100, telefon: 40, strasse: 200, plz: 10, ort: 100 };
const MAX_ZEILEN = 1000;

function str(v, max) {
  return v === null || v === undefined ? "" : String(v).trim().slice(0, max || 200);
}

function datum(v) {
  const s = str(v, 20);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  return "";
}

function importieren(app, zeilen) {
  if (!Array.isArray(zeilen) || zeilen.length === 0) throw basis.fehlerFelder({ zeilen: "Keine Zeilen zum Importieren." });
  if (zeilen.length > MAX_ZEILEN) throw basis.fehlerFelder({ zeilen: "Bitte höchstens " + MAX_ZEILEN + " Zeilen auf einmal importieren." });
  const cfg = basis.einstellungen(app);
  if (!cfg.module.import) throw fehler(403, "Das Modul Import ist nicht gebucht.");
  const erlaubteZusatz = (cfg.formular.zusatzfelder || []).filter(function (f) { return f.ziel === "kontakt"; }).map(function (f) { return f.key; });
  const jetzt = basis.pbDatum(Date.now());
  const ergebnis = { neu: 0, ergaenzt: 0, uebersprungen: [] };
  const gesehen = {};

  app.runInTransaction(function (tx) {
    zeilen.forEach(function (z, i) {
      const nr = z && z.nr ? z.nr : i + 1;
      const email = str(z.email, 254).toLowerCase();
      const telefon = str(z.telefon, 40);
      if (!email && !telefon) return ergebnis.uebersprungen.push({ zeile: nr, grund: "weder E-Mail noch Telefon" });
      if (email && !EMAIL.test(email)) return ergebnis.uebersprungen.push({ zeile: nr, grund: "ungültige E-Mail-Adresse" });
      if (email && gesehen[email]) return ergebnis.uebersprungen.push({ zeile: nr, grund: "E-Mail doppelt in der Datei" });
      if (email) gesehen[email] = true;

      let k = null;
      if (email) {
        try { k = tx.findFirstRecordByFilter("kontakte", "email = {:e}", { e: email }); } catch (_) { k = null; }
      }
      const neu = !k;
      if (neu) k = new Record(tx.findCollectionByNameOrId("kontakte"));
      if (email && neu) k.set("email", email);
      Object.keys(FELDER).forEach(function (feld) {
        const v = str(z[feld], FELDER[feld]);
        if (v && (neu || !k.getString(feld))) k.set(feld, v);
      });
      const zusatz = basis.json(k, "zusatzfelder", {});
      erlaubteZusatz.forEach(function (key) {
        const v = str(z.zusatzfelder && z.zusatzfelder[key], 200);
        if (v && (neu || zusatz[key] === undefined || zusatz[key] === "")) zusatz[key] = v;
      });
      k.set("zusatzfelder", zusatz);

      // consent only if the list says so – and never against an unsubscribe
      if (z.einwilligung_email === true && email && !k.getBool("abgemeldet") && !k.getBool("einwilligung_email")) {
        const am = datum(z.einwilligung_datum);
        k.set("einwilligung_email", true);
        k.set("einwilligung_email_am", am ? am + " 12:00:00.000Z" : jetzt);
        k.set("einwilligung_email_quelle", "import");
      }
      tx.save(k);
      if (neu) ergebnis.neu++;
      else ergebnis.ergaenzt++;
    });
  });
  return ergebnis;
}

module.exports = { importieren: importieren, MAX_ZEILEN: MAX_ZEILEN };
