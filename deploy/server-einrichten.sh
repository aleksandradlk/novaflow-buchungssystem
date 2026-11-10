#!/usr/bin/env bash
# One-time server setup (Ubuntu 24.04, as root). Safe to run again: existing settings stay.
#
#   git clone <repo> /opt/novaflow/vorlage && /opt/novaflow/vorlage/deploy/server-einrichten.sh
#
# Checks node/python3/curl/openssl/caddy, creates the service user "novaflow", folders and
# rights, installs the pinned restic, the systemd units and the backup timer, creates
# /etc/novaflow/betrieb.env + backup password, initialises the backup repository and adds
# "import /etc/caddy/novaflow/*.caddy" to the Caddyfile.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$NF_DEPLOY/versionen.sh"

[ "$(id -u)" = 0 ] || fehler "Bitte als root ausführen."
[ "$NF_VORLAGE" = /opt/novaflow/vorlage ] || fehler "Die Vorlage muss unter /opt/novaflow/vorlage liegen (Pfade in deploy/systemd/)."

# 1. tools that come with the system
for w in python3 curl openssl git runuser systemctl; do
  command -v "$w" >/dev/null || fehler "„$w“ fehlt (apt install $w)."
done
command -v "$NF_CADDY" >/dev/null || fehler "Webserver (caddy) fehlt."
command -v "$NF_NODE" >/dev/null || fehler "Node.js fehlt (mind. $NODE_MIN; siehe docs/BETRIEB.md)."
"$NF_NODE" -e "const [a,b]=process.versions.node.split('.').map(Number),[x,y]='$NODE_MIN'.split('.').map(Number);process.exit(a>x||(a===x&&b>=y)?0:1)" ||
  fehler "Node.js $("$NF_NODE" --version) ist zu alt (mind. $NODE_MIN)."
caddy_v="$("$NF_CADDY" version | awk '{print $1}')"
[ "$caddy_v" = "v$CADDY_GETESTET" ] || info "Hinweis: Webserver $caddy_v – getestet mit v$CADDY_GETESTET."
ok "Werkzeuge vorhanden (Node $("$NF_NODE" --version), Webserver $caddy_v)"

# 2. service user + folders
id -u "$NF_BENUTZER" >/dev/null 2>&1 ||
  useradd --system --user-group --home-dir "$NF_SRV" --no-create-home --shell /usr/sbin/nologin "$NF_BENUTZER"
install -d -m 755 "$NF_SRV" "$NF_BIN" "$NF_CADDY_DIR"
install -d -m 700 "$NF_ETC"
ok "Benutzer „$NF_BENUTZER“ und Ordner angelegt"

# 3. dependencies of the template tools (exact versions from package-lock.json)
(cd "$NF_VORLAGE" && npm ci --omit=dev --no-audit --no-fund --silent)
chmod 755 "$NF_DEPLOY"/*.sh
ok "Abhängigkeiten installiert"

# 4. restic (pinned, checksum)
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; *) fehler "Architektur $(uname -m) nicht unterstützt." ;; esac
if [ "$("$NF_RESTIC" version 2>/dev/null | awk '{print $2}')" != "$RESTIC_VERSION" ]; then
  sha_var="RESTIC_SHA256_$arch"
  dl="$(mktemp -d)"
  curl -fsSL -o "$dl/restic.bz2" \
    "https://github.com/restic/restic/releases/download/v$RESTIC_VERSION/restic_${RESTIC_VERSION}_linux_$arch.bz2"
  echo "${!sha_var}  $dl/restic.bz2" | sha256sum -c --quiet - || { rm -rf "$dl"; fehler "Prüfsumme von restic stimmt nicht."; }
  bzip2 -dc "$dl/restic.bz2" >"$NF_BIN/restic"
  chmod 755 "$NF_BIN/restic"
  rm -rf "$dl"
fi
ok "restic $("$NF_RESTIC" version | awk '{print $2}')"

# 5. operations settings + backup repository
if [ ! -f "$NF_BETRIEB_ENV" ]; then
  install -m 600 "$NF_DEPLOY/betrieb.env.example" "$NF_BETRIEB_ENV"
  ok "$NF_BETRIEB_ENV angelegt – bitte Werte prüfen"
fi
pwdatei="$(env_wert "$NF_BETRIEB_ENV" RESTIC_PASSWORD_FILE)"
if [ -n "$pwdatei" ] && [ ! -f "$pwdatei" ]; then
  install -m 600 /dev/null "$pwdatei"
  zufall 32 >"$pwdatei"
  echo "  Backup-Passwort erzeugt: $pwdatei – JETZT im Passwortmanager speichern:"
  echo "  $(cat "$pwdatei")"
fi
restic_vorbereiten
if [[ "$RESTIC_REPOSITORY" == /* ]]; then install -d -m 700 "$RESTIC_REPOSITORY"; fi
"$NF_RESTIC" cat config >/dev/null 2>&1 || "$NF_RESTIC" init --quiet
ok "Backup-Repository bereit ($RESTIC_REPOSITORY)"

# 6. systemd units + backup timer
install -m 644 "$NF_DEPLOY"/systemd/novaflow@.service "$NF_DEPLOY"/systemd/novaflow-melden@.service \
  "$NF_DEPLOY"/systemd/novaflow-backup.service "$NF_DEPLOY"/systemd/novaflow-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now novaflow-backup.timer >/dev/null
ok "Dienste installiert, Backup täglich 02:30"

# 7. web server: include the site blocks of all instances
zeile="import $NF_CADDY_DIR/*.caddy"
if ! grep -qxF "$zeile" "$NF_CADDYFILE"; then
  cp "$NF_CADDYFILE" "$NF_CADDYFILE.vor-novaflow"
  printf '\n# NovaFlow-Instanzen (deploy/neuer-kunde.sh)\n%s\n' "$zeile" >>"$NF_CADDYFILE"
  caddy_neu_laden || { cp "$NF_CADDYFILE.vor-novaflow" "$NF_CADDYFILE"; fehler "Caddyfile ungültig – alte Fassung zurückgelegt."; }
  ok "Caddyfile ergänzt (Sicherung: $NF_CADDYFILE.vor-novaflow)"
fi

echo
echo "Server eingerichtet. Nächster Schritt: deploy/neuer-kunde.sh <kunde> (docs/BETRIEB.md)."
