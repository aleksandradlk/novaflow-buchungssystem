# Architektur-Entscheidungen

Logbuch aller grundlegenden Entscheidungen für die Vorlage. Neue Einträge oben anfügen. Jede Entscheidung mit Datum, Entscheidung, Begründung und – falls vorhanden – Risiken bzw. Gegenmaßnahmen.

| Datum | Entscheidung | Begründung |
|---|---|---|
| 09.11.2026 | PocketBase statt Postgres + eigenes Backend | siehe E-001 |

---

## E-001 · 09.11.2026 · PocketBase statt Postgres + eigenes Backend

**Entscheidung:** Als Datenbank und Backend dient PocketBase (eine Instanz pro Kunde, nur auf 127.0.0.1). Kein Postgres, kein selbst geschriebenes API-Backend.

**Begründung:** PocketBase bringt Authentifizierung, Rollen/Zugriffsregeln, Datei-Upload, Migrationen und eine REST-API bereits mit. Eigene Logik (Slots, Buchung in Transaktion, Webhooks) lässt sich über `pb_hooks` ergänzen. Das spart einen großen Teil der Bauzeit und hält den Betrieb schlank: eine Binärdatei + ein Datenordner pro Kunde, was auch die Mandantentrennung einfach macht.

**Risiko:** PocketBase ist noch vor v1.0; zwischen Versionen kann es Änderungen geben, die nicht rückwärtskompatibel sind (API, Hooks, Migrationen).

**Gegenmaßnahmen:** Version fest pinnen (Stand Bauauftrag: v0.40.6). Updates nur bewusst, einzeln, nach Lesen der Changelogs und nach Test auf der `_beispiel`-Instanz. Backup vor jedem Update.
