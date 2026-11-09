# NovaFlow Buchungssystem – Vorlage

Vorlage für ein Online-Buchungssystem für Dienstleister mit festen Terminen (Werkstatt, Reiterhof, Handwerksbetrieb …). Einmal gebaut, pro Kunde nur über `kunden/<kunde>/` konfiguriert. Jeder Kunde bekommt eine eigene Instanz mit eigener Datenbank und eigener Subdomain.

Verbindliche Regeln: [`CLAUDE.md`](CLAUDE.md) · Vollständiger Auftrag: [`docs/BAUAUFTRAG_VORLAGE.md`](docs/BAUAUFTRAG_VORLAGE.md) · Entscheidungen: [`docs/ENTSCHEIDUNGEN.md`](docs/ENTSCHEIDUNGEN.md)

> **Stand:** Phase 0 – Grundstruktur. Die Bausteine unten sind geplant und werden Phase für Phase gebaut.

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
kern/        Buchungsseite, Übersicht, pb_migrations, pb_hooks, n8n-Vorlagen, Mail-Vorlagen-Engine
kunden/      ein Ordner pro Kunde (Konfiguration, Texte, Branding)
  _beispiel/ fiktiver „Musterbetrieb“ als Muster und Testkunde
deploy/      Skripte: neue Kundeninstanz anlegen, ausrollen, Backup, Wiederherstellung
docs/        Bauauftrag, Entscheidungen, Betriebsanleitung
```

## Lokal starten

*Folgt in Phase 1* (lokales Dev-Setup unter Windows und Linux, Start mit einem Befehl).

## Neuen Kunden anlegen

1. `kunden/_beispiel/` nach `kunden/<kunde>/` kopieren und Konfiguration, Texte und Branding anpassen – *Aufbau der Konfiguration und Schema-Prüfung folgen in Phase 1*.
2. Instanz auf dem Server anlegen und ausrollen (`deploy/neuer-kunde.sh <kunde>`) – *folgt in Phase 7*.
3. Betriebsanleitung (`docs/BETRIEB.md`) – *folgt in Phase 7*.

Echte Kundendaten (Kundenlisten, Fotos, Datenbanken, `.env`) gehören nie ins Repo – siehe `.gitignore`.
