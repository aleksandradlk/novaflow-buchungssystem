# CLAUDE.md – NovaFlow Buchungssystem

Dieses Repo ist die **Vorlage** für das NovaFlow-Buchungssystem: einmal gebaut, pro Kunde nur konfiguriert. Erster Kunde wird LOHBOTIC (Mähroboter-Service), danach Reiterhöfe und weitere Betriebe.

Sprache im Repo: Code, Variablen und Commits auf Englisch; alles, was Kunden oder Endkunden sehen (Seiten, Mails, Fehlermeldungen), auf Deutsch.

## Arbeitsweise
- Arbeite `docs/BAUAUFTRAG_VORLAGE.md` Phase für Phase ab. Nach jeder Phase: Zusammenfassung, Abnahmekriterien prüfen, **auf Aleksandras Okay warten**.
- Frag nach, statt zu raten. Keine Funktion bauen, die nicht im Bauauftrag steht.
- Kleine, nachvollziehbare Commits. Keine Secrets, keine Kundendaten committen.

## Harte Regeln (gelten immer)
1. **Kern vs. Kunde:** Alles Branchenspezifische (Pakete, Texte, Farben, Logo, Termintypen, Statusnamen, Kapazitäten) kommt aus `kunden/<kunde>/`. Im `kern/` steht nichts Kundenspezifisches, keine Kundennamen, keine Branchenbegriffe.
2. **Keine Tool-Namen nach außen:** Kunden und Endkunden sehen nie „n8n“, „PocketBase“, „Caddy“ o. Ä. – nicht in URLs, Seitentiteln, Mails, Fehlermeldungen, HTTP-Headern (`Server`-Header entfernen). Nach außen gibt es nur die Kunden-Domain und neutrale NovaFlow-Adressen (`app.novaflowservices.de`).
3. **Datenschutz (DSGVO):**
   - Hosting nur auf dem NovaFlow-VPS in Deutschland. Keine externen Dienste, die Kundendaten sehen (kein CDN, keine Google Fonts, keine Analytics, keine externen Backups ohne ausdrückliche Freigabe).
   - Öffentliche Buchungsseite ohne Cookies, ohne `localStorage`, ohne Tracking, Schriften lokal.
   - Einwilligungen (z. B. E-Mail / WhatsApp) getrennt, nicht vorausgewählt, mit Datum und Quelle gespeichert.
   - Werbliche Mails (Kampagne, Nachfass) nur mit Einwilligung und mit Abmeldelink. Transaktionsmails (Bestätigung, Erinnerung, Status) an alle, die gebucht haben.
   - Löschfristen pro Kunde konfigurierbar (z. B. Fotos X Monate nach Abschluss), automatisch umgesetzt.
   - CSV-Export aller Daten eines Kunden möglich.
   - Admin-Zugänge mit Zwei-Faktor, Rollen nach geringster Berechtigung.
4. **Secrets** nur in `.env`-Dateien auf dem Server (Rechte 600), nie im Repo. `.env.example` mit Platzhaltern ist erlaubt.
5. **Nie ins Repo:** `pb_data/`, Uploads/Fotos, Kundenlisten (`*.csv`, `*.xlsx`), Backups, Verträge, `.env`.
6. **Mandantentrennung:** Jeder Kunde hat eine eigene Instanz (eigene Datenbank, eigene Daten, eigene Subdomain). Keine Daten verschiedener Kunden in einer Datenbank.
7. **Versionen pinnen:** PocketBase und alle Abhängigkeiten auf feste Versionen; Updates nur bewusst und nach Test.

## Stack
- Server: Hostinger VPS (Deutschland), Ubuntu 24.04, Caddy (TLS), n8n (bereits installiert)
- Datenbank/Backend: PocketBase (gepinnt), eine Instanz pro Kunde, nur auf 127.0.0.1
- Seiten: schlankes HTML/CSS/JavaScript, Abhängigkeiten lokal gebündelt, mobil zuerst
- Automationen: n8n-Workflows als exportierte JSON-Vorlagen im Repo (`kern/n8n/`), pro Kunde importiert
- Mailversand: Adapter `graph` (Microsoft 365 über App-Freigabe), `smtp`, `test`

## Ordner
```
kern/        Buchungsseite, Übersicht, pb_migrations, pb_hooks, n8n-Vorlagen, Mail-Vorlagen-Engine
kunden/      ein Ordner pro Kunde (Konfiguration, Texte, Branding) – kunden/_beispiel als Muster
deploy/      Skripte: neue Kundeninstanz anlegen, ausrollen, Backup, Wiederherstellung
docs/        Bauauftrag, Entscheidungen, Betriebsanleitung
```

