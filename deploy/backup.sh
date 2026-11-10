#!/usr/bin/env bash
# Backs up one or all instances into the restic repository (run as root; daily via
# novaflow-backup.timer). Settings: /etc/novaflow/betrieb.env (RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE).
#
#   deploy/backup.sh <instanz> | --alle
#
# Per instance: consistent database copy (online backup, service keeps running) + uploads +
# environment file + version.json, tagged "instanz:<name>". Retention: 30 daily + 3 monthly.
# The repository is encrypted; without the password file the backups cannot be read.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ziel="${1:-}"
[ -n "$ziel" ] || fehler "Aufruf: backup.sh <instanz> | --alle"
restic_vorbereiten

sichern() {
  local name="$1" d envd st pfade
  pruefe_name "$name"
  d="$(instanz_dir "$name")"
  envd="$(env_datei "$name")"
  [ -f "$envd" ] && [ -f "$d/pb_data/data.db" ] || { echo "✘ Instanz „$name“ gibt es nicht." >&2; return 1; }

  st="$NF_SRV/.sicherung/$name"
  rm -rf "$st"
  mkdir -p "$st"
  chmod 700 "$NF_SRV/.sicherung"
  db_sichern "$d/pb_data/data.db" "$st/data.db"
  cp "$envd" "$st/instanz.env"
  cp "$d/app/version.json" "$st/version.json"
  pfade=("$st")
  [ -d "$d/pb_data/storage" ] && pfade+=("$d/pb_data/storage")

  "$NF_RESTIC" backup --quiet --host novaflow --tag "instanz:$name" "${pfade[@]}"
  "$NF_RESTIC" forget --quiet --host novaflow --tag "instanz:$name" --group-by tags \
    --keep-daily 30 --keep-monthly 3 >/dev/null
  rm -rf "$st"
  ok "$name gesichert"
}

fehlgeschlagen=()
if [ "$ziel" = "--alle" ]; then
  for f in "$NF_ETC"/*.env; do
    [ -e "$f" ] || continue
    n="$(basename "$f" .env)"
    [ "$n" = betrieb ] && continue
    sichern "$n" || fehlgeschlagen+=("$n")
  done
else
  sichern "$ziel" || fehlgeschlagen+=("$ziel")
fi
"$NF_RESTIC" prune --quiet >/dev/null || fehlgeschlagen+=("(Aufräumen)")

if [ ${#fehlgeschlagen[@]} -gt 0 ]; then
  melden "Backup fehlgeschlagen: ${fehlgeschlagen[*]}"
  fehler "Backup fehlgeschlagen: ${fehlgeschlagen[*]}"
fi
