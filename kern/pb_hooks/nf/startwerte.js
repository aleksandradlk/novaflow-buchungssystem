// Imports the start values (generated from kunden/<kunde>/ by kern/tools) into an instance.
// Console: <backend> nf-startwerte <datei> [ersetzen]

const LISTEN = ["angebote", "terminregeln", "sperrtage"];

function importieren(app, datei, ersetzen) {
  const daten = JSON.parse(toString($os.readFile(datei)));
  const vorhanden = app.findRecordsByFilter("einstellungen", "id != ''", "", 1, 0).length > 0;

  if (vorhanden && !ersetzen) {
    console.log("Startwerte sind bereits vorhanden – übersprungen.");
    return;
  }
  if (vorhanden && app.findRecordsByFilter("buchungen", "id != ''", "", 1, 0).length > 0) {
    throw new Error("Es gibt bereits Buchungen – Startwerte werden nicht ersetzt.");
  }

  app.runInTransaction(function (tx) {
    if (vorhanden) {
      LISTEN.concat(["einstellungen"]).forEach(function (name) {
        tx.findRecordsByFilter(name, "id != ''", "", 0, 0).forEach(function (r) { tx.delete(r); });
      });
    }
    const speichern = function (name, werte) {
      const rec = new Record(tx.findCollectionByNameOrId(name));
      Object.keys(werte).forEach(function (k) { rec.set(k, werte[k]); });
      tx.save(rec);
    };
    speichern("einstellungen", daten.einstellungen);
    LISTEN.forEach(function (name) {
      daten[name].forEach(function (werte) { speichern(name, werte); });
    });
  });

  const settings = app.settings();
  settings.meta.appName = daten.einstellungen.betrieb.name;
  app.save(settings);

  console.log(
    "Startwerte importiert: " + daten.angebote.length + " Angebote, " +
    daten.terminregeln.length + " Terminregeln, " + daten.sperrtage.length + " Sperrtage."
  );
}

module.exports = { importieren: importieren };
