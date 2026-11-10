# Betrieb – NovaFlow Buchungssystem

Anleitung für den NovaFlow-VPS (Hostinger, Deutschland, Ubuntu 24.04). Alle Befehle als `root` auf dem Server, aus `/opt/novaflow/vorlage`. Jeder Kunde bekommt eine **eigene Instanz** (eigener Dienst, eigener Port auf 127.0.0.1, eigene Datenbank, eigene Subdomain).

| Was | Wo |
|---|---|
| Vorlage (dieses Repo) | `/opt/novaflow/vorlage` |
| Instanz: Programm + Seiten (nur lesbar für den Dienst) | `/srv/novaflow/<instanz>/app` |
| Instanz: Datenbank + Fotos | `/srv/novaflow/<instanz>/pb_data` |
| Instanz: Secrets (root, Rechte 600) | `/etc/novaflow/<instanz>.env` |
| Backup- und Melde-Einstellungen (root, 600) | `/etc/novaflow/betrieb.env` |
| Webserver-Block je Instanz | `/etc/caddy/novaflow/<instanz>.caddy` |
| Dienst | `novaflow@<instanz>` (Log: `journalctl -u novaflow@<instanz>`) |
| Backup | täglich 02:30 (`novaflow-backup.timer`), restic, 30 Tage täglich + 3 Monate monatlich |

Inhalt:
1. Server einmalig einrichten
2. Neuen Kunden anlegen
3. Automationen einrichten
4. Live schalten
5. Werte ändern
6. Neuen Stand ausrollen
7. Export für den Kunden
8. Backup und Wiederherstellung (inkl. Wiederherstellungstest)
9. Daten löschen nach Vertragsende
10. Admin-Zugang (nur per SSH-Tunnel)
11. Störungen
12. Erstes Ausrollen: `_beispiel` unter `demo.novaflowservices.de`

---

## 1. Server einmalig einrichten

Voraussetzungen: Caddy und n8n laufen bereits. Zusätzlich nötig: **Node.js ≥ 22.12** (empfohlen 24, dieselbe Version wie n8n), `python3`, `git`, `curl`, `openssl` (bei Ubuntu 24.04 bis auf Node vorhanden).

```bash
node --version
```

```bash
git clone https://github.com/aleksandradlk/novaflow-buchungssystem.git /opt/novaflow/vorlage
```

```bash
/opt/novaflow/vorlage/deploy/server-einrichten.sh
```

Das Skript:
- legt den Dienstbenutzer `novaflow` und die Ordner mit den richtigen Rechten an;
- installiert restic in der gepinnten Version mit Prüfsumme (`deploy/versionen.sh`);
- richtet die systemd-Dienste und den Backup-Zeitplan ein;
- legt `/etc/novaflow/betrieb.env` an und erzeugt das Backup-Passwort;
- ergänzt im Caddyfile die Zeile `import /etc/caddy/novaflow/*.caddy`. Die alte Fassung bleibt als `Caddyfile.vor-novaflow` erhalten.

Es kann gefahrlos wiederholt werden.

**Danach unbedingt:**
1. Das angezeigte **Backup-Passwort im Passwortmanager speichern.** Ohne dieses Passwort ist kein Backup mehr lesbar.
2. `/etc/novaflow/betrieb.env` prüfen:
   - `RESTIC_REPOSITORY`: Ablageort der Backups. Voreingestellt ist `/var/backups/novaflow` auf demselben Server. Das schützt vor Bedienfehlern, aber nicht vor einem Ausfall des Servers. Besser ist NovaFlow-eigener Speicher bei Hostinger, z. B. `sftp:benutzer@speicher:/novaflow`. Nach einer Änderung `server-einrichten.sh` erneut ausführen, das legt das Repository an.
   - `NF_N8N_WEBHOOK_BASIS`: Adresse der Automationen, vom Server aus gesehen (Standard `http://127.0.0.1:5678/webhook`).
   - `NF_ADMIN_EMAIL`: optional. Mit dieser Adresse bekommt jede neue Instanz einen Admin-Zugang, siehe Abschnitt 10.
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: Meldungen bei ausgefallenen Diensten, fehlgeschlagenen Backups und fehlgeschlagenem Ausrollen. Sie enthalten keine personenbezogenen Daten.

## 2. Neuen Kunden anlegen

Die Konfiguration `kunden/<kunde>/` ist im Repo vorbereitet und geprüft (`npm run check -- <kunde>`, siehe README). Auf dem Server:

```bash
cd /opt/novaflow/vorlage && git pull --ff-only
```

```bash
deploy/neuer-kunde.sh <kunde> --inhaber inhaber@kunde.de
```

Optionen:
- `--name <instanz>`: anderer Instanzname, z. B. `demo`.
- `--domain <domain>`: abweichende Adresse. Standard ist `domain` aus `kunde.json`.
- `--port <port>`: fester Port. Standard ist der nächste freie Port ab 8100.

Das Skript:
1. prüft die Konfiguration;
2. vergibt den Port;
3. legt `/etc/novaflow/<instanz>.env` an (Rechte 600, neues Webhook-Secret);
4. baut die Instanz und spielt Datenbankschema und Startwerte ein;
5. legt die Zugänge an;
6. startet den Dienst;
7. prüft, ob die Instanz antwortet;
8. legt den Webserver-Block an;
9. erzeugt die Import-Dateien für die Automationen.

**Passwörter werden nur einmal angezeigt.** Das Inhaber-Passwort dem Kunden auf sicherem Weg geben (nicht per Mail zusammen mit der Adresse). Beim ersten Login kommt zusätzlich ein Code per Mail. Das funktioniert erst, wenn die Automationen eingerichtet sind (Abschnitt 3).

Weitere Zugänge (Mitarbeiter) legt der Inhaber in der Übersicht an. Ein Passwort neu setzen:

```bash
cd /srv/novaflow/<instanz> && runuser -u novaflow -- app/pocketbase nf-benutzer <email> <inhaber|mitarbeiter> --dir=pb_data --hooksDir=app/pb_hooks --migrationsDir=app/pb_migrations
```

**DNS:** Die Subdomain des Kunden (A-Record bzw. AAAA-Record) muss auf den VPS zeigen. Caddy holt das Zertifikat selbst, sobald der Name auflöst.

## 3. Automationen einrichten

1. Den Mail-Zugang des Kunden in `/etc/novaflow/<instanz>.env` eintragen:
   - `SMTP_*` oder `GRAPH_*`, je nach `adapter` in `nachrichten.json`;
   - optional `TELEGRAM_*`.

   Werte ohne Anführungszeichen, eine Zeile je Wert. Der Editor behält die Rechte 600 bei; prüfen mit `ls -l /etc/novaflow`.
2. Import-Dateien erzeugen:

   ```bash
   deploy/automationen.sh <instanz>
   ```

   Das schreibt `/srv/novaflow/<instanz>/n8n/workflows.json` und `credentials.json`. Die zweite Datei enthält Secrets.
3. In n8n importieren, in dieser Reihenfolge (erprobt mit n8n 2.46.7). Die genauen Befehle mit den Workflow-IDs gibt Schritt 2 aus:
   1. `n8n import:credentials --input=…/credentials.json`
   2. `n8n import:workflow --input=…/workflows.json`
   3. je Workflow `n8n publish:workflow --id=…`
   4. n8n neu starten.

   Läuft n8n in Docker, die Dateien vorher mit `docker cp` in den Container kopieren und die Befehle mit `docker exec <container> …` ausführen.
4. **`credentials.json` danach löschen**:

   ```bash
   rm /srv/novaflow/<instanz>/n8n/credentials.json
   ```

5. Prüfen: Testbuchung auf der Buchungsseite. Die Bestätigung geht im Testmodus an `test_empfaenger` (Abschnitt 4).

Wichtig: Die Automationen rufen die Instanz direkt unter `http://127.0.0.1:<port>` auf. Läuft n8n in Docker, braucht der Container dafür `network_mode: host`, sonst ist 127.0.0.1 der Container selbst.

## 4. Live schalten

Vor dem Livegang:
- Testbuchung, Verschieben, Absagen, Statuswechsel und Login mit Code durchspielen. Im Testmodus gehen alle Mails an `test_empfaenger`.
- Impressum- und Datenschutz-Link prüfen (`rechtliches.json`).
- Ein Backup und einen Wiederherstellungstest machen (Abschnitt 8).

Dann in der Übersicht unter **Verwaltung** den Mail-Modus von **Test** auf **Live** stellen. Ab dann gehen Mails an die echten Empfänger.

## 5. Werte ändern

- **Im Alltag** (Angebote, Preise, Terminregeln, Sperrtage, Kapazitäten, Mail-Modus): der Inhaber in der Übersicht unter **Verwaltung**, ohne Server-Arbeit.
- **Texte, Farben, Logo, Module, Statusliste:**
  1. `kunden/<kunde>/` im Repo ändern;
  2. `npm run check -- <kunde>` ausführen;
  3. committen und pushen;
  4. auf dem Server ausrollen (Abschnitt 6).

  Seiten und Branding sind danach sofort aktuell.
- **Startwerte komplett neu einlesen** (Angebote, Regeln usw. aus den JSON-Dateien): `deploy/ausrollen.sh <instanz> --startwerte-neu`. Das geht nur, solange es **keine Buchungen** gibt, also vor dem Livegang. Danach pflegt der Inhaber die Werte in der Übersicht.
- **Secrets und Mail-Zugang:** `/etc/novaflow/<instanz>.env` bearbeiten. Dann `systemctl restart novaflow@<instanz>` ausführen, bei Mail-Zugang zusätzlich Abschnitt 3 ab Schritt 2.

## 6. Neuen Stand ausrollen

```bash
deploy/ausrollen.sh <instanz>
```

```bash
deploy/ausrollen.sh --alle
```

Ablauf je Instanz:
1. `git pull` der Vorlage;
2. neue Dateien neben den laufenden bauen;
3. Dienst stoppen;
4. Datenbank sichern;
5. Dateien tauschen;
6. Datenbankschema aktualisieren;
7. Dienst starten;
8. Prüfung: die Seiten **und** die eigenen Schnittstellen antworten.

**Schlägt etwas fehl**, wird automatisch der vorherige Stand mit der Datenbank-Kopie zurückgelegt und gestartet. Es kommt eine Meldung, und der fehlerhafte Stand liegt zur Analyse in `app.fehlgeschlagen`. Der vorherige erfolgreiche Stand bleibt als `app.vorher` liegen.

Die Ausfallzeit beträgt wenige Sekunden pro Instanz. Am besten abends ausrollen, nicht während eines Kampagnenversands.

## 7. Export für den Kunden

Der Inhaber exportiert selbst: Übersicht → **Verwaltung** → **Export** → „Alle Daten exportieren“. Das ergibt eine ZIP-Datei mit allen Kontakten, Buchungen, Nachrichten und Einwilligungen als CSV.

Auf Anfrage einer betroffenen Person (Auskunft nach Art. 15 DSGVO) dieselben Daten aus dem Export herausfiltern.

## 8. Backup und Wiederherstellung

**Automatisch:** täglich um 02:30 werden alle Instanzen gesichert. Gesichert wird:
- eine konsistente Kopie der Datenbank im laufenden Betrieb;
- die Fotos;
- die Umgebungsdatei;
- der Versionsstand.

Das Repository ist verschlüsselt. Aufbewahrt werden 30 Tage täglich und 3 Monate monatlich. Protokolle mit IP-Adressen werden nicht gesichert. Ein Fehler wird gemeldet.

| Aufgabe | Befehl |
|---|---|
| Von Hand sichern | `deploy/backup.sh <instanz>` |
| Stand ansehen | `systemctl list-timers novaflow-backup.timer` |
| Backups einer Instanz | `deploy/backup.sh` liest `/etc/novaflow/betrieb.env`; Liste: `set -a; . /etc/novaflow/betrieb.env; /opt/novaflow/bin/restic snapshots --tag instanz:<instanz>` |
| Repository prüfen (monatlich) | wie oben, dann `/opt/novaflow/bin/restic check` |

**Wiederherstellungstest** (vor dem Livegang und danach vierteljährlich):

```bash
deploy/wiederherstellen.sh <instanz> --als <instanz>-test
```

Das legt eine **Testinstanz** auf einem eigenen Port an, mit den Daten des letzten Backups. Ein älteres Backup geht mit `--snapshot <id>`. Die Testinstanz verschickt nichts: Sie hat keine Automationen-Adresse, ein neues Secret und keine Mail-Passwörter. Sie ist nur per SSH-Tunnel erreichbar:

```bash
ssh -L <port>:127.0.0.1:<port> root@<server>
```

Dann im Browser `http://127.0.0.1:<port>/uebersicht/` öffnen und prüfen: letzte Buchungen da? Fotos da? Danach entfernen:

```bash
deploy/kunde-entfernen.sh <instanz>-test --wirklich-loeschen
```

Datum und Ergebnis jedes Tests notieren.

**Notfall** (Daten der laufenden Instanz ersetzen):

```bash
deploy/wiederherstellen.sh <instanz> --ueberschreiben
```

Die bisherigen Daten bleiben in `pb_data.vor-wiederherstellung-<zeit>` liegen und werden nach der Prüfung von Hand gelöscht.

**Server verloren:**
1. Neuen Server nach Abschnitt 1 einrichten, mit demselben `RESTIC_REPOSITORY` und dem Backup-Passwort aus dem Passwortmanager.
2. Je Instanz `deploy/neuer-kunde.sh <kunde> --name <instanz>` ausführen.
3. Dann `deploy/wiederherstellen.sh <instanz> --ueberschreiben`.
4. Die Umgebungsdatei aus dem Backup liegt im Snapshot als `instanz.env`. Mail-Zugang und Secret daraus übernehmen.

## 9. Daten löschen nach Vertragsende

1. Kunden um den Export bitten oder ihn selbst erstellen (Abschnitt 7) und sicher übergeben.
2. Instanz löschen: Dienst, Webserver-Block, Datenbank, Fotos und Umgebung.

   ```bash
   deploy/kunde-entfernen.sh <instanz> --wirklich-loeschen
   ```

   Mit `--backups-loeschen` werden zusätzlich sofort alle Backups dieser Instanz gelöscht. Ohne diese Option laufen sie nach der Aufbewahrungsfrist aus (spätestens nach 3 Monaten). Was vertraglich vereinbart ist, entscheidet.
3. In n8n die Workflows „NF <kennung> · …“ und die Zugangsdaten des Kunden löschen. Das Skript erinnert daran.
4. DNS-Eintrag beim Kunden entfernen lassen.
5. Löschung mit Datum dokumentieren.

Laufende Löschfristen (Fotos, abgeschlossene Buchungen, nie gebuchte Kontakte, Mail-Inhalte) setzt die Instanz jede Nacht selbst um (Workflow „loeschung“, Fristen in `kunde.json`).

## 10. Admin-Zugang (nur per SSH-Tunnel)

Die Admin-Oberfläche (`/_/`) und alle internen Schnittstellen sind von außen gesperrt (Antwort 404). Zugriff gibt es nur über einen SSH-Tunnel:

```bash
ssh -L <port>:127.0.0.1:<port> root@<server>
```

Dann `http://127.0.0.1:<port>/_/` öffnen. Die Anmeldung braucht zwei Faktoren: Passwort und einen Code per Mail. Der Code läuft über den Mailversand der Instanz, also erst nach Abschnitt 3.

Admin-Zugang anlegen oder Passwort neu setzen (das Passwort steht danach im Shell-Verlauf, also zufällig erzeugen):

```bash
cd /srv/novaflow/<instanz> && runuser -u novaflow -- app/pocketbase superuser upsert <email> "$(openssl rand -hex 16)" --dir=pb_data --hooksDir=app/pb_hooks --migrationsDir=app/pb_migrations
```

Der Admin-Zugang wird nur für Ausnahmen gebraucht. Alles Alltägliche läuft über die Übersicht. Änderungen am Datenmodell nie in der Admin-Oberfläche machen, sondern als Migration im Repo.

## 11. Störungen

| Symptom | Prüfen |
|---|---|
| Seite nicht erreichbar | `systemctl status novaflow@<instanz>`, `journalctl -u novaflow@<instanz> -n 100`, `systemctl status caddy` |
| Zertifikat fehlt | DNS zeigt auf den VPS? `journalctl -u caddy -n 100` |
| Keine Mails | Mail-Modus Test/Live? Ausführungen in n8n; Übersicht → Verwaltung zeigt fehlgeschlagene Nachrichten; `nachholen` versucht es alle 15 Minuten erneut (bis 5×) |
| Login-Code kommt nicht | wie „Keine Mails“; Workflow „anmeldung“ aktiv? |
| Backup-Meldung | `journalctl -u novaflow-backup -n 100`; Speicherplatz (`df -h`) |
| Dienst ausgefallen (Meldung) | wird automatisch neu gestartet (bis 5× in 5 Min.); Log wie oben |

## 12. Erstes Ausrollen: `_beispiel` unter `demo.novaflowservices.de`

Abnahme von Phase 7. Die Schritte wurden lokal mit Caddy 2.11.9 und restic 0.19.1 in der Generalprobe durchgespielt (`kern/tools/test/deploy.test.mjs`). Auf dem VPS:

1. DNS: `demo.novaflowservices.de` → IP des VPS.
2. Abschnitt 1 (Server einrichten), Backup-Passwort sichern.
3. Instanz anlegen:

   ```bash
   deploy/neuer-kunde.sh _beispiel --name demo --domain demo.novaflowservices.de --inhaber <deine-adresse>
   ```

4. Prüfen **von außen**, z. B. vom eigenen Rechner:

   ```bash
   curl -sI https://demo.novaflowservices.de/
   ```

   Es darf kein `server:`-Header kommen. Erwartet werden `strict-transport-security`, `content-security-policy`, `x-content-type-options: nosniff` und `referrer-policy: no-referrer`.

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://demo.novaflowservices.de/_/
   ```

   Erwartet: `404`.

   ```bash
   curl -sI http://demo.novaflowservices.de/
   ```

   Erwartet: `308` auf https, ohne `server:`-Header.

   Seite im Browser öffnen, Testbuchung machen, Übersicht ansehen. In Seitentiteln, Mails und Fehlermeldungen darf kein Tool-Name stehen.
5. Automationen (Abschnitt 3) mit einem Test-Mailzugang. Bestätigungsmail prüfen: Absender des Musterbetriebs, kein Tool-Name.
6. Backup und Wiederherstellung:

   ```bash
   deploy/backup.sh demo
   ```

   ```bash
   deploy/wiederherstellen.sh demo --als demo-test
   ```

   Per Tunnel prüfen, ob die Testbuchung da ist, dann `deploy/kunde-entfernen.sh demo-test --wirklich-loeschen`.
7. Ergebnisse (Datum, Ausgaben) festhalten.

---

**Lokale Generalprobe** (ohne Server; prüft alle Skripte mit echtem Caddy und restic, Port, Header, Sperren, Browser-CSP, Backup, Wiederherstellung, Ausrollen mit Rollback, Entfernen):

```bash
NF_TEST_CADDY=/pfad/caddy NF_TEST_RESTIC=/pfad/restic npm test
```

Unterschiede zum Server:
- kein systemd; Dienste laufen als Hintergrundprozesse (`NF_OHNE_SYSTEMD=1`);
- kein eigener Dienstbenutzer;
- alle Pfade liegen in einem temporären Ordner;
- Zertifikat von einer lokalen Test-CA.

Die systemd-Einheiten werden mit `systemd-analyze verify` geprüft (`betrieb.test.mjs`).
