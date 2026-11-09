# Architektur-Entscheidungen

Logbuch aller grundlegenden Entscheidungen für die Vorlage. Neue Einträge oben anfügen. Jede Entscheidung mit Datum, Entscheidung, Begründung und – falls vorhanden – Risiken bzw. Gegenmaßnahmen.

| Datum | Entscheidung | Begründung |
|---|---|---|
| 09.11.2026 | Aufbau der Kundenkonfiguration (Details, die der Bauauftrag offen lässt) | siehe E-003 |
| 09.11.2026 | Werkzeuge: Node.js für Prüfung/Start, Seiten ohne Build-Schritt, PocketBase v0.40.6 | siehe E-002 |
| 09.11.2026 | PocketBase statt Postgres + eigenes Backend | siehe E-001 |

---

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
