/// Phase 7 (operation behind the web server):
/// - real client IP from the header the web server sets (rate limits per visitor, not per proxy)
/// - the backend's own login alert mails are off for admins too (only "Mail senden" sends mails)

migrate((app) => {
  const settings = app.settings();
  settings.trustedProxy.headers = ["X-Real-IP"];
  settings.trustedProxy.useLeftmostIP = false;
  app.save(settings);

  const su = app.findCollectionByNameOrId("_superusers");
  su.authAlert.enabled = false;
  su.otp.duration = 600;
  su.otp.length = 6;
  app.save(su);
}, (app) => {
  const settings = app.settings();
  settings.trustedProxy.headers = [];
  app.save(settings);
});
