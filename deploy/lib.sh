# Shared helpers for deploy/*.sh – sourced, not run.
#
# Server layout (defaults; every path can be overridden for the local rehearsal test):
#   /opt/novaflow/vorlage           this repository (git checkout)          NF_VORLAGE
#   /opt/novaflow/bin               pinned binaries (backend cache, restic)  NF_BIN
#   /srv/novaflow/<instanz>/app     built instance files (read-only for the service)
#   /srv/novaflow/<instanz>/pb_data database + uploads                      NF_SRV
#   /etc/novaflow/<instanz>.env     secrets of one instance, root 600        NF_ETC
#   /etc/novaflow/betrieb.env       backup + alert settings, root 600
#   /etc/caddy/novaflow/<instanz>.caddy  site block                         NF_CADDY_DIR

set -euo pipefail
umask 077

NF_DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NF_VORLAGE="${NF_VORLAGE:-$(dirname "$NF_DEPLOY")}"
NF_SRV="${NF_SRV:-/srv/novaflow}"
NF_ETC="${NF_ETC:-/etc/novaflow}"
NF_BIN="${NF_BIN:-/opt/novaflow/bin}"
NF_CADDY_DIR="${NF_CADDY_DIR:-/etc/caddy/novaflow}"
NF_CADDYFILE="${NF_CADDYFILE:-/etc/caddy/Caddyfile}"
NF_CADDY="${NF_CADDY:-caddy}"
NF_CADDY_NEU_LADEN="${NF_CADDY_NEU_LADEN:-systemctl reload caddy}"
NF_RESTIC="${NF_RESTIC:-$NF_BIN/restic}"
NF_NODE="${NF_NODE:-node}"
# service user; empty = current user (only for the local rehearsal)
NF_BENUTZER="${NF_BENUTZER-novaflow}"
# 1 = run instances as plain background processes instead of systemd (local rehearsal only)
NF_OHNE_SYSTEMD="${NF_OHNE_SYSTEMD:-0}"
NF_PORT_AB="${NF_PORT_AB:-8100}"
NF_BETRIEB_ENV="$NF_ETC/betrieb.env"

fehler() { echo "✘ $*" >&2; exit 1; }
info() { echo "• $*"; }
ok() { echo "✔ $*"; }

pruefe_name() {
  [[ "$1" =~ ^_?[a-z0-9][a-z0-9-]{1,39}$ ]] ||
    fehler "Ungültiger Name „$1“ (Kleinbuchstaben, Ziffern, Bindestrich, optional _ am Anfang)."
}

env_datei() { echo "$NF_ETC/$1.env"; }
instanz_dir() { echo "$NF_SRV/$1"; }

# value of KEY in an env file (last occurrence, taken literally)
env_wert() { sed -n "s/^$2=//p" "$1" | tail -n 1; }

# sets KEY=VALUE in an env file (replaces or appends; keeps owner and mode)
env_setzen() {
  local datei="$1"
  K="$2" V="$3" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    index($0, k "=") == 1 { if (!fertig) print k "=" v; fertig = 1; next }
    { print }
    END { if (!fertig) print k "=" v }' "$datei" >"$datei.neu"
  cat "$datei.neu" >"$datei"
  rm -f "$datei.neu"
}

# exports every KEY=VALUE line of an env file literally (no shell expansion, like systemd)
env_laden() {
  local zeile k
  while IFS= read -r zeile || [ -n "$zeile" ]; do
    case "$zeile" in '' | '#'*) continue ;; esac
    k="${zeile%%=*}"
    [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    export "$k=${zeile#*=}"
  done <"$1"
}

als_benutzer() {
  if [ -n "$NF_BENUTZER" ] && [ "$(id -un)" != "$NF_BENUTZER" ]; then
    runuser -u "$NF_BENUTZER" -- "$@"
  else
    "$@"
  fi
}

eigentum() { # path → owned by the service user
  if [ -n "$NF_BENUTZER" ]; then chown -R "$NF_BENUTZER:$NF_BENUTZER" "$1"; fi
}

# runs a backend console command of an instance with its environment, as the service user
backend() {
  local i="$1"
  shift
  local d
  d="$(instanz_dir "$i")"
  (
    env_laden "$(env_datei "$i")"
    cd "$d"
    als_benutzer "$d/app/pocketbase" "$@" --dev=false \
      --dir="$d/pb_data" --hooksDir="$d/app/pb_hooks" --migrationsDir="$d/app/pb_migrations"
  )
}

# builds kern + kunden/<kunde> into <ziel> (see kern/tools/instanz-bauen.mjs)
app_bauen() {
  "$NF_NODE" "$NF_VORLAGE/kern/tools/instanz-bauen.mjs" "$1" --ziel "$2" --bin "$NF_BIN"
}

zufall() { openssl rand -hex "${1:-24}"; }

port_belegt() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

naechster_port() {
  local p="$NF_PORT_AB" vergeben
  vergeben="$(cat "$NF_ETC"/*.env 2>/dev/null | sed -n 's/^PB_PORT=//p' | sort -n | tr '\n' ' ')"
  while [[ " $vergeben " == *" $p "* ]] || port_belegt "$p"; do p=$((p + 1)); done
  echo "$p"
}

# consistent copy of a live SQLite database (online backup API; no sqlite3 CLI needed)
db_sichern() {
  python3 -I - "$1" "$2" <<'PY'
import sqlite3, sys
quelle = sqlite3.connect(sys.argv[1])
ziel = sqlite3.connect(sys.argv[2])
quelle.backup(ziel)
ziel.close()
quelle.close()
PY
}

# --- service --------------------------------------------------------------------------

dienst() { # start|stop|restart|enable|disable <instanz>
  local aktion="$1" i="$2"
  if [ "$NF_OHNE_SYSTEMD" != 1 ]; then
    case "$aktion" in
      enable) systemctl enable --now "novaflow@$i" ;;
      disable) systemctl disable --now "novaflow@$i" 2>/dev/null || true ;;
      *) systemctl "$aktion" "novaflow@$i" ;;
    esac
    return
  fi
  local d pid
  d="$(instanz_dir "$i")"
  case "$aktion" in
    stop | disable | restart)
      if [ -f "$d/probe.pid" ]; then
        pid="$(cat "$d/probe.pid")"
        kill "$pid" 2>/dev/null || true
        for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
        rm -f "$d/probe.pid"
      fi
      ;;
  esac
  case "$aktion" in
    start | enable | restart)
      (
        env_laden "$(env_datei "$i")"
        if [ -n "$NF_BENUTZER" ]; then exec runuser -u "$NF_BENUTZER" -- "$NF_DEPLOY/starten.sh" "$i"; fi
        exec "$NF_DEPLOY/starten.sh" "$i"
      ) >>"$d/probe.log" 2>&1 </dev/null &
      echo $! >"$d/probe.pid"
      ;;
  esac
}

# health + public pages + own API routes answer on the local port (JSON check: a broken
# hook file would otherwise go unnoticed behind the page fallback, which also answers 200)
smoke_test() {
  local port="$1" n
  for n in $(seq 1 60); do
    curl -fsS -o /dev/null "http://127.0.0.1:$port/api/health" 2>/dev/null && break
    [ "$n" = 60 ] && return 1
    sleep 0.5
  done
  curl -fsS -o /dev/null "http://127.0.0.1:$port/" &&
    curl -fsS -o /dev/null "http://127.0.0.1:$port/uebersicht/" &&
    curl -fsS "http://127.0.0.1:$port/api/nf/angebot" |
    python3 -I -c 'import json, sys
try: sys.exit(0 if json.load(sys.stdin).get("angebote") else 1)
except ValueError: sys.exit(1)'
}

# --- web server -----------------------------------------------------------------------

caddy_block_schreiben() { # instanz domain port
  [[ "$2" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || fehler "Ungültige Domain „$2“."
  mkdir -p "$NF_CADDY_DIR"
  chmod 755 "$NF_CADDY_DIR"
  sed -e "s/__DOMAIN__/$2/g" -e "s/__PORT__/$3/g" -e "s/__INSTANZ__/$1/g" \
    "$NF_DEPLOY/caddy/kunde.caddy.vorlage" >"$NF_CADDY_DIR/$1.caddy"
  chmod 644 "$NF_CADDY_DIR/$1.caddy"
}

caddy_neu_laden() {
  "$NF_CADDY" validate --config "$NF_CADDYFILE" --adapter caddyfile >/dev/null 2>"$NF_SRV/.caddy-pruefung.log" || {
    cat "$NF_SRV/.caddy-pruefung.log" >&2
    return 1
  }
  bash -c "$NF_CADDY_NEU_LADEN" >/dev/null 2>"$NF_SRV/.caddy-pruefung.log" || {
    cat "$NF_SRV/.caddy-pruefung.log" >&2
    return 1
  }
}

# --- backups --------------------------------------------------------------------------

restic_vorbereiten() {
  [ -f "$NF_BETRIEB_ENV" ] || fehler "$NF_BETRIEB_ENV fehlt (deploy/server-einrichten.sh ausführen)."
  env_laden "$NF_BETRIEB_ENV"
  [ -n "${RESTIC_REPOSITORY:-}" ] || fehler "RESTIC_REPOSITORY ist in $NF_BETRIEB_ENV nicht gesetzt."
  [ -n "${RESTIC_PASSWORD_FILE:-}" ] && [ -f "$RESTIC_PASSWORD_FILE" ] ||
    fehler "RESTIC_PASSWORD_FILE fehlt oder ist nicht lesbar."
  export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
}

melden() { "$NF_DEPLOY/melden.sh" "$@" || true; }
