# Architektur-Entscheidungen

Logbuch aller grundlegenden Entscheidungen für die Vorlage. Neue Einträge oben anfügen. Jede Entscheidung mit Datum, Entscheidung, Begründung und – falls vorhanden – Risiken bzw. Gegenmaßnahmen.

| Datum | Entscheidung | Begründung |
|---|---|---|
| 10.11.2026 | n8n-Version, Import und Testumgebung | siehe E-009 |
| 10.11.2026 | Mailversand über Warteschlange (Outbox) in der Kundeninstanz | siehe E-008 |
| 09.11.2026 | Öffentliche Seiten: Texte, Abmeldung, Kalender | siehe E-007 |
| 09.11.2026 | Update-Quelle von PocketBase ändert sich | siehe E-006 |
| 09.11.2026 | Regeln für Kapazität, Verwalten und Kontakte (Details, die der Bauauftrag offen lässt) | siehe E-005 |
| 09.11.2026 | Datenmodell: Ergänzungen zu Abschnitt 4 | siehe E-004 |
| 09.11.2026 | Aufbau der Kundenkonfiguration (Details, die der Bauauftrag offen lässt) | siehe E-003 |
| 09.11.2026 | Werkzeuge: Node.js für Prüfung/Start, Seiten ohne Build-Schritt, PocketBase v0.40.6 | siehe E-002 |
| 09.11.2026 | PocketBase statt Postgres + eigenes Backend | siehe E-001 |

---

## E-009 · 10.11.2026 · n8n-Version, Import und Testumgebung

- **Erprobt mit n8n 2.46.7** (aktuelle stabile Version am 10.11.2026). n8n 2.x braucht Node 24. Die Workflow-Vorlagen nutzen nur Standard-Bausteine (Webhook, Execute Workflow, HTTP Request, Send Email, If, Code, Schedule, Telegram).
- **Import in 2.x:** Workflows werden nach `import:workflow` per `publish:workflow --id=…` aktiv; beim Import aktivieren (`--activeState=fromJson`) geht im normalen Betrieb nicht. Auch der Unter-Workflow „Mail senden“ muss veröffentlicht sein. `npm run n8n` gibt die Befehle in der erprobten Reihenfolge aus.
- **Feste IDs** für Workflows und Zugangsdaten, abgeleitet aus der Kundenkennung: erneuter Import überschreibt statt zu verdoppeln. Telegram ist ein gemeinsamer NovaFlow-Zugang, alle anderen Zugangsdaten gibt es pro Kunde.
- **Datensparsam:** erfolgreiche Ausführungen speichert n8n nicht (`saveDataSuccessExecution: none`); Webhooks tragen nur den Nachrichtenschlüssel.
- **Testumgebung:** n8n ist **keine** Abhängigkeit des Repos (rund 3 GB). Der Ende-zu-Ende-Test läuft nur mit `NF_TEST_N8N_DIR` und sonst nicht.
- **Offen:** Welche n8n-Version läuft auf dem VPS? Bei 1.x müssen Import-Befehle und evtl. Baustein-Versionen angepasst werden.

## E-008 · 10.11.2026 · Mailversand über Warteschlange (Outbox) in der Kundeninstanz

**Entscheidung:** Die Kundeninstanz erzeugt jede Mail selbst (Vorlagen-Engine `kern/pb_hooks/nf/mailvorlagen.js`) und legt sie in `nachrichten` ab, in derselben Transaktion wie die Buchung. n8n bekommt per Webhook nur den Schlüssel; „Mail senden“ holt die Mail über interne Routen (`/api/nf-intern/…`, Header `X-NF-Secret`), verschickt sie und meldet das Ergebnis.

**Abweichung vom Bauauftrag (Abschnitt 7):** „Mail senden“ bekommt als Eingabe nur `schluessel` statt `empfaenger, betreff, html, …`. Die Instanz bleibt die einzige Quelle; Testmodus-Umleitung und Betreff-Präfix setzt sie beim Abholen.

**Begründung:**
- **Kein Doppelversand:** Der Schlüssel ist eindeutig (`bestaetigung:<id>`, `erinnerung:<id>:<N>`, `status:<log-id>` …). Das Abholen sperrt die Nachricht (`in_versand`), eine gesendete wird nie wieder abgegeben. Ein Test schaltet das ab und wird rot.
- **Nichts geht verloren** (bestätigte Warteschlange aus Phase 2): Ist n8n nicht erreichbar oder schlägt der Versand fehl, holt „nachholen“ die Nachricht nach (offen > 2 Min., Fehler alle 15 Min., höchstens 5 Versuche, hängende Sendungen nach 30 Min.).
- **Datenschutz:** Personenbezogene Daten verlassen die Instanz nur in der Mail selbst; Webhooks und Telegram enthalten keine.
- **Testbar:** Vorlagen, Testmodus und Sperre sind ohne n8n mit Node-Tests prüfbar.

**Weitere Festlegungen:**
- **Erinnerungen** gehen an Termine, die genau N Tage entfernt sind (lokaler Kalendertag). Fällt ein Tageslauf aus, wird diese Erinnerung nicht nachträglich verschickt.
- **Status-Mails** nur für Status mit `mail: true`, nicht für abgesagte Buchungen; nach erfolgreichem Versand wird `status_log.mail_gesendet` gesetzt.
- **Pflichtangaben** (Firma, Anschrift, Kontakt) stehen im Fuß jeder Mail. Die HTML-Mails laden nichts von außen (keine Bilder, keine Schriften).
- **Microsoft 365** über den n8n-Zugangstyp „OAuth2 API“ mit Client Credentials: n8n holt und speichert das Token selbst. Der Absendername kommt dort aus dem Postfach, nicht aus der Konfiguration.

## E-007 · 09.11.2026 · Öffentliche Seiten: Texte, Abmeldung, Kalender

- **Texte mit Standardwerten im Kern:** Beschriftungen wie „Weiter“, „Vorname“ oder „Termin absagen“ stehen neutral und ohne Branchenbegriffe in `kern/web/gemeinsam/texte.js`, jeweils in du- und Sie-Variante. Jeder Schlüssel ist pro Kunde in `texte/seiten.json` überschreibbar. So bleibt die Kundenkonfiguration klein, und der Kern enthält trotzdem nichts Kundenspezifisches.
- **Abmeldung nur per Knopf:** `GET /api/nf/abmelden` zeigt nur den Stand. Erst `POST` meldet ab, ausgelöst durch den Knopf auf `/abmelden/`. Grund: Manche Mailprogramme und Virenscanner öffnen Links automatisch. Das weicht von Abschnitt 5 des Bauauftrags ab und wurde am 09.11.2026 freigegeben.
- **Einwilligungen** werden nie vorausgewählt, auch wenn bereits eine Einwilligung besteht. Ein Haken ergänzt nur, er entzieht nichts (siehe E-005).
- **Kalender:** Er öffnet im ersten buchbaren Monat und wählt den ersten freien Tag vor. Geschlossene (Sperrtag) und ausgebuchte Tage sowie volle Uhrzeiten sind ausgegraut, durchgestrichen und nicht wählbar; Screenreader lesen den Grund vor. Ist ein Termin beim Absenden inzwischen vergeben, geht es mit Hinweis zurück zur Terminwahl.
- **Verlauf:** Die vier Schritte stehen im Browser-Verlauf (`history.pushState`), damit die Zurück-Taste am Handy funktioniert. Es wird nichts gespeichert.
- **E-Mail-Prüfung** so streng wie das Datenbankfeld, damit ungültige Adressen eine Feldmeldung bekommen statt eines Serverfehlers. Gefunden durch einen Browser-Test mit `voll-08:00-a@…`.
- **Weiterhin offen:** Mindest-Vorlaufzeit für Buchungen und eine Frist für Verschieben/Absagen. Beides ist nicht gebaut; im Moment gilt „ab jetzt“ bzw. „bis Terminbeginn“.

## E-006 · 09.11.2026 · Update-Quelle von PocketBase ändert sich

**Feststellung:** Im Changelog von v0.40.6 kündigt der Entwickler an, dass dies wahrscheinlich das letzte Release auf GitHub ist. Künftige Versionen sollen von einer anderen Adresse kommen, die es noch nicht gibt.

**Entscheidung:** Wir bleiben bei v0.40.6. Vor dem nächsten Update prüfen wir die neue Quelle bewusst: Ist sie vertrauenswürdig? Gibt es Prüfsummen? Ist es weiterhin Open Source? Danach passen wir `kern/pocketbase-version.json` und `kern/tools/lib/pocketbase.mjs` an. Den eingebauten Update-Befehl von PocketBase nutzen wir nicht.

## E-005 · 09.11.2026 · Regeln für Kapazität, Verwalten und Kontakte

- **Slot-Belegung:** Es zählen alle aktiven Buchungen desselben Termintyps, die sich mit dem Slot **überschneiden**. Wenn Takt und Dauer gleich sind, heißt das: gleiche Startzeit.
- **Tag:** `max_pro_tag` zählt die Buchungen des Termintyps an diesem Tag.
- **Woche:** `max_pro_woche` zählt **alle** aktiven Buchungen der ISO-Woche (Montag bis Sonntag), also alle Termintypen einschließlich Folgeterminen.
- **Ressource:** Jede aktive Buchung mit dieser Ressource im Buchungszeitraum (`buchbar_ab` bis `buchbar_bis`) belegt eine Einheit, und zwar für die ganze Saison. Gedacht ist das für Lagerplätze oder Boxen über den Winter. Folgetermine belegen keine Ressource.
- **Doppelbuchung:** Prüfung und Speichern laufen in **einer** Transaktion. SQLite führt Schreib-Transaktionen nacheinander aus. Ein automatischer Test schickt 10 bzw. 8 gleichzeitige Anfragen auf den letzten Platz und erwartet genau einen Erfolg. Als Gegenprobe ohne Transaktion schlägt dieser Test fehl.
- **Zeiten:** Regeln, Tage und Wochen gelten in der Zeitzone des Kunden, mit Sommer- und Winterzeit. Gespeichert und übertragen wird in UTC. Vergangene Slots werden nicht angeboten. Eine Mindest-Vorlaufzeit gibt es noch nicht (offene Frage).
- **Verschieben/Absagen:** Online möglich bis zum Terminbeginn, aber nicht nach Abschluss und nicht nach einer Absage. Eine Absage setzt `abgesagt_am`, sie ist kein Status. Der Platz wird sofort wieder frei. Wird die Buchung abgesagt, wird auch ihr Folgetermin abgesagt.
- **Folgetermin:** Nur für Angebote mit `folgetermin: true`, einmal pro Buchung, nur im Folgetermin-Zeitraum. Der Link ist der Verwalten-Link der ursprünglichen Buchung.
- **Kontakte:** Kommt eine Buchung mit Kontakt-Token (aus einer Kampagnen-Mail), werden die Kontaktdaten aktualisiert. Kommt sie ohne Token, aber mit bekannter E-Mail, wird sie dem vorhandenen Kontakt zugeordnet. Dabei werden nur leere Felder ergänzt, damit niemand fremde Daten überschreiben kann. Einwilligungen werden nur hinzugefügt, mit Datum und Quelle `buchung`, und nie über das Formular entzogen. Eine neue E-Mail-Einwilligung hebt eine frühere Abmeldung auf.
- **Benachrichtigungen:** Nach dem Speichern geht ein Webhook an die Automationen (Header `X-NF-Secret`, Zeitlimit 5 s). Schlägt er fehl, bleibt die Buchung trotzdem bestehen. Der Fehler wird ohne personenbezogene Daten protokolliert. Ein Nachholen fehlgeschlagener Benachrichtigungen ist offen für Phase 4.
- **Rate-Limit pro IP:** Buchen 10/min, andere POST-Anfragen unter `/api/nf/` 20/min, alle `/api/nf/`-Anfragen 120/min. Fehler 429 und 413 kommen mit deutscher Meldung.
- **Mitarbeiter:** Dürfen nur das Feld `status` ändern. Das ist zusätzlich im Hook abgesichert, nicht nur über die Zugriffsregel. Die Höchstzahl an Mitarbeitern kommt aus `rollen.max_mitarbeiter`. Mindestens ein Inhaber bleibt immer bestehen.

## E-004 · 09.11.2026 · Datenmodell: Ergänzungen zu Abschnitt 4

Abschnitt 4 des Bauauftrags ist umgesetzt. Ergänzt wurde nur, was die Routen brauchen:

- **`einstellungen`** hat zusätzlich JSON-Felder für die Konfiguration, die die Routen zur Laufzeit lesen: `termintypen`, `status_liste`, `betrieb`, `module`, `formular`, `rollen`, `loeschfristen`, `nachrichten`, `rechtliches`, `mail_adapter`, `folgetermin_typ`. Die `hinweistexte` enthalten die Seitentexte in du- und Sie-Variante.
- **Tagesdaten als Text** `JJJJ-MM-TT` (`buchbar_ab`, `sperrtage.datum`, `gueltig_von` …). Das vermeidet Zeitzonen-Verschiebungen bei reinen Kalendertagen. Termine (`termin_start/ende`) sind echte Zeitstempel in UTC.
- **`angebote`:** zusätzlich `ressource` und `folgetermin` (siehe E-003).
- **`buchungen`:** zusätzlich `abgesagt_am` (Absage, siehe E-005) und `ressourcen`. Letzteres ist eine Momentaufnahme der belegten Ressourcen zum Zeitpunkt der Buchung, damit spätere Änderungen am Angebot alte Buchungen nicht verändern.
- **`kontakte`:** Nachfass-Zeitstempel als `nachfass_1_am` bis `nachfass_5_am` (höchstens 5 laut Schema).
- **Tokens** (`kontakte.token`, `buchungen.token_verwalten`) sind 40 Zeichen lang und **versteckt**: Nur der Server sieht sie, auch Inhaber und Mitarbeiter nicht über die API.
- **Fotos** sind geschützt: Abruf nur mit Datei-Token eines angemeldeten Nutzers. Erlaubt sind nur Bildformate. Die Grenzen pro Kunde kommen aus `formular.fotos`. Insgesamt sind höchstens 100 MB pro Buchung möglich, das wird schon bei der Konfigurationsprüfung kontrolliert.
- **Startwerte-Import** über einen eigenen Konsolenbefehl `nf-startwerte`. Der Import läuft nur einmal. Mit `ersetzen` wird neu importiert, aber nur solange es keine Buchungen gibt.

## E-003 · 09.11.2026 · Aufbau der Kundenkonfiguration

Der Bauauftrag legt die Dateien in `kunden/<kunde>/` fest, aber nicht jedes Feld. Festgelegt wurde in Phase 1:

- **Ressource am Angebot (und optional an der Zusatzoption), nicht am Termintyp.** Beispiel: Nur das Paket mit Einlagerung belegt einen Lagerplatz, obwohl beide Pakete denselben Termintyp „Abgabe“ nutzen. Im Datenmodell (Phase 2) bekommt `angebote` dafür ein Feld `ressource`.
- **Folgetermin-Berechtigung am Angebot** (`folgetermin: true`). Zeitraum und Termintyp des Folgetermins stehen in `termine.json → folgetermin`. Der Folgetermin-Typ kann nicht direkt gebucht werden.
- **Formular in `kunde.json → formular`:** Adresse und Telefon (Pflicht/optional/aus), Fotos (an/aus, Anzahl, MB) und Zusatzfelder. Jedes Zusatzfeld legt fest, ob es am Kontakt (z. B. Modell, Pferdename) oder an der Buchung gespeichert wird.
- **Mailversand getrennt nach Weg und Modus:** `adapter` = `graph` | `smtp` (Live-Versand), `modus` = `test` | `live`. Im Testmodus greift der Test-Adapter aus dem Bauauftrag (alles an `test_empfaenger`).
- **Regeln mit Wochentag-Liste** (`wochentage: [1,2,3,4,5]`, 1 = Montag) statt je eine Regel pro Tag. Der Import in Phase 2 legt daraus pro Wochentag einen Datensatz in `terminregeln` an.
- **Nachfass:** Anzahl = Länge von `nachfass.abstaende_tage` (z. B. `[7, 14]` = 2 Nachfass-Mails).
- **Seitentexte** in `texte/seiten.json` mit du- und Sie-Block. Die Prüfung verlangt in beiden Blöcken dieselben Schlüssel. Mail-Vorlagen kommen in Phase 4 dazu.
- **Branding als `branding.json`** (Farben, Schrift, Logo). Daraus wird `branding.css` mit CSS-Variablen erzeugt. Die Prüfung verlangt WCAG-AA-Kontrast (4,5:1) für Text, lokale WOFF2-Schriften oder Systemschrift und ein Logo ohne externe Inhalte.
- **Strikte Prüfung:** unbekannte Felder sind Fehler, damit Tippfehler (z. B. `buchnug`) auffallen.

## E-002 · 09.11.2026 · Werkzeuge für Prüfung, lokalen Start und Seiten

**Entscheidung:**
- Node.js (≥ 22.12, empfohlen laut `.nvmrc`) für Schema-Prüfung, lokalen Start und Tests. Abhängigkeiten exakt gepinnt (`ajv` 8.20.0, `ajv-formats` 3.0.1, `adm-zip` 0.6.1), `package-lock.json` im Repo, Tests mit dem eingebauten `node:test`.
- Seiten in reinem HTML/CSS/JavaScript ohne Bundler und ohne Framework. Falls Bibliotheken nötig werden, kommen sie als feste Dateien nach `kern/web/vendor/`.
- PocketBase v0.40.6: am 09.11.2026 geprüft, das ist die neueste Version. Version und SHA-256-Prüfsummen je Plattform stehen in `kern/pocketbase-version.json`. Die Programmdatei wird nur nach `.dev/` geladen und nie committet.

**Begründung:** Ein Befehl (`npm run dev`) funktioniert unter Windows, Linux und macOS gleich. Ohne Build-Schritt bleiben die Seiten klein und nachvollziehbar. Die Prüfsumme verhindert, dass eine veränderte Programmdatei unbemerkt läuft.

**Risiko:** Auf dem Server wird Node.js für die Konfigurationsprüfung gebraucht (Phase 7). Alternativ läuft die Prüfung vor dem Ausrollen lokal.

## E-001 · 09.11.2026 · PocketBase statt Postgres + eigenes Backend

**Entscheidung:** Als Datenbank und Backend dient PocketBase (eine Instanz pro Kunde, nur auf 127.0.0.1). Kein Postgres, kein selbst geschriebenes API-Backend.

**Begründung:** PocketBase bringt Authentifizierung, Rollen/Zugriffsregeln, Datei-Upload, Migrationen und eine REST-API bereits mit. Eigene Logik (Slots, Buchung in Transaktion, Webhooks) lässt sich über `pb_hooks` ergänzen. Das spart einen großen Teil der Bauzeit und hält den Betrieb schlank: eine Binärdatei + ein Datenordner pro Kunde, was auch die Mandantentrennung einfach macht.

**Risiko:** PocketBase ist noch vor v1.0; zwischen Versionen kann es Änderungen geben, die nicht rückwärtskompatibel sind (API, Hooks, Migrationen).

**Gegenmaßnahmen:** Version fest pinnen (Stand Bauauftrag: v0.40.6). Updates nur bewusst, einzeln, nach Lesen der Changelogs und nach Test auf der `_beispiel`-Instanz. Backup vor jedem Update.
