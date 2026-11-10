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
  knopf_buchen: "Jetzt Termin buchen",
  knopf_folgetermin: "Folgetermin buchen",
  abmelde_link_text: "Hier abmelden",

  kampagne_betreff: "Jetzt Termin für die neue Saison sichern",
  nachfass_betreff: "Erinnerung: Jetzt Termin sichern",
  folgetermin_einladung_betreff: "Jetzt Folgetermin buchen",

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
  kampagne_inhalt: "die neue Saison steht vor der Tür. Sichere dir jetzt deinen Wunschtermin – über den Link unten geht das in zwei Minuten, deine Daten sind schon ausgefüllt.",
  nachfass_inhalt: "du hast noch keinen Termin gebucht. Die beliebten Termine sind schnell vergeben – über den Link unten kannst du dir jetzt einen sichern.",
  folgetermin_einladung_inhalt: "ab sofort kannst du deinen Folgetermin buchen ({{folgetermin_ab}} bis {{folgetermin_bis}}). Bitte wähle über den Link unten einen passenden Termin.",
  abmelde_text: "Du bekommst diese Mail, weil du Informationen per E-Mail zugestimmt hast. Keine weiteren Infos gewünscht?",
  abmelde_hinweis: "Du bekommst diese Mail, weil du Informationen per E-Mail zugestimmt hast. Abmelden: {{abmelde_link}}",
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
  kampagne_inhalt: "die neue Saison steht vor der Tür. Sichern Sie sich jetzt Ihren Wunschtermin – über den Link unten geht das in zwei Minuten, Ihre Daten sind schon ausgefüllt.",
  nachfass_inhalt: "Sie haben noch keinen Termin gebucht. Die beliebten Termine sind schnell vergeben – über den Link unten können Sie sich jetzt einen sichern.",
  folgetermin_einladung_inhalt: "ab sofort können Sie Ihren Folgetermin buchen ({{folgetermin_ab}} bis {{folgetermin_bis}}). Bitte wählen Sie über den Link unten einen passenden Termin.",
  abmelde_text: "Sie erhalten diese Mail, weil Sie Informationen per E-Mail zugestimmt haben. Keine weiteren Infos gewünscht?",
  abmelde_hinweis: "Sie erhalten diese Mail, weil Sie Informationen per E-Mail zugestimmt haben. Abmelden: {{abmelde_link}}",
});

module.exports = { du: du, sie: sie };
