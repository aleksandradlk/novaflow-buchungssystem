/// Data model of one customer instance (docs/BAUAUFTRAG_VORLAGE.md, section 4).
///
/// Access: nothing is public. Guests only reach the custom routes under /api/nf/.
///   inhaber     – everything
///   mitarbeiter – read + change booking status (enforced again in nf_hooks.pb.js)

const TEAM = '@request.auth.collectionName = "users" && (@request.auth.rolle = "inhaber" || @request.auth.rolle = "mitarbeiter")';
const INHABER = '@request.auth.collectionName = "users" && @request.auth.rolle = "inhaber"';

const DATUM = "^\\d{4}-\\d{2}-\\d{2}$";
const UHRZEIT = "^([01]\\d|2[0-3]):[0-5]\\d$";
const CODE = "^[a-z][a-z0-9_]{0,39}$";

function zeitstempel() {
  return [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];
}

function regeln(list, view, create, update, del) {
  return { listRule: list, viewRule: view, createRule: create, updateRule: update, deleteRule: del };
}

migrate((app) => {
  // ---------------------------------------------------------------- users (Auth)
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new SelectField({ name: "rolle", required: true, maxSelect: 1, values: ["inhaber", "mitarbeiter"] }));
  users.listRule = INHABER + " || id = @request.auth.id";
  users.viewRule = INHABER + " || id = @request.auth.id";
  users.createRule = INHABER;
  users.updateRule = INHABER + " || (id = @request.auth.id && @request.body.rolle:isset = false)";
  users.deleteRule = INHABER + " && id != @request.auth.id";
  users.oauth2.enabled = false;
  users.passwordAuth.enabled = true;
  users.passwordAuth.identityFields = ["email"];
  app.save(users);

  // ---------------------------------------------------------------- einstellungen (1 record)
  app.save(new Collection(Object.assign({
    type: "base",
    name: "einstellungen",
    fields: [
      { name: "buchbar_ab", type: "text", required: true, pattern: DATUM },
      { name: "buchbar_bis", type: "text", required: true, pattern: DATUM },
      { name: "folgetermin_ab", type: "text", pattern: DATUM },
      { name: "folgetermin_bis", type: "text", pattern: DATUM },
      { name: "folgetermin_typ", type: "text", pattern: CODE },
      { name: "max_pro_woche", type: "number", onlyInt: true, min: 0 },
      { name: "ressourcen", type: "json", maxSize: 20000 },
      { name: "termintypen", type: "json", maxSize: 20000 },
      { name: "status_liste", type: "json", maxSize: 20000 },
      { name: "mail_modus", type: "select", required: true, maxSelect: 1, values: ["test", "live"] },
      { name: "mail_adapter", type: "select", required: true, maxSelect: 1, values: ["graph", "smtp"] },
      { name: "test_empfaenger", type: "email", required: true },
      { name: "absender", type: "json", maxSize: 2000 },
      { name: "ansprache", type: "select", required: true, maxSelect: 1, values: ["du", "sie"] },
      { name: "hinweistexte", type: "json", maxSize: 200000 },
      { name: "betrieb", type: "json", maxSize: 20000 },
      { name: "module", type: "json", maxSize: 2000 },
      { name: "formular", type: "json", maxSize: 20000 },
      { name: "rollen", type: "json", maxSize: 2000 },
      { name: "loeschfristen", type: "json", maxSize: 2000 },
      { name: "nachrichten", type: "json", maxSize: 20000 },
      { name: "rechtliches", type: "json", maxSize: 50000 },
    ].concat(zeitstempel()),
  }, regeln(TEAM, TEAM, null, INHABER, null))));

  // ---------------------------------------------------------------- angebote
  app.save(new Collection(Object.assign({
    type: "base",
    name: "angebote",
    fields: [
      { name: "code", type: "text", required: true, pattern: CODE },
      { name: "name", type: "text", required: true, max: 200 },
      { name: "beschreibung", type: "text", max: 2000 },
      { name: "preis_text", type: "text", max: 200 },
      { name: "termintyp", type: "text", required: true, pattern: CODE },
      { name: "ressource", type: "text", pattern: CODE },
      { name: "folgetermin", type: "bool" },
      { name: "zusatzoptionen", type: "json", maxSize: 20000 },
      { name: "aktiv", type: "bool" },
      { name: "sortierung", type: "number", onlyInt: true, min: 0 },
    ].concat(zeitstempel()),
    indexes: ["CREATE UNIQUE INDEX idx_angebote_code ON angebote (code)"],
  }, regeln(TEAM, TEAM, INHABER, INHABER, INHABER))));

  // ---------------------------------------------------------------- terminregeln
  app.save(new Collection(Object.assign({
    type: "base",
    name: "terminregeln",
    fields: [
      { name: "termintyp", type: "text", required: true, pattern: CODE },
      { name: "wochentag", type: "number", required: true, onlyInt: true, min: 1, max: 7 },
      { name: "von", type: "text", required: true, pattern: UHRZEIT },
      { name: "bis", type: "text", required: true, pattern: UHRZEIT },
      { name: "takt_minuten", type: "number", required: true, onlyInt: true, min: 5, max: 1440 },
      { name: "max_pro_slot", type: "number", required: true, onlyInt: true, min: 1 },
      { name: "max_pro_tag", type: "number", onlyInt: true, min: 0 },
      { name: "gueltig_von", type: "text", pattern: DATUM },
      { name: "gueltig_bis", type: "text", pattern: DATUM },
    ].concat(zeitstempel()),
    indexes: ["CREATE INDEX idx_terminregeln_typ ON terminregeln (termintyp, wochentag)"],
  }, regeln(TEAM, TEAM, INHABER, INHABER, INHABER))));

  // ---------------------------------------------------------------- sperrtage
  app.save(new Collection(Object.assign({
    type: "base",
    name: "sperrtage",
    fields: [
      { name: "datum", type: "text", required: true, pattern: DATUM },
      { name: "grund", type: "text", max: 200 },
    ].concat(zeitstempel()),
    indexes: ["CREATE UNIQUE INDEX idx_sperrtage_datum ON sperrtage (datum)"],
  }, regeln(TEAM, TEAM, INHABER, INHABER, INHABER))));

  // ---------------------------------------------------------------- kontakte
  const kontakte = new Collection(Object.assign({
    type: "base",
    name: "kontakte",
    fields: [
      { name: "anrede", type: "text", max: 20 },
      { name: "vorname", type: "text", max: 100 },
      { name: "nachname", type: "text", max: 100 },
      { name: "email", type: "email" },
      { name: "telefon", type: "text", max: 40 },
      { name: "strasse", type: "text", max: 200 },
      { name: "plz", type: "text", max: 10 },
      { name: "ort", type: "text", max: 100 },
      { name: "zusatzfelder", type: "json", maxSize: 20000 },
      { name: "einwilligung_email", type: "bool" },
      { name: "einwilligung_email_am", type: "date" },
      { name: "einwilligung_email_quelle", type: "text", max: 40 },
      { name: "einwilligung_whatsapp", type: "bool" },
      { name: "einwilligung_whatsapp_am", type: "date" },
      { name: "einwilligung_whatsapp_quelle", type: "text", max: 40 },
      { name: "abgemeldet", type: "bool" },
      { name: "abgemeldet_am", type: "date" },
      { name: "token", type: "text", min: 32, max: 64, hidden: true },
      { name: "kampagne_am", type: "date" },
      { name: "nachfass_1_am", type: "date" },
      { name: "nachfass_2_am", type: "date" },
      { name: "nachfass_3_am", type: "date" },
      { name: "nachfass_4_am", type: "date" },
      { name: "nachfass_5_am", type: "date" },
      { name: "notiz", type: "text", max: 5000 },
    ].concat(zeitstempel()),
    indexes: [
      "CREATE UNIQUE INDEX idx_kontakte_token ON kontakte (token) WHERE token != ''",
      "CREATE INDEX idx_kontakte_email ON kontakte (email)",
    ],
  }, regeln(TEAM, TEAM, null, INHABER, INHABER)));
  app.save(kontakte);

  // ---------------------------------------------------------------- buchungen
  const angebote = app.findCollectionByNameOrId("angebote");
  const buchungen = new Collection(Object.assign({
    type: "base",
    name: "buchungen",
    fields: [
      { name: "kontakt", type: "relation", required: true, collectionId: kontakte.id, maxSelect: 1, cascadeDelete: true },
      { name: "angebot", type: "relation", required: true, collectionId: angebote.id, maxSelect: 1, cascadeDelete: false },
      { name: "zusatzoptionen", type: "json", maxSize: 5000 },
      { name: "termintyp", type: "text", required: true, pattern: CODE },
      { name: "termin_start", type: "date", required: true },
      { name: "termin_ende", type: "date", required: true },
      { name: "zusatzfelder", type: "json", maxSize: 20000 },
      {
        name: "fotos", type: "file", maxSelect: 20, maxSize: 25 * 1024 * 1024, protected: true,
        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
        thumbs: ["400x0"],
      },
      { name: "status", type: "text", required: true, pattern: CODE },
      { name: "abgeschlossen_am", type: "date" },
      { name: "abgesagt_am", type: "date" },
      { name: "ressourcen", type: "json", maxSize: 2000 },
      { name: "token_verwalten", type: "text", required: true, min: 32, max: 64, hidden: true },
      { name: "bemerkung", type: "text", max: 2000 },
    ].concat(zeitstempel()),
    indexes: [
      "CREATE UNIQUE INDEX idx_buchungen_token ON buchungen (token_verwalten)",
      "CREATE INDEX idx_buchungen_start ON buchungen (termin_start)",
      "CREATE INDEX idx_buchungen_kontakt ON buchungen (kontakt)",
    ],
  }, regeln(TEAM, TEAM, null, TEAM, INHABER)));
  app.save(buchungen);
  // Self relation for follow-up appointments needs the collection id first.
  buchungen.fields.add(new RelationField({ name: "eltern_buchung", collectionId: buchungen.id, maxSelect: 1, cascadeDelete: true }));
  buchungen.indexes.push("CREATE INDEX idx_buchungen_eltern ON buchungen (eltern_buchung)");
  app.save(buchungen);

  const usersId = users.id;

  // ---------------------------------------------------------------- status_log
  app.save(new Collection(Object.assign({
    type: "base",
    name: "status_log",
    fields: [
      { name: "buchung", type: "relation", required: true, collectionId: buchungen.id, maxSelect: 1, cascadeDelete: true },
      { name: "status", type: "text", required: true, pattern: CODE },
      { name: "gesetzt_von", type: "relation", collectionId: usersId, maxSelect: 1, cascadeDelete: false },
      { name: "zeit", type: "date", required: true },
      { name: "mail_gesendet", type: "bool" },
    ].concat(zeitstempel()),
    indexes: ["CREATE INDEX idx_status_log_buchung ON status_log (buchung)"],
  }, regeln(TEAM, TEAM, null, null, null))));

  // ---------------------------------------------------------------- nachrichten
  app.save(new Collection(Object.assign({
    type: "base",
    name: "nachrichten",
    fields: [
      { name: "art", type: "text", required: true, max: 40 },
      { name: "kontakt", type: "relation", collectionId: kontakte.id, maxSelect: 1, cascadeDelete: true },
      { name: "buchung", type: "relation", collectionId: buchungen.id, maxSelect: 1, cascadeDelete: true },
      { name: "schluessel", type: "text", required: true, max: 200 },
      { name: "gesendet_am", type: "date" },
      { name: "ergebnis", type: "text", max: 500 },
    ].concat(zeitstempel()),
    indexes: ["CREATE UNIQUE INDEX idx_nachrichten_schluessel ON nachrichten (schluessel)"],
  }, regeln(TEAM, TEAM, null, null, null))));

  // ---------------------------------------------------------------- settings
  const settings = app.settings();
  settings.meta.appName = "Buchungssystem";
  settings.batch.enabled = false;
  settings.rateLimits.enabled = true;
  settings.rateLimits.rules = [
    { label: "POST /api/nf/buchen", audience: "", duration: 60, maxRequests: 10 },
    { label: "POST /api/nf/", audience: "", duration: 60, maxRequests: 20 },
    { label: "/api/nf/", audience: "", duration: 60, maxRequests: 120 },
    { label: "*:auth", audience: "", duration: 3, maxRequests: 2 },
    { label: "*:create", audience: "", duration: 5, maxRequests: 20 },
    { label: "/api/", audience: "", duration: 10, maxRequests: 300 },
  ];
  app.save(settings);
}, (app) => {
  for (const name of ["nachrichten", "status_log", "buchungen", "kontakte", "sperrtage", "terminregeln", "angebote", "einstellungen"]) {
    app.delete(app.findCollectionByNameOrId(name));
  }
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("rolle");
  app.save(users);
});
