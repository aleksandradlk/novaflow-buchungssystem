# NovaFlow Buchungssystem – Vorlage

Vorlage für ein Online-Buchungssystem für Dienstleister mit festen Terminen (Werkstatt, Reiterhof, Handwerksbetrieb …). Einmal gebaut, pro Kunde nur über `kunden/<kunde>/` konfiguriert. Jeder Kunde bekommt eine eigene Instanz mit eigener Datenbank und eigener Subdomain.

Verbindliche Regeln: [`CLAUDE.md`](CLAUDE.md) · Vollständiger Auftrag: [`docs/BAUAUFTRAG_VORLAGE.md`](docs/BAUAUFTRAG_VORLAGE.md) · Entscheidungen: [`docs/ENTSCHEIDUNGEN.md`](docs/ENTSCHEIDUNGEN.md)

> **Stand:** Phase 7 – die Vorlage ist fertig: alle Module, Server-Skripte (`deploy/`), Backup und Wiederherstellung, Betriebsanleitung [`docs/BETRIEB.md`](docs/BETRIEB.md). Lokal in einer Generalprobe mit echtem Webserver und Backup-Programm erprobt; das Ausrollen auf den VPS folgt nach `docs/BETRIEB.md`, Abschnitt 12.

## Was die Vorlage kann

Alle Module lassen sich pro Kunde ein- und ausschalten:

- **Buchung** – öffentliche Buchungsseite in 4 Schritten (Angebot → Termin → Daten/Fotos → Bestätigung), mobil zuerst, ohne Cookies
- **Kapazität** – Terminregeln je Termintyp, Sperrtage, begrenzte Ressourcen, keine Doppelbuchung
- **Nachrichten** – Bestätigung, Erinnerungen, Verschieben/Absagen per Link
- **Kampagne** – Saison-Mails an Bestandskunden mit Einwilligung, Nachfass-Mails, Abmeldelink
- **Status** – Statuswechsel in der Übersicht löst automatisch eine Mail aus
- **Folgetermin** – zweiter Termin zu einer Buchung (z. B. Abholung im Frühjahr)
- **Übersicht** – Login-Bereich für Inhaber und Mitarbeiter
- **Touren** – Wochentermine nach PLZ sortiert, Route als Kartenlink
- **Import / Export** – Kundenliste importieren, alle Daten als CSV exportieren
- **Löschung** – automatische Löschung nach konfigurierbaren Fristen

Datenschutz (DSGVO) ist fester Bestandteil: Hosting nur in Deutschland, keine externen Dienste, Einwilligungen mit Datum und Quelle.

## Ordnerstruktur

```
kern/
  schema/                JSON-Schemas für die Kundenkonfiguration
  web/buchung/           öffentliche Seiten: Buchung (/), /verwalten/, /abmelden/
  web/uebersicht/        Übersicht für Inhaber und Mitarbeiter (Login, Termine, Kontakte, Touren, Verwaltung)
  web/gemeinsam/         gemeinsames CSS, Kalender, Helfer, Standardtexte (texte.js)
  pb_migrations/         Datenmodell: Collections, Felder, Zugriffsregeln, Rate-Limit
  pb_hooks/              eigene Routen /api/nf/*, Status-Hook, Rollen, Startwerte-Import
    nf/slots.js          Slot-Berechnung (ohne Backend-Abhängigkeit, auch in Node getestet)
  n8n/                   n8n-Vorlagen: Mail senden, neue-buchung, verschoben-abgesagt, status, erinnerungen, nachholen
  tools/                 Prüfung, lokaler Start, Instanz bauen (für deploy/), Tests
  pocketbase-version.json  gepinnte Backend-Version + SHA-256-Prüfsummen
kunden/
  _beispiel/             fiktiver „Musterbetrieb“ – Muster und Testkunde
deploy/                  Server: neuer-kunde.sh, ausrollen.sh, backup.sh, wiederherstellen.sh,
                         kunde-entfernen.sh, automationen.sh, server-einrichten.sh, melden.sh
  caddy/                 Webserver-Block je Instanz (Sicherheits-Header, gesperrte Pfade)
  systemd/               Dienst je Instanz, Backup-Zeitplan, Ausfall-Meldung
docs/                    Bauauftrag, Entscheidungen, Betriebsanleitung
.dev/                    lokale Instanzen, Daten und Programmdatei (nie im Repo)
```

## Lokal starten

Voraussetzung: [Node.js](https://nodejs.org/) 22.12 oder neuer (empfohlen: Version aus `.nvmrc`). Funktioniert unter Windows (PowerShell), Linux und macOS.

Einmalig im Repo-Ordner:

```
npm ci
```

Danach startet **ein Befehl** die lokale Instanz von `kunden/_beispiel`:

```
npm run dev
```

Der Befehl prüft die Konfiguration, lädt beim ersten Mal die gepinnte Backend-Version herunter (mit SHA-256-Prüfung), baut die Seiten mit dem Branding des Kunden zusammen, legt das Datenmodell an, importiert beim ersten Start die Startwerte aus `kunden/<kunde>/` und startet alles nur auf `127.0.0.1`:

- Buchungsseite: http://127.0.0.1:8090/
- Übersicht: http://127.0.0.1:8090/uebersicht/
- Admin: http://127.0.0.1:8090/_/ – beim allerersten Start erscheint im Terminal ein Link zum Anlegen des Admin-Zugangs (oder Zugang über `.env` vorgeben, siehe `.env.example`)

Weitere Befehle:

| Befehl | Zweck |
|---|---|
| `npm run dev -- <kunde>` | anderen Kunden lokal starten |
| `npm run dev -- <kunde> --startwerte-neu` | geänderte Konfiguration neu einlesen (nur solange es keine Buchungen gibt) |
| `npm run check` | alle Kundenkonfigurationen prüfen (`npm run check -- <kunde>` für einen) |
| `npm run n8n -- <kunde>` | n8n-Importdateien des Kunden erzeugen (siehe „Mails und Automationen“) |
| `npm test` | automatisierte Tests (inkl. Tests gegen eine echte Instanz). Browser-Tests nur mit Playwright, Mail-Ende-zu-Ende-Test nur mit `NF_TEST_N8N_DIR`, Server-Generalprobe nur mit `NF_TEST_CADDY` + `NF_TEST_RESTIC` (Pfade zu den Programmen) – sonst übersprungen |

Port und Admin-Zugang lassen sich über eine lokale `.env` setzen (Vorlage: `.env.example`). Lokale Daten liegen in `.dev/<kunde>/pb_data` – zum Zurücksetzen einfach den Ordner `.dev/<kunde>` löschen.

Benachrichtigungen an die Automationen (`NF_WEBHOOK_URL`, `NF_WEBHOOK_SECRET`) sind lokal optional; ohne Adresse werden sie übersprungen.

Hinter einem Firmen-Proxy braucht der erste Download zusätzlich die Umgebungsvariable `NODE_USE_ENV_PROXY=1`.

## Seiten

| Adresse | Inhalt |
|---|---|
| `/` | Buchung in 4 Schritten: Angebot → Termin (Kalender, Ausgebuchtes ausgegraut) → Angaben (Fotos, Einwilligungen) → Bestätigung. `/?t=<Kontakt-Token>` füllt die Daten vor (Link aus Kampagnen-Mail). |
| `/verwalten/?t=<Token>` | Termin ansehen, verschieben, absagen; Folgetermin buchen, wenn berechtigt |
| `/abmelden/?t=<Kontakt-Token>` | Abmeldung von werblichen Mails per Knopf |

Die Seiten sind reines HTML/CSS/JavaScript ohne Build-Schritt, ohne Cookies, ohne `localStorage` und ohne externe Aufrufe. Termine werden immer in der Zeitzone des Kunden angezeigt, egal wo das Gerät steht.

**Texte:** Alle Texte der Seiten stehen neutral in `kern/web/gemeinsam/texte.js` (du- und Sie-Variante). Jeder Schlüssel daraus kann pro Kunde in `kunden/<kunde>/texte/seiten.json` überschrieben werden (beide Varianten). Die Ansprache kommt aus `kunde.json → ansprache`.

**Branding:** Farben, Schrift und Logo kommen ausschließlich aus `kunden/<kunde>/branding/` (siehe Test „Branding und Ansprache kommen nur aus dem Kundenordner“).

## Übersicht (Login-Bereich)

`/uebersicht/` – für Handy und PC, Anmeldung mit **zwei Faktoren**: Passwort, dann ein 6-stelliger Code per E-Mail (über „Mail senden“, gilt 10 Minuten; lokal mit `npm run dev` steht er zusätzlich in der Konsole). Ohne Häkchen „angemeldet bleiben“ endet die Anmeldung mit dem Schließen des Tabs, mit Häkchen nach 7 Tagen.

| Bereich | Inhaber | Mitarbeiter |
|---|---|---|
| **Termine** – Woche (KW) und Tag, Details mit Kontakt, Zusatzfeldern, Fotos, Verlauf | ✔ | ✔ |
| **Status setzen** – Knöpfe aus `status.json`; ✉ = Kunde bekommt automatisch eine Mail | ✔ | ✔ |
| **Kontakte** – Kontakte ohne Buchung im aktuellen Buchungszeitraum | ✔ | ✔ |
| **Touren** – Termine mit Adresse einer Woche nach PLZ, Route als Google-Maps-Link (Modul `touren`) | ✔ | ✔ |
| **Verwaltung** – Einstellungen, Angebote, Terminregeln, Sperrtage, Benutzer | ✔ | – |
| **Import** – Kundenliste aus CSV oder Excel, Spalten zuordnen, Einwilligungen mit Quelle „import“ (Modul `import`) | ✔ | – |
| **Kampagne** – Saison-Mail starten, Stand ansehen (Modul `kampagne`) | ✔ | – |
| **Export** – ZIP mit einer CSV je Bereich, optional mit Fotos (Modul `export`) | ✔ | – |

**Ersten Inhaber-Zugang anlegen:** auf dem Server mit `deploy/neuer-kunde.sh <kunde> --inhaber <e-mail>` (Passwort wird einmal angezeigt); lokal im Admin-Bereich `/_/` unter `users` einen Datensatz mit `rolle = inhaber` anlegen. Weitere Zugänge legt der Inhaber danach selbst in der Verwaltung an (Mitarbeiter bis zur Grenze aus `kunde.json → rollen.max_mitarbeiter`).

Der Touren-Link öffnet Google Maps erst beim Klick (kein API-Schlüssel, vorher wird nichts geladen); die Seite weist darauf hin, dass dabei die Adressen an Google gehen. Google erlaubt höchstens 9 Zwischenstopps pro Link – bei mehr Stopps gibt es mehrere aneinander anschließende Links.

## Mails und Automationen

Alle Mails laufen über eine **Warteschlange** in der Kundeninstanz:

1. Bei einem Ereignis (Buchung, Folgetermin, Verschieben, Absage, Statuswechsel mit Mail-Flag) erzeugt die Instanz die fertige Mail (Text + HTML, du/Sie, Absender und Signatur des Kunden) und legt sie in `nachrichten` ab – mit eindeutigem Schlüssel, damit nichts doppelt verschickt wird.
2. Ein Webhook an n8n meldet nur den Schlüssel (keine personenbezogenen Daten).
3. Der n8n-Workflow **Mail senden** holt die Mail ab, verschickt sie über **SMTP** oder **Microsoft 365** (Graph, Token wird zwischengespeichert) und meldet das Ergebnis zurück. Im Testmodus (`mail_modus = test`) geht alles an `test_empfaenger`, im Betreff steht der echte Empfänger.
   Anmeldecodes für die Übersicht laufen denselben Weg (Workflow **anmeldung**), gehen aber immer an die echte Adresse und werden nach dem Versand gelöscht.
4. **erinnerungen** (täglich 08:00) legt Erinnerungen für Termine in N Tagen an (`nachrichten.json → erinnerungen_tage_vorher`). **nachholen** (alle 15 Min.) verschickt, was liegen geblieben oder fehlgeschlagen ist (bis zu 5 Versuche). Bei Fehlern geht eine Telegram-Nachricht ohne personenbezogene Daten an NovaFlow.

**Kampagne, Nachfass, Folgetermin-Einladung** (Massenmails): werden zuerst *geplant* und dann vom Workflow **kampagne-etappen** in Paketen (`etappe_groesse`) im Abstand `etappe_abstand_minuten` innerhalb des `versandfenster` freigegeben (alles aus `nachrichten.json`).
- **Kampagne** (Start in der Übersicht oder per Webhook `…/<kunde>/kampagne-start-jetzt`): an alle Kontakte mit E-Mail-Einwilligung, die nicht abgemeldet sind und im aktuellen Buchungszeitraum noch nicht gebucht haben – mit persönlichem Buchungslink (Daten vorausgefüllt) und Abmeldelink.
- **Nachfass** (täglich): bis zu N Erinnerungen an Nicht-Bucher, N und Abstände aus `nachfass.abstaende_tage`.
- **Folgetermin-Einladung** (täglich ab `folgetermin_ab`): an alle berechtigten Buchungen ohne Folgetermin – Transaktionsmail, keine Werbe-Einwilligung nötig.
- Beim Versand wird erneut geprüft: wer sich inzwischen abgemeldet oder gebucht hat, wird übersprungen.

**Löschung** (täglich nachts, Modul `loeschung`): Fotos nach `fotos_monate_nach_abschluss`, abgeschlossene oder abgesagte Buchungen nach `buchungen_monate_nach_abschluss` (eine Buchung mit noch offenem Folgetermin bleibt). Kontakte ohne verbleibende Buchung werden gelöscht, wenn sie keine Einwilligung haben; abgemeldete werden auf E-Mail + Abmeldung reduziert, damit sie nie wieder angeschrieben werden. Kontakte, die nie gebucht haben und keine Einwilligung haben, nach `kontakte_ohne_buchung_monate`; Mail-Inhalte versendeter Nachrichten werden nach `mailinhalte_tage` geleert (Nachweis bleibt).

**Workflows je Kunde** (nur für gebuchte Module): Mail senden, neue-buchung, verschoben-abgesagt, status, anmeldung, erinnerungen (08:00), nachholen (alle 15 Min.), kampagne-etappen, kampagne-start (nur von Hand), nachfass (09:30), folgetermin-einladung (09:00), loeschung (03:00).

**Texte:** Standardtexte (neutral, du/Sie) in `kern/pb_hooks/nf/mail_standard.js`; jeder Schlüssel ist pro Kunde in `kunden/<kunde>/texte/mails.json` überschreibbar, auch eigene Texte je Status (`status_<code>_betreff`, `status_<code>_inhalt`). Platzhalter: `{{vorname}}`, `{{nachname}}`, `{{anrede_name}}`, `{{betrieb}}`, `{{angebot}}`, `{{termin}}`, `{{status}}`, `{{wann}}`, `{{verwalten_link}}` u. a. – Tippfehler meldet `npm run check`.

**n8n einrichten (pro Kunde)** – auf dem Server mit `deploy/automationen.sh <instanz>`, siehe [`docs/BETRIEB.md`](docs/BETRIEB.md) Abschnitt 3. Lokal:

1. In `.env` die Werte für den Kunden setzen (`NF_WEBHOOK_SECRET`, `PB_PORT`, SMTP- oder Microsoft-365-Zugang, Telegram – siehe `.env.example`).
2. `npm run n8n -- <kunde>` erzeugt `.dev/<kunde>/n8n/workflows.json` (ohne Secrets) und `credentials.json` (mit Secrets – nach dem Import löschen).
3. Import wie vom Befehl ausgegeben: `import:credentials`, `import:workflow`, je Workflow `publish:workflow`, dann n8n neu starten. Erprobt mit n8n **2.46.7**.

Zum sofortigen Auslösen gibt es die geschützten Webhooks `…/<kunde>/erinnerungen-jetzt` und `…/<kunde>/nachholen-jetzt` (Header `X-NF-Secret`).

**Mail-Ende-zu-Ende-Test:** braucht eine n8n-Installation (mit passender Node-Version, n8n 2.x braucht Node 24) außerhalb des Repos:

```
NF_TEST_N8N_DIR=/pfad/zur/n8n-installation npm test
```

Der Test startet n8n abgeschottet (eigener Datenordner, nur 127.0.0.1), ein Test-Postfach und Attrappen für Microsoft 365 und Telegram – es geht nichts nach außen.

## Schnittstelle (eigene Routen)

Öffentlich erreichbar sind nur diese Routen; alle Collections sind für Gäste gesperrt. Fehlermeldungen sind deutsch und ohne Technikdetails, alle Routen sind pro IP begrenzt.

| Route | Zweck |
|---|---|
| `GET /api/nf/angebot?t=` | Angebote, Texte (du/Sie), Formular, Einwilligungstexte, Links; mit Kontakt-Token vorausgefüllte Daten |
| `GET /api/nf/slots?typ=&von=&bis=[&angebot=&optionen=]` | freie Slots (max. 62 Tage), Sperrtage im Bereich |
| `POST /api/nf/buchen` | Buchung in einer Transaktion; JSON oder Multipart (`daten` = JSON, `fotos` = Dateien) |
| `GET/POST /api/nf/verwalten?t=` | Termin ansehen, `{"aktion":"verschieben","start":…}` oder `{"aktion":"absagen"}` |
| `GET/POST /api/nf/folgetermin?t=` | Folgetermin ansehen bzw. `{"start":…}` buchen (nur berechtigte Buchungen) |
| `GET/POST /api/nf/abmelden?t=` | GET zeigt den Stand, erst POST meldet von werblichen Mails ab (Mailprogramme öffnen Links teils automatisch) |

Zeiten werden als ISO-Zeitstempel (UTC) übergeben; Regeln, Tage und Wochen gelten in der Zeitzone des Kunden.

## Neuen Kunden anlegen

1. `kunden/_beispiel/` nach `kunden/<kunde>/` kopieren (`<kunde>`: Kleinbuchstaben, Ziffern, Bindestrich) und anpassen:

   | Datei | Inhalt |
   |---|---|
   | `kunde.json` | Kennung (= Ordnername), Stammdaten, Domain, aktive Module laut Projektvereinbarung, Mitarbeiter-Limit, Löschfristen, Formularfelder |
   | `angebote.json` | Angebote mit Preis-Anzeige, Termintyp, optional Ressource, Folgetermin-Berechtigung, Zusatzoptionen |
   | `termine.json` | Buchungszeitraum, Termintypen mit Regeln (Wochentage 1 = Mo … 7 = So), Ressourcen, Sperrtage, Folgetermin-Zeitraum |
   | `status.json` | Statusliste: genau ein Start-Status, Abschluss-Status, Mail ja/nein |
   | `nachrichten.json` | Absender des Kunden, Versandweg, Test-/Live-Modus, Erinnerungen, Kampagnen-Etappen, Nachfass-Abstände |
   | `rechtliches.json` | Impressum- und Datenschutz-Link des Kunden, Einwilligungstexte |
   | `texte/seiten.json` | Seitentexte in du- und Sie-Variante |
   | `texte/mails.json` | Mail-Texte in du- und Sie-Variante (mindestens Signatur; überschreibt die Standardtexte) |
   | `branding/` | `branding.json` (Farben, Schrift), Logo, ggf. Schriftdateien (WOFF2) |

2. `npm run check -- <kunde>` – meldet Tippfehler, fehlende Felder, falsche Verweise (z. B. unbekannter Termintyp), Modul-Abhängigkeiten und zu geringen Farbkontrast.
3. Lokal ansehen: `npm run dev -- <kunde>`.
4. Committen, pushen, auf dem Server anlegen: `deploy/neuer-kunde.sh <kunde> --inhaber <e-mail>` – alles Weitere (Automationen, Livegang, Backups, Export, Löschen nach Vertragsende) in [`docs/BETRIEB.md`](docs/BETRIEB.md).

Die JSON-Dateien sind Startwerte; nach dem Ausrollen pflegt der Inhaber Angebote, Terminregeln, Sperrtage und Kapazitäten in der Übersicht. Mit einem Editor wie VS Code helfen die `$schema`-Angaben in den Dateien beim Ausfüllen.

Echte Kundendaten (Kundenlisten, Fotos, Datenbanken, `.env`) gehören nie ins Repo – siehe `.gitignore`.
