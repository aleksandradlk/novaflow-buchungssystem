#!/usr/bin/env bash
# Removes an instance with all its data (contract end or a restore test instance).
# Export first: overview → Verwaltung → Export → „Alle Daten exportieren“.
#
#   deploy/kunde-entfernen.sh <instanz> --wirklich-loeschen [--backups-loeschen]
#
#   --backups-loeschen  also deletes every backup of this instance (otherwise they expire
#                       after the retention period: 30 days daily, 3 months monthly)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

name="${1:-}" sicher=0 backups=0
shift || true
for a in "$@"; do
  case "$a" in
    --wirklich-loeschen) sicher=1 ;;
    --backups-loeschen) backups=1 ;;
    *) fehler "Unbekannte Option „$a“." ;;
  esac
done
[ -n "$name" ] && [ "$sicher" = 1 ] || fehler "Aufruf: kunde-entfernen.sh <instanz> --wirklich-loeschen [--backups-loeschen]"
pruefe_name "$name"
[ "$name" != betrieb ] || fehler "„betrieb“ ist keine Instanz."
envd="$(env_datei "$name")"
d="$(instanz_dir "$name")"
[ -e "$envd" ] || [ -e "$d" ] || fehler "Instanz „$name“ gibt es nicht."
kennung="" webhook=""
if [ -f "$envd" ]; then
  kennung="$(env_wert "$envd" NF_KUNDE)"
  webhook="$(env_wert "$envd" NF_WEBHOOK_URL)"
fi

dienst disable "$name"
if [ -e "$NF_CADDY_DIR/$name.caddy" ]; then
  rm -f "$NF_CADDY_DIR/$name.caddy"
  caddy_neu_laden
fi
rm -rf "$d" "$envd"
ok "Instanz „$name“ gelöscht (Dienst, Webserver-Block, Daten, Umgebung)"

if [ "$backups" = 1 ]; then
  restic_vorbereiten
  ids="$("$NF_RESTIC" snapshots --host novaflow --tag "instanz:$name" --json |
    python3 -I -c 'import json,sys; print(" ".join(s["short_id"] for s in json.load(sys.stdin)))')"
  if [ -n "$ids" ]; then
    # shellcheck disable=SC2086
    "$NF_RESTIC" forget --quiet $ids >/dev/null
    "$NF_RESTIC" prune --quiet >/dev/null
  fi
  ok "Backups von „$name“ gelöscht"
fi
if [ -n "$webhook" ]; then
  echo "  Automationen: Workflows „NF $kennung · …“ in der Automationen-Oberfläche deaktivieren"
  echo "  und löschen, ebenso die Zugangsdaten dieses Kunden."
fi
