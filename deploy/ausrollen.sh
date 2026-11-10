#!/usr/bin/env bash
# Rolls out the current template to one or all instances (run as root on the server).
#
#   deploy/ausrollen.sh <instanz> | --alle [--ohne-git] [--startwerte-neu]
#
#   --ohne-git        do not pull the template first (e.g. after a manual checkout)
#   --startwerte-neu  replace the start values from kunden/<kunde>/ (only while there are no bookings)
#
# Per instance: build new files next to the running ones → stop → database copy →
# swap → migrations → start → smoke test. If anything fails, the previous files and the
# database copy are put back and the instance is started again (automatic rollback).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ziel="" git=1 startwerte_neu=0
for a in "$@"; do
  case "$a" in
    --alle) ziel="--alle" ;;
    --ohne-git) git=0 ;;
    --startwerte-neu) startwerte_neu=1 ;;
    --*) fehler "Unbekannte Option „$a“." ;;
    *) ziel="$a" ;;
  esac
done
[ -n "$ziel" ] || fehler "Aufruf: ausrollen.sh <instanz> | --alle [--ohne-git] [--startwerte-neu]"

if [ "$git" = 1 ]; then
  vorher="$(git -C "$NF_VORLAGE" rev-parse HEAD)"
  git -C "$NF_VORLAGE" pull --ff-only --quiet
  nachher="$(git -C "$NF_VORLAGE" rev-parse HEAD)"
  if [ "$vorher" != "$nachher" ] && ! git -C "$NF_VORLAGE" diff --quiet "$vorher" "$nachher" -- package-lock.json; then
    (cd "$NF_VORLAGE" && npm ci --omit=dev --no-audit --no-fund --silent)
  fi
  ok "Vorlage auf Stand $(git -C "$NF_VORLAGE" rev-parse --short=12 HEAD)"
fi

ausrollen() {
  local name="$1" envd d port kunde
  pruefe_name "$name"
  envd="$(env_datei "$name")"
  d="$(instanz_dir "$name")"
  [ -f "$envd" ] && [ -d "$d/app" ] || fehler "Instanz „$name“ gibt es nicht."
  port="$(env_wert "$envd" PB_PORT)"
  kunde="$(env_wert "$envd" NF_KUNDE)"

  info "$name: baue neue Dateien …"
  app_bauen "$kunde" "$d/app.neu" >/dev/null
  eigentum "$d/app.neu"

  dienst stop "$name"
  rm -rf "$d/vor-ausrollen"
  mkdir -p "$d/vor-ausrollen"
  db_sichern "$d/pb_data/data.db" "$d/vor-ausrollen/data.db"
  rm -rf "$d/app.vorher"
  mv "$d/app" "$d/app.vorher"
  mv "$d/app.neu" "$d/app"

  if backend "$name" migrate up >/dev/null &&
    { [ "$startwerte_neu" = 0 ] || backend "$name" nf-startwerte "$d/app/startwerte.json" ersetzen; } &&
    dienst start "$name" && smoke_test "$port"; then
    rm -rf "$d/vor-ausrollen"
    ok "$name: ausgerollt (Vorlage $(sed -n 's/.*"vorlage": "*\([^",]*\)"*,.*/\1/p' "$d/app/version.json"))"
    return 0
  fi

  echo "✘ $name: Ausrollen fehlgeschlagen – stelle vorherigen Stand wieder her …" >&2
  dienst stop "$name"
  rm -rf "$d/app.fehlgeschlagen"
  mv "$d/app" "$d/app.fehlgeschlagen"
  mv "$d/app.vorher" "$d/app"
  rm -f "$d/pb_data/data.db-wal" "$d/pb_data/data.db-shm"
  cp "$d/vor-ausrollen/data.db" "$d/pb_data/data.db"
  eigentum "$d/pb_data"
  dienst start "$name"
  smoke_test "$port" && echo "  vorheriger Stand läuft wieder." >&2
  melden "Ausrollen fehlgeschlagen: Instanz $name läuft auf dem vorherigen Stand."
  return 1
}

fehlgeschlagen=0
if [ "$ziel" = "--alle" ]; then
  for f in "$NF_ETC"/*.env; do
    [ -e "$f" ] || continue
    n="$(basename "$f" .env)"
    [ "$n" = betrieb ] && continue
    ausrollen "$n" || fehlgeschlagen=1
  done
else
  ausrollen "$ziel" || fehlgeschlagen=1
fi

# site blocks follow the template (header rules may change with the template)
for f in "$NF_CADDY_DIR"/*.caddy; do
  [ -e "$f" ] || break
  n="$(basename "$f" .caddy)"
  [ -f "$(env_datei "$n")" ] || continue
  url="$(env_wert "$(env_datei "$n")" NF_OEFFENTLICHE_URL)"
  caddy_block_schreiben "$n" "${url#https://}" "$(env_wert "$(env_datei "$n")" PB_PORT)"
done
caddy_neu_laden || fehler "Webserver-Konfiguration ungültig – bitte prüfen."
exit "$fehlgeschlagen"
