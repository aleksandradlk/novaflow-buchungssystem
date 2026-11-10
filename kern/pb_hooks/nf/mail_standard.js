// Default texts of all transactional mails, in both forms of address.
// Neutral wording only – every key can be overridden per customer in
// kunden/<kunde>/texte/mails.json (same key, both variants).
//
// Keys per mail type: <art>_betreff, <art>_inhalt. Status mails may have their own
// text per status: status_<code>_betreff / status_<code>_inhalt.
// Placeholders: see PLATZHALTER in mailvorlagen.js. Blank line = new paragraph.

const gemeinsam = {
  label_angebot: "Angebot",
  label_termin: "Termin",
  label_alter_termin: "Bisheriger Termin",
  label_status: "Status",
  knopf_verwalten: "Termin ansehen oder ändern",

  bestaetigung_betreff: "Terminbestätigung: {{termin}}",
  folgetermin_betreff: "Folgetermin bestätigt: {{termin}}",
  verschoben_betreff: "Termin verschoben: {{termin}}",
  abgesagt_betreff: "Termin abgesagt: {{termin}}",
  erinnerung_betreff: "Erinnerung: Termin {{wann}}",
  status_betreff: "Neuigkeiten zu Ihrem Termin: {{status}}",

  anmeldecode_betreff: "Ihr Anmeldecode: {{code}}",
  anmeldecode_inhalt: "für die Anmeldung in der Übersicht wurde ein Code angefordert:\n\n{{code}}\n\nDer Code gilt 10 Minuten. Falls Sie das nicht waren, können Sie diese Mail ignorieren.",
};

const du = Object.assign({}, gemeinsam, {
  anrede: "Hallo {{vorname}},",
  signatur: "Viele Grüße\n{{betrieb}}",

  bestaetigung_inhalt: "vielen Dank für deine Buchung. Hier sind die Details zu deinem Termin.\n\nÜber den Link unten kannst du den Termin jederzeit ansehen, verschieben oder absagen.",
  folgetermin_inhalt: "dein Folgetermin ist gebucht. Hier sind die Details.",
  verschoben_inhalt: "dein Termin wurde verschoben. Hier ist der neue Termin.",
  abgesagt_inhalt: "dein Termin wurde abgesagt. Wenn du einen neuen Termin möchtest, kannst du jederzeit wieder online buchen.",
  erinnerung_inhalt: "wir möchten dich an deinen Termin {{wann}} erinnern.",
  status_betreff: "Neuigkeiten zu deinem Termin: {{status}}",
  status_inhalt: "es gibt Neuigkeiten zu deinem Termin. Der Status ist jetzt: {{status}}.",
  anmeldecode_betreff: "Dein Anmeldecode: {{code}}",
  anmeldecode_inhalt: "für die Anmeldung in der Übersicht wurde ein Code angefordert:\n\n{{code}}\n\nDer Code gilt 10 Minuten. Falls du das nicht warst, kannst du diese Mail ignorieren.",
});

const sie = Object.assign({}, gemeinsam, {
  anrede: "Guten Tag {{anrede_name}},",
  signatur: "Mit freundlichen Grüßen\n{{betrieb}}",

  bestaetigung_inhalt: "vielen Dank für Ihre Buchung. Hier sind die Details zu Ihrem Termin.\n\nÜber den Link unten können Sie den Termin jederzeit ansehen, verschieben oder absagen.",
  folgetermin_inhalt: "Ihr Folgetermin ist gebucht. Hier sind die Details.",
  verschoben_inhalt: "Ihr Termin wurde verschoben. Hier ist der neue Termin.",
  abgesagt_inhalt: "Ihr Termin wurde abgesagt. Wenn Sie einen neuen Termin möchten, können Sie jederzeit wieder online buchen.",
  erinnerung_inhalt: "wir möchten Sie an Ihren Termin {{wann}} erinnern.",
  status_inhalt: "es gibt Neuigkeiten zu Ihrem Termin. Der Status ist jetzt: {{status}}.",
});

module.exports = { du: du, sie: sie };
