/// Phase 6: campaign, follow-up invitations, deletion.
/// - nachrichten: bulk mails start as "geplant" and are released in stages ("Etappen");
///   advertising mails whose recipient unsubscribed meanwhile end as "uebersprungen".
/// - einstellungen: start date of the current campaign and time of the last stage.

migrate((app) => {
  const n = app.findCollectionByNameOrId("nachrichten");
  const status = n.fields.getByName("status");
  status.values = ["geplant", "offen", "in_versand", "gesendet", "fehler", "uebersprungen"];
  app.save(n);

  const e = app.findCollectionByNameOrId("einstellungen");
  e.fields.add(new TextField({ name: "kampagne_start", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }));
  e.fields.add(new DateField({ name: "letzte_etappe" }));
  app.save(e);
}, (app) => {
  const n = app.findCollectionByNameOrId("nachrichten");
  n.fields.getByName("status").values = ["offen", "in_versand", "gesendet", "fehler"];
  app.save(n);
  const e = app.findCollectionByNameOrId("einstellungen");
  e.fields.removeByName("kampagne_start");
  e.fields.removeByName("letzte_etappe");
  app.save(e);
});
