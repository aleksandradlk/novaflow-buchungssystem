# Bauauftrag: NovaFlow Buchungssystem – Vorlage

Stand: 09.11.2026 · Auftraggeberin: Aleksandra Dalak, NovaFlow Services

Ziel: **ein** Buchungssystem, das für Dienstleister mit festen Terminen funktioniert (Werkstatt, Reiterhof, Handwerksbetrieb …) und pro Kunde nur über `kunden/<kunde>/` angepasst wird. Kein Kunde ist hier fest eingebaut. Als Testkunde dient `kunden/_beispiel` (fiktiver Betrieb „Musterbetrieb“).

Was ein Kunde später wirklich bekommt, steht immer in **seiner** Projektvereinbarung. Die Vorlage enthält alle Bausteine; pro Kunde wird in der Konfiguration ein- oder ausgeschaltet, was er gebucht hat.

---

## 1. Bausteine der Vorlage (alle per Konfiguration an/aus)

| Modul | Was es kann |
|---|---|
| **buchung** | Öffentliche Buchungsseite: Angebot wählen → Termin wählen → Daten + optional Fotos → Bestätigung. Mobil zuerst, ohne Cookies. |
| **kapazitaet** | Terminregeln je Termintyp (Wochentage, Uhrzeiten, Takt, max. pro Slot/Tag/Woche), Sperrtage, Zeitraum. Optional begrenzte Ressource (z. B. Lagerplätze, Boxen). Keine Doppelbuchung (Prüfung in einer Transaktion). |
| **nachrichten** | Bestätigung, Erinnerungen (Zeitpunkte konfigurierbar, z. B. 3 Tage + 1 Tag vorher), Verschieben/Absagen per Link, frei gewordene Termine wieder buchbar. |
| **kampagne** | Saison-/Info-Mail an Bestandskunden mit Einwilligung, persönlicher Buchungslink, Abmeldelink, Versand in Etappen; bis zu N Nachfass-Mails an Nicht-Bucher (Abstände konfigurierbar). |
| **status** | Betreiber setzt in der Übersicht per Klick einen Status → Endkunde bekommt automatisch Mail. Statusliste pro Kunde konfigurierbar. |
| **folgetermin** | Zweiter Termin zu einer Buchung (z. B. Rückgabe/Abholung im Frühjahr), nur für berechtigte Buchungen, eigener Termintyp und Zeitraum. |
| **uebersicht** | Login-Bereich (Handy + PC): Buchungen nach KW/Tag, Details, Fotos, Status, offene Kontakte ohne Buchung. Rollen: `inhaber` (alles), `mitarbeiter` (sehen + Status setzen). Max. Anzahl Mitarbeiter konfigurierbar. |
| **touren** | Termine mit Abholadresse einer Woche nach PLZ sortiert, Route als Google-Maps-Link (kein API-Schlüssel). |
| **import** | Einmaliger Import einer Kundenliste (CSV/Excel) mit Feld-Zuordnung und Einwilligungen (Quelle `import`). |
| **export** | CSV-Export aller Daten einer Kundeninstanz. |
| **loeschung** | Automatische Löschung nach konfigurierbaren Fristen (Fotos, abgeschlossene Buchungen). |

**Nicht Teil der Vorlage** (nie bauen, auch nicht „nebenbei“): KI-Antwortentwürfe/Postfach-App, WhatsApp-Versand, Newsletter-Editor, Preis- oder Fahrtkostenrechner, Telefonansage, CRM-Anbindungen, Online-Zahlung.

---

## 2. Architektur

```
Endkunde ──► <buchung.kunde.de> (Caddy) ─┬─► statische Buchungsseite (kern/web/buchung)
                                         ├─► /api/*        → PocketBase der Kundeninstanz (nur eigene Routen)
                                         └─► /uebersicht   → Login-Bereich (kern/web/uebersicht)
PocketBase-Hooks ──► n8n-Webhook (mit Secret) ──► Unter-Workflow „Mail senden“ ──► Adapter graph | smtp | test
n8n-Zeitpläne ──► Erinnerungen, Nachfass, Kampagnen-Etappen, Folgetermin-Mails, Löschung
```

- **Eine PocketBase-Instanz pro Kunde** (eigener systemd-Dienst, eigener Port auf 127.0.0.1, eigenes `pb_data`). Neue Instanz per `deploy/neuer-kunde.sh <kunde>`.
- **Caddy:** pro Kunde ein Site-Block aus Vorlage; `/_/` (PocketBase-Admin) von außen blockiert, Admin nur per SSH-Tunnel; `Server`-Header entfernen; Sicherheits-Header (CSP ohne externe Quellen, HSTS, `nosniff`, `Referrer-Policy: no-referrer`).
- **n8n:** Workflows als JSON-Vorlagen mit Platzhaltern für Kunde, Webhook-Pfade mit Kundenkennung, Aufruf nur mit geheimem Header. Pro Kunde eigener Satz Credentials.
- **PocketBase-Version:** aktuelle Release-Version fest pinnen (Stand 23.10.2026: v0.40.6), Superuser mit 2FA/OTP.

---

## 3. Kundenkonfiguration (`kunden/<kunde>/`)

```
kunden/<kunde>/
├─ kunde.json        Stammdaten, Domain, aktive Module, Rollen-Limits, Löschfristen, Zeitzone
├─ angebote.json     Angebote/Pakete (Code, Name, Beschreibung, Preis-Anzeige, Termintyp, Zusatzoptionen)
├─ termine.json      Termintypen + Startregeln (Wochentage, Zeiten, Takt, Kapazitäten), Ressourcen (z. B. Lagerplätze)
├─ status.json       Statusliste mit Anzeigenamen + ob Mail ausgelöst wird
├─ nachrichten.json  Erinnerungs-Zeitpunkte, Nachfass-Abstände, Kampagnen-Etappen, Absender, Mail-Adapter
├─ texte/            Mail-Vorlagen + Seitentexte (du/Sie-Variante wählbar), Platzhalter {{vorname}} usw.
├─ branding/         Logo, Farben (CSS-Variablen), lokale Schriften
└─ rechtliches.json  Links Impressum/Datenschutz des Kunden, Einwilligungstexte
```

Die JSON-Dateien sind **Startwerte**; nach dem Ausrollen ändert der Inhaber Angebote, Terminregeln, Sperrtage und Kapazitäten in der Übersicht. Ein JSON-Schema (`kern/schema/`) prüft jede Kundenkonfiguration vor dem Ausrollen.

---

## 4. Datenmodell (PocketBase, pro Instanz)

- **`einstellungen`** (1 Datensatz): Zeiträume (`buchbar_ab`, `buchbar_bis`, `folgetermin_ab/bis`), `max_pro_woche`, Ressourcen-Kapazitäten, `mail_modus` (`test`|`live`), `test_empfaenger`, `absender`, `ansprache` (`du`|`sie`), Hinweistexte.
- **`angebote`**: `code`, `name`, `beschreibung`, `preis_text`, `termintyp`, `zusatzoptionen` (JSON), `aktiv`, `sortierung`.
- **`terminregeln`**: `termintyp`, `wochentag`, `von`, `bis`, `takt_minuten`, `max_pro_slot`, `max_pro_tag`, `gueltig_von`, `gueltig_bis`.
- **`sperrtage`**: `datum`, `grund`.
- **`kontakte`**: Anrede, Vor-/Nachname, E-Mail, Telefon, Adresse (Straße, PLZ, Ort), `zusatzfelder` (JSON, z. B. Modell, Pferdename), Einwilligungen je Kanal (bool + Datum + Quelle), `abgemeldet` + Datum, `token` (≥ 32 Zeichen), Kampagnen-Zeitstempel (`kampagne_am`, `nachfass_n_am`), `notiz`.
- **`buchungen`**: `kontakt`, `angebot`, `zusatzoptionen`, `termintyp`, `termin_start`, `termin_ende`, `zusatzfelder` (JSON), `fotos` (Datei, Anzahl/Größe konfigurierbar, nur Bilder), `status`, `abgeschlossen_am`, `token_verwalten`, `eltern_buchung` (für Folgetermin), `bemerkung`.
- **`status_log`**: `buchung`, `status`, `gesetzt_von`, `zeit`, `mail_gesendet`.
- **`nachrichten`**: `art`, `kontakt`, `buchung`, `schluessel` (eindeutig → kein Doppelversand), `gesendet_am`, `ergebnis`.
- **`users`** (Auth): `name`, `rolle` (`inhaber`|`mitarbeiter`), 2FA möglich.

Zugriffsregeln: Keine Collection öffentlich les-/schreibbar. Öffentlich nur die eigenen Routen aus Abschnitt 5. `mitarbeiter`: lesen + Status setzen, keine Einstellungen, kein Export, kein Löschen.

---

## 5. Eigene Routen (pb_hooks)

| Route | Zweck |
|---|---|
| `GET /api/nf/angebot?t=` | Angebote, Hinweise, Branding-Infos; mit gültigem Token vorausgefüllte Kontaktdaten |
| `GET /api/nf/slots?typ=&von=&bis=` | freie Slots = Regeln − Sperrtage − Buchungen − Wochen-/Ressourcenkapazität |
| `POST /api/nf/buchen` | Buchung in Transaktion (Kapazität + Ressourcen prüfen), Fotos, Einwilligungen mit Datum, dann Webhook „neue Buchung“ |
| `GET/POST /api/nf/verwalten?t=` | Termin ansehen, verschieben, absagen |
| `GET/POST /api/nf/folgetermin?t=` | Folgetermin buchen (nur berechtigte Buchungen) |
| `GET /api/nf/abmelden?t=` | Abmeldung von werblichen Mails |
| Hook Statusänderung | `status_log` + Webhook „Status“ (nur Status mit Mail-Flag) |

Alle Routen: Eingabeprüfung, Rate-Limit pro IP, deutsche Fehlermeldungen ohne Technikdetails.

---

## 6. Seiten

**Buchungsseite** (4 Schritte, mobil zuerst): Angebot (Karten, Zusatzoptionen) → Termin (Kalender, Ausgebuchtes ausgegraut, Hinweistexte) → Daten (Pflichtfelder + `zusatzfelder` aus Konfiguration, optionale Fotos, Einwilligungs-Häkchen nicht vorausgewählt, Link Datenschutz des Kunden) → Bestätigung. Footer: Impressum/Datenschutz des Kunden. Mit Token aus Kampagnen-Mail vorausgefüllt. Keine Cookies, kein `localStorage`, keine externen Aufrufe.

**Verwalten-Seite:** Termin ansehen, verschieben, absagen; Folgetermin buchen (wenn berechtigt). **Abmelde-Seite:** Bestätigung der Abmeldung.

**Übersicht** (`/uebersicht`, Login): Wochen-/Tagesansicht, Buchungsdetails mit Fotos, Status-Buttons aus `status.json`, Liste offener Kontakte, Touren (wenn Modul aktiv); nur `inhaber`: Einstellungen, Angebote, Terminregeln, Sperrtage, Benutzer, Export.

Design: Branding aus `kunden/<kunde>/branding` per CSS-Variablen; klare, ruhige Oberfläche; barrierearm (Kontrast, Tastatur, Labels).

---

## 7. n8n-Vorlagen (`kern/n8n/`)

**Unter-Workflow „Mail senden“** (einzige Stelle, die Mails verschickt): Eingabe `empfaenger, betreff, html, text, art, schluessel, kontakt, buchung` → Dublettenprüfung über `schluessel` → Adapter:
- `test`: alles an `test_empfaenger`, Betreff-Präfix `[TEST → echter Empfänger]`
- `graph`: Token per Client Credentials (`https://login.microsoftonline.com/<TENANT_ID>/oauth2/v2.0/token`, Scope `https://graph.microsoft.com/.default`), Token zwischenspeichern, `POST https://graph.microsoft.com/v1.0/users/<absender>/sendMail` (Erfolg = 202)
- `smtp`: Versand über SMTP-Zugang des Kunden
→ Ergebnis in `nachrichten`; Fehler → Telegram an Aleksandra **ohne personenbezogene Daten**.

| Workflow | Auslöser | Modul |
|---|---|---|
| neue-buchung | Webhook | buchung, nachrichten |
| verschoben-abgesagt | Webhook | nachrichten |
| erinnerungen | täglich, Zeitpunkte aus Konfiguration | nachrichten |
| kampagne-start | manuell | kampagne |
| kampagne-etappen | alle X Min. tagsüber, bis alle versendet | kampagne |
| nachfass | täglich | kampagne |
| status | Webhook | status |
| folgetermin-einladung | am Datum `folgetermin_ab` | folgetermin |
| loeschung | täglich nachts | loeschung |
| backup-export | täglich nachts (konsistenter Snapshot für restic) | Betrieb |

Mail-Vorlagen: HTML + Text, Platzhalter, du/Sie-Variante, Absendername und Signatur **des Kunden** (nicht NovaFlow).

---

## 8. Betrieb (`deploy/`)

- `neuer-kunde.sh <kunde>`: Konfiguration prüfen, PocketBase-Instanz + systemd-Dienst + Port anlegen, Migrationen, Startwerte importieren, Caddy-Block erzeugen, n8n-Workflows aus Vorlage mit Kundenkennung erzeugen (Import-Datei), `.env` aus `.env.example` anlegen.
- `ausrollen.sh <kunde>`: Code aktualisieren, Migrationen, Dienst neu starten, Smoke-Test.
- Backups: täglich (30 Tage) + monatlich (3 Monate), nur auf NovaFlow-eigenem Speicher bei Hostinger, sofern beim Kunden nichts anderes vereinbart ist; `wiederherstellen.sh` + dokumentierter Wiederherstellungstest.
- `docs/BETRIEB.md`: Wie lege ich einen Kunden an, ändere Werte, schalte live, mache einen Export, lösche Daten nach Vertragsende.

---

## 9. Phasen mit Abnahmekriterien

**Phase 1 – Grundgerüst**
Ordnerstruktur, `.env.example`, JSON-Schema für Kundenkonfiguration, `kunden/_beispiel` (fiktiver Musterbetrieb mit 2 Angeboten, 2 Termintypen, 1 Ressource, 3 Status), lokales Dev-Setup (PocketBase + statische Seiten) unter Windows und Linux.
✅ `kunden/_beispiel` besteht die Schema-Prüfung; lokale Instanz startet mit einem Befehl.

**Phase 2 – Datenmodell + Routen**
Migrationen, Rollen, Zugriffsregeln, Routen aus Abschnitt 5, Startwerte-Import aus Konfiguration.
✅ Slot-Berechnung korrekt (Sperrtag, volle Woche, voller Slot, Ressource voll); zwei gleichzeitige Buchungen auf den letzten Platz → nur eine erfolgreich (automatisierter Test).

**Phase 3 – Buchungs-, Verwalten- und Abmeldeseite**
✅ Buchung am Handy in < 2 Min.; Netzwerk-Tab zeigt keine Cookies und keine externen Aufrufe; Fotos gespeichert; Einwilligungen mit Datum; Branding wechselt allein über `kunden/<kunde>/branding`.

**Phase 4 – Mail-Grundlage + Transaktionsmails**
„Mail senden“ mit Adaptern `test`, `smtp`, `graph`; Workflows neue-buchung, verschoben-abgesagt, erinnerungen, status.
✅ Jede Mail-Art einmal im Test-Postfach, keine doppelt; du/Sie-Umschaltung wirkt.

**Phase 5 – Übersicht + Touren**
✅ `inhaber` und `mitarbeiter` getrennt getestet; Status-Klick erzeugt Mail; Touren-Link öffnet Google Maps mit richtiger Reihenfolge.

**Phase 6 – Kampagne, Folgetermin, Import, Export, Löschung**
✅ Import von 10 Fake-Kontakten aus CSV; Kampagne im Testmodus in Etappen; Abgemeldete bekommen nichts; Folgetermin nur für Berechtigte; Export vollständig; Löschung greift nach Frist (Test mit verkürzter Frist).

**Phase 7 – Deploy + Betrieb**
`deploy/`-Skripte, Caddy-Vorlage, Backup + Wiederherstellung, `docs/BETRIEB.md`.
✅ `_beispiel` auf dem VPS unter `demo.novaflowservices.de` (oder einer von Aleksandra genannten Test-Adresse) erreichbar; `/_/` von außen gesperrt; kein Tool-Name in Headern/Seiten; Backup auf Testinstanz wiederhergestellt.

Danach: Vorlage ist fertig. Der erste echte Kunde (LOHBOTIC) bekommt einen eigenen Auftrag `docs/kunden/lohbotic.md` mit seiner Konfiguration – **nur die Module aus seiner Projektvereinbarung**.

