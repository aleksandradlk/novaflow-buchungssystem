#!/usr/bin/env bash
# Restores an instance from the restic repository (run as root on the server).
#
#   deploy/wiederherstellen.sh <instanz> --als <neue-instanz> [--snapshot <id>] [--domain <domain>]
#       restore test: separate instance on its own port; sends nothing (no automation address,
#       new secret); reachable only through an SSH tunnel unless --domain is given
#   deploy/wiederherstellen.sh <instanz> --ueberschreiben [--snapshot <id>]
#       emergency: replaces the data of the running instance; the current data is kept
#       as pb_data.vor-wiederherstellung-<zeit> until deleted by hand
#
# Without --snapshot the latest backup of <instanz> is used (list: restic snapshots --tag instanz:<instanz>).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

quelle="${1:-}"
[ -n "$quelle" ] && [[ "$quelle" != --* ]] || fehler "Aufruf: wiederherstellen.sh <instanz> (--als <neue-instanz> | --ueberschreiben) [--snapshot <id>] [--domain <domain>]"
shift
als="" ueberschreiben=0 snapshot="latest" domain=""
while [ $# -gt 0 ]; do
  case "$1" in
    --als) als="${2:?}"; shift 2 ;;
    --ueberschreiben) ueberschreiben=1; shift ;;
    --snapshot) snapshot="${2:?}"; shift 2 ;;
    --domain) domain="${2:?}"; shift 2 ;;
    *) fehler "Unbekannte Option „$1“." ;;
  esac
done
pruefe_name "$quelle"
[ -n "$als" ] || [ "$ueberschreiben" = 1 ] || fehler "Bitte --als <neue-instanz> (Test) oder --ueberschreiben (Notfall) angeben."
[ -z "$als" ] || [ "$ueberschreiben" = 0 ] || fehler "--als und --ueberschreiben schließen sich aus."
restic_vorbereiten

tmp="$(mktemp -d "$NF_SRV/.wiederherstellung.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
"$NF_RESTIC" restore "$snapshot" --host novaflow --tag "instanz:$quelle" --target "$tmp" --quiet >/dev/null ||
  fehler "Kein passendes Backup von „$quelle“ gefunden (Snapshot „$snapshot“)."
db="$(find "$tmp" -path "*/.sicherung/$quelle/data.db" | head -n 1)"
[ -n "$db" ] || fehler "Backup enthält keine Datenbank."
st="$(dirname "$db")"
storage="$(find "$tmp" -type d -path "*/pb_data/storage" -prune | head -n 1)"

daten_einsetzen() { # instance dir
  mkdir -p "$1/pb_data"
  cp "$db" "$1/pb_data/data.db"
  [ -z "$storage" ] || cp -a "$storage" "$1/pb_data/storage"
  eigentum "$1/pb_data"
}

if [ -n "$als" ]; then
  pruefe_name "$als"
  envd="$(env_datei "$als")"
  d="$(instanz_dir "$als")"
  [ ! -e "$envd" ] && [ ! -e "$d" ] || fehler "Instanz „$als“ gibt es schon."
  port="$(naechster_port)"
  install -m 600 "$st/instanz.env" "$envd"
  env_setzen "$envd" PB_PORT "$port"
  env_setzen "$envd" NF_WEBHOOK_URL ""
  env_setzen "$envd" NF_WEBHOOK_SECRET "$(zufall 32)"
  for k in SMTP_PASSWORD GRAPH_CLIENT_SECRET TELEGRAM_BOT_TOKEN; do env_setzen "$envd" "$k" ""; done
  env_setzen "$envd" NF_OEFFENTLICHE_URL "${domain:+https://$domain}"
  [ -n "$domain" ] || env_setzen "$envd" NF_OEFFENTLICHE_URL "http://127.0.0.1:$port"
  mkdir -p "$d"
  chmod 750 "$d"
  app_bauen "$(env_wert "$envd" NF_KUNDE)" "$d/app" >/dev/null || { rm -rf "$d" "$envd"; fehler "Bauen fehlgeschlagen."; }
  daten_einsetzen "$d"
  eigentum "$d"
  backend "$als" migrate up >/dev/null
  dienst enable "$als"
  smoke_test "$port" || fehler "Wiederhergestellte Instanz antwortet nicht (Port $port)."
  if [ -n "$domain" ]; then
    caddy_block_schreiben "$als" "$domain" "$port"
    caddy_neu_laden
  fi
  ok "Backup von „$quelle“ als Testinstanz „$als“ auf 127.0.0.1:$port wiederhergestellt"
  echo "  Stand: $(sed -n 's/.*"gebaut_am": "\(.*\)".*/\1/p' "$st/version.json") gebaut, Vorlage $(sed -n 's/.*"vorlage": "*\([^",]*\)"*,.*/\1/p' "$st/version.json")"
  echo "  Ansehen: ssh -L $port:127.0.0.1:$port <server>, dann http://127.0.0.1:$port/uebersicht/"
  echo "  Entfernen: deploy/kunde-entfernen.sh $als --wirklich-loeschen"
  exit 0
fi

envd="$(env_datei "$quelle")"
d="$(instanz_dir "$quelle")"
[ -f "$envd" ] && [ -d "$d/app" ] || fehler "Instanz „$quelle“ gibt es nicht – zum Neuaufbau zuerst deploy/neuer-kunde.sh, dann --ueberschreiben."
alt="$d/pb_data.vor-wiederherstellung-$(date +%Y%m%d-%H%M%S)"
dienst stop "$quelle"
mv "$d/pb_data" "$alt"
daten_einsetzen "$d"
backend "$quelle" migrate up >/dev/null
dienst start "$quelle"
smoke_test "$(env_wert "$envd" PB_PORT)" || fehler "Instanz antwortet nach der Wiederherstellung nicht. Alte Daten: $alt"
ok "„$quelle“ aus dem Backup wiederhergestellt"
echo "  Bisherige Daten liegen in $alt – nach der Prüfung löschen (rm -rf)."
