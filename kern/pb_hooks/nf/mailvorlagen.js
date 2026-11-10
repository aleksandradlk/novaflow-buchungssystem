// Mail template engine without backend APIs – used by the hooks and by the Node tests.
// Produces subject, plain text and HTML for one transactional mail.

const STANDARD = require(`${typeof __hooks === "string" ? __hooks : __dirname + "/.."}/nf/mail_standard.js`);

/** Mail types and whether they show appointment details / the manage button. */
const ARTEN = {
  bestaetigung: { details: true, knopf: true },
  folgetermin: { details: true, knopf: true },
  verschoben: { details: true, knopf: true },
  abgesagt: { details: true, knopf: false },
  erinnerung: { details: true, knopf: true },
  status: { details: true, knopf: true },
  anmeldecode: { details: false, knopf: false }, // overview login (staff), not customer mail
};

/** Placeholders usable in every text. */
const PLATZHALTER = [
  "vorname", "nachname", "anrede_name", "betrieb", "angebot", "zusatzoptionen", "termintyp",
  "termin", "termin_datum", "termin_uhrzeit", "alter_termin", "wann", "status", "verwalten_link", "code",
];

const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** "2030-01-07" -> "Montag, 7. Januar 2030" */
function datumLang(datum) {
  const p = datum.split("-").map(Number);
  const w = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return WOCHENTAGE[w] + ", " + p[2] + ". " + MONATE[p[1] - 1] + " " + p[0];
}

/** {datum, zeit} -> "Montag, 7. Januar 2030, 08:00 Uhr" */
function terminText(lokal) {
  return datumLang(lokal.datum) + ", " + lokal.zeit + " Uhr";
}

function wannText(tage) {
  if (tage === 0) return "heute";
  if (tage === 1) return "morgen";
  if (tage === 2) return "übermorgen";
  return "in " + tage + " Tagen";
}

/** Texts for one form of address: defaults overridden by the customer's texts. */
function texte(ansprache, eigene) {
  const a = ansprache === "du" ? "du" : "sie";
  return Object.assign({}, STANDARD[a], (eigene && eigene[a]) || {});
}

function ersetzen(vorlage, werte) {
  return String(vorlage || "").replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, name) {
    return werte[name] === undefined || werte[name] === null ? "" : String(werte[name]);
  });
}

/** Placeholders used in a text that the engine does not know (for config checks). */
function unbekanntePlatzhalter(text) {
  const out = [];
  String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, name) {
    if (PLATZHALTER.indexOf(name) === -1 && out.indexOf(name) === -1) out.push(name);
    return "";
  });
  return out;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Text with placeholders -> HTML paragraphs (values and text escaped). */
function absaetze(text, werte, stil) {
  return ersetzen(text, werte).split(/\n\s*\n/).filter(function (a) { return a.trim() !== ""; }).map(function (a) {
    return '<p style="' + stil + '">' + esc(a.trim()).replace(/\n/g, "<br>") + "</p>";
  }).join("\n");
}

function absaetzeText(text, werte) {
  return ersetzen(text, werte).split(/\n\s*\n/).map(function (a) { return a.trim(); }).filter(Boolean).join("\n\n");
}

function sichereFarbe(f, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(f || "") ? f : fallback;
}

/**
 * Renders one mail.
 *
 * o = {
 *   art:        one of ARTEN
 *   ansprache:  "du" | "sie"
 *   eigene:     customer overrides { du: {...}, sie: {...} }
 *   betrieb:    { name, firma: { name, strasse, plz, ort, telefon, email }, farbe, auf_farbe }
 *   kontakt:    { anrede, vorname, nachname }
 *   buchung:    { angebot, zusatzoptionen: [names], termintyp, termin: {datum, zeit}, alter_termin?: {datum, zeit} }
 *   status:     { code, name }        (status mails)
 *   tage:       number                (reminders)
 *   verwalten_link: absolute URL
 * }
 */
function rendern(o) {
  const art = ARTEN[o.art];
  if (!art) throw new Error("unknown mail type: " + o.art);
  const T = texte(o.ansprache, o.eigene);
  const k = o.kontakt || {};
  const b = o.buchung || {};
  const name = [k.vorname, k.nachname].filter(Boolean).join(" ");

  const werte = {
    vorname: k.vorname || "",
    nachname: k.nachname || "",
    anrede_name: k.anrede && k.nachname ? k.anrede + " " + k.nachname : name,
    betrieb: o.betrieb.name,
    angebot: b.angebot || "",
    zusatzoptionen: (b.zusatzoptionen || []).join(", "),
    termintyp: b.termintyp || "",
    termin: b.termin ? terminText(b.termin) : "",
    termin_datum: b.termin ? datumLang(b.termin.datum) : "",
    termin_uhrzeit: b.termin ? b.termin.zeit + " Uhr" : "",
    alter_termin: b.alter_termin ? terminText(b.alter_termin) : "",
    wann: typeof o.tage === "number" ? wannText(o.tage) : "",
    status: o.status ? o.status.name : "",
    verwalten_link: o.verwalten_link || "",
    code: o.code || "",
  };

  // status mails: own text per status if the customer defined one
  let betreffKey = o.art + "_betreff";
  let inhaltKey = o.art + "_inhalt";
  if (o.art === "status" && o.status) {
    if (T["status_" + o.status.code + "_betreff"]) betreffKey = "status_" + o.status.code + "_betreff";
    if (T["status_" + o.status.code + "_inhalt"]) inhaltKey = "status_" + o.status.code + "_inhalt";
  }

  const betreff = ersetzen(T[betreffKey], werte).replace(/\s+/g, " ").trim();
  const details = [];
  if (art.details && b.angebot) {
    details.push([T.label_angebot, werte.angebot + (werte.zusatzoptionen ? " (+ " + werte.zusatzoptionen + ")" : "")]);
    if (b.alter_termin) details.push([T.label_alter_termin, werte.alter_termin]);
    if (b.termin) details.push([T.label_termin, werte.termin + (b.termintyp ? " – " + b.termintyp : "")]);
    if (o.status) details.push([T.label_status, werte.status]);
  }
  const knopf = art.knopf && werte.verwalten_link ? { text: ersetzen(T.knopf_verwalten, werte), url: werte.verwalten_link } : null;
  const f = o.betrieb.firma || {};
  const fuss = [
    f.name,
    [f.strasse, [f.plz, f.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    [f.telefon ? "Tel. " + f.telefon : "", f.email || ""].filter(Boolean).join(" · "),
  ].filter(Boolean);

  // ---- plain text
  const textTeile = [ersetzen(T.anrede, werte), absaetzeText(T[inhaltKey], werte)];
  if (details.length) textTeile.push(details.map(function (d) { return d[0] + ": " + d[1]; }).join("\n"));
  if (knopf) textTeile.push(knopf.text + ":\n" + knopf.url);
  textTeile.push(ersetzen(T.signatur, werte));
  textTeile.push("--\n" + fuss.join("\n"));
  const text = textTeile.filter(Boolean).join("\n\n") + "\n";

  // ---- HTML (inline styles for mail clients; no external resources)
  const farbe = sichereFarbe(o.betrieb.farbe, "#333333");
  const aufFarbe = sichereFarbe(o.betrieb.auf_farbe, "#ffffff");
  const p = "margin:0 0 16px;";
  const html = [
    "<!doctype html>",
    '<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(betreff) + "</title></head>",
    '<body style="margin:0;padding:0;background:#f4f4f4;">',
    '<div style="max-width:560px;margin:0 auto;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;">',
    '<p style="' + p + "font-size:18px;font-weight:bold;color:" + farbe + ';">' + esc(o.betrieb.name) + "</p>",
    '<p style="' + p + '">' + esc(ersetzen(T.anrede, werte)) + "</p>",
    absaetze(T[inhaltKey], werte, p),
    details.length
      ? '<table role="presentation" style="border-collapse:collapse;margin:0 0 16px;">' + details.map(function (d) {
        return '<tr><td style="padding:4px 16px 4px 0;font-weight:bold;vertical-align:top;">' + esc(d[0]) +
          '</td><td style="padding:4px 0;vertical-align:top;">' + esc(d[1]) + "</td></tr>";
      }).join("") + "</table>"
      : "",
    knopf
      ? '<p style="' + p + '"><a href="' + esc(knopf.url) + '" style="display:inline-block;padding:12px 20px;border-radius:6px;background:' +
        farbe + ";color:" + aufFarbe + ';font-weight:bold;text-decoration:none;">' + esc(knopf.text) + "</a></p>"
      : "",
    '<p style="' + p + '">' + esc(ersetzen(T.signatur, werte)).replace(/\n/g, "<br>") + "</p>",
    '<hr style="border:0;border-top:1px solid #dddddd;margin:24px 0 12px;">',
    '<p style="margin:0;font-size:12px;color:#555555;">' + fuss.map(esc).join("<br>") + "</p>",
    "</div></body></html>",
    "",
  ].join("\n");

  return { betreff: betreff, text: text, html: html };
}

module.exports = {
  ARTEN: ARTEN,
  PLATZHALTER: PLATZHALTER,
  rendern: rendern,
  texte: texte,
  unbekanntePlatzhalter: unbekanntePlatzhalter,
  datumLang: datumLang,
  wannText: wannText,
};
