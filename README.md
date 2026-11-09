# NovaFlow Buchungssystem – Vorlage

Vorlage für ein Online-Buchungssystem für Dienstleister mit festen Terminen (Werkstatt, Reiterhof, Handwerksbetrieb …). Einmal gebaut, pro Kunde nur über `kunden/<kunde>/` konfiguriert. Jeder Kunde bekommt eine eigene Instanz mit eigener Datenbank und eigener Subdomain.

Verbindliche Regeln: [`CLAUDE.md`](CLAUDE.md) · Vollständiger Auftrag: [`docs/BAUAUFTRAG_VORLAGE.md`](docs/BAUAUFTRAG_VORLAGE.md) · Entscheidungen: [`docs/ENTSCHEIDUNGEN.md`](docs/ENTSCHEIDUNGEN.md)

> **Stand:** Phase 1 – Grundgerüst (Konfiguration, Schema-Prüfung, lokale Instanz). Die Module unten werden Phase für Phase gebaut.

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
  web/buchung/           öffentliche Seiten (ab Phase 3, jetzt Platzhalter)
  web/uebersicht/        Login-Bereich (ab Phase 5, jetzt Platzhalter)
  web/gemeinsam/         gemeinsames CSS
  pb_migrations/         Datenmodell (ab Phase 2)
  pb_hooks/              eigene Routen (ab Phase 2)
  n8n/                   Automations-Vorlagen (ab Phase 4)
  tools/                 Prüfung, lokaler Start, Tests
  pocketbase-version.json  gepinnte Backend-Version + SHA-256-Prüfsummen
kunden/
  _beispiel/             fiktiver „Musterbetrieb“ – Muster und Testkunde
deploy/                  Skripte für den Server (ab Phase 7)
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

Der Befehl prüft die Konfiguration, lädt beim ersten Mal die gepinnte Backend-Version herunter (mit SHA-256-Prüfung), baut die Seiten mit dem Branding des Kunden zusammen und startet alles nur auf `127.0.0.1`:

- Buchungsseite: http://127.0.0.1:8090/
- Übersicht: http://127.0.0.1:8090/uebersicht/
- Admin: http://127.0.0.1:8090/_/ – beim allerersten Start erscheint im Terminal ein Link zum Anlegen des Admin-Zugangs (oder Zugang über `.env` vorgeben, siehe `.env.example`)

Weitere Befehle:

| Befehl | Zweck |
|---|---|
| `npm run dev -- <kunde>` | anderen Kunden lokal starten |
| `npm run check` | alle Kundenkonfigurationen prüfen (`npm run check -- <kunde>` für einen) |
| `npm test` | automatisierte Tests |

Port und Admin-Zugang lassen sich über eine lokale `.env` setzen (Vorlage: `.env.example`). Lokale Daten liegen in `.dev/<kunde>/pb_data` – zum Zurücksetzen einfach den Ordner `.dev/<kunde>` löschen.

Hinter einem Firmen-Proxy braucht der erste Download zusätzlich die Umgebungsvariable `NODE_USE_ENV_PROXY=1`.

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
   | `branding/` | `branding.json` (Farben, Schrift), Logo, ggf. Schriftdateien (WOFF2) |

2. `npm run check -- <kunde>` – meldet Tippfehler, fehlende Felder, falsche Verweise (z. B. unbekannter Termintyp), Modul-Abhängigkeiten und zu geringen Farbkontrast.
3. Lokal ansehen: `npm run dev -- <kunde>`.
4. Instanz auf dem Server anlegen und ausrollen (`deploy/neuer-kunde.sh <kunde>`) – *folgt in Phase 7*.
5. Betriebsanleitung (`docs/BETRIEB.md`) – *folgt in Phase 7*.

Die JSON-Dateien sind Startwerte; nach dem Ausrollen pflegt der Inhaber Angebote, Terminregeln, Sperrtage und Kapazitäten in der Übersicht (ab Phase 5). Mit einem Editor wie VS Code helfen die `$schema`-Angaben in den Dateien beim Ausfüllen.

Echte Kundendaten (Kundenlisten, Fotos, Datenbanken, `.env`) gehören nie ins Repo – siehe `.gitignore`.
