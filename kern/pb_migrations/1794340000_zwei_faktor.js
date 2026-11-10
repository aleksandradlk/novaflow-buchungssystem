/// Two-factor login for the overview (CLAUDE.md: admin access with two factors).
/// inhaber/mitarbeiter log in with password + one-time code by e-mail. The code mail goes
/// through the outbox ("Mail senden"), never through the backend's own mailer.

const TEAM = '@request.auth.collectionName = "users" && (@request.auth.rolle = "inhaber" || @request.auth.rolle = "mitarbeiter")';

migrate((app) => {
  const u = app.findCollectionByNameOrId("users");
  u.mfa.enabled = true;
  u.mfa.duration = 1800;      // 30 min between the two steps
  u.otp.enabled = true;
  u.otp.duration = 600;       // code valid 10 min (mail delivery may take a moment)
  u.otp.length = 6;
  u.authAlert.enabled = false; // the backend must not send its own mails
  u.authToken.duration = 604800; // 7 days
  app.save(u);

  // login codes are never visible to the team
  const n = app.findCollectionByNameOrId("nachrichten");
  n.listRule = TEAM + ' && art != "anmeldecode"';
  n.viewRule = TEAM + ' && art != "anmeldecode"';
  app.save(n);
}, (app) => {
  const u = app.findCollectionByNameOrId("users");
  u.mfa.enabled = false;
  u.otp.enabled = false;
  app.save(u);
  const n = app.findCollectionByNameOrId("nachrichten");
  n.listRule = TEAM;
  n.viewRule = TEAM;
  app.save(n);
});
