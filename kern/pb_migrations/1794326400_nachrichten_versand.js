/// Mail delivery (phase 4): "nachrichten" becomes an outbox.
/// A message is rendered and stored first (unique "schluessel" = no double sending),
/// then the automation fetches it, sends it and reports back.
///   status: offen → in_versand → gesendet | fehler (fehler/offen are retried)

migrate((app) => {
  const n = app.findCollectionByNameOrId("nachrichten");
  n.fields.add(new SelectField({ name: "status", required: true, maxSelect: 1, values: ["offen", "in_versand", "gesendet", "fehler"] }));
  n.fields.add(new EmailField({ name: "empfaenger", required: true }));
  n.fields.add(new TextField({ name: "betreff", required: true, max: 500 }));
  n.fields.add(new TextField({ name: "text", max: 100000 }));
  n.fields.add(new TextField({ name: "html", max: 300000 }));
  n.fields.add(new NumberField({ name: "versuche", onlyInt: true, min: 0 }));
  n.fields.add(new DateField({ name: "letzter_versuch" }));
  n.indexes.push("CREATE INDEX idx_nachrichten_status ON nachrichten (status, letzter_versuch)");
  app.save(n);

  const e = app.findCollectionByNameOrId("einstellungen");
  e.fields.add(new JSONField({ name: "mailvorlagen", maxSize: 200000 }));
  app.save(e);
}, (app) => {
  const n = app.findCollectionByNameOrId("nachrichten");
  n.indexes = n.indexes.filter((i) => i.indexOf("idx_nachrichten_status") === -1);
  for (const f of ["status", "empfaenger", "betreff", "text", "html", "versuche", "letzter_versuch"]) n.fields.removeByName(f);
  app.save(n);
  const e = app.findCollectionByNameOrId("einstellungen");
  e.fields.removeByName("mailvorlagen");
  app.save(e);
});
