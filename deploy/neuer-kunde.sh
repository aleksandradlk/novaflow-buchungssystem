#!/usr/bin/env bash
# Creates a new instance for one customer (run as root on the server).
#
#   deploy/neuer-kunde.sh <kunde> [--name <instanz>] [--domain <domain>] [--port <port>] [--inhaber <e-mail>]
#
#   <kunde>     folder under kunden/ (configuration)
#   --name      instance name (default: <kunde>; e.g. "demo" for a test instance of _beispiel)
#   --domain    public address (default: "domain" from kunden/<kunde>/kunde.json)
#   --port      local port (default: next free from 8100)
#   --inhaber   creates the first owner login for the overview (password is printed once)
#
# Steps: check config → port → /etc/novaflow/<instanz>.env (600, fresh secret) → build app →
# migrations + start values → admin access → service → site block → n8n import files.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

kunde="${1:-}"
[ -n "$kunde" ] && [[ "$kunde" != --* ]] || fehler "Aufruf: neuer-kunde.sh <kunde> [--name <instanz>] [--domain <domain>] [--port <port>] [--inhaber <e-mail>]"
shift
name="$kunde" domain="" port="" inhaber=""
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="${2:?}"; shift 2 ;;
    --domain) domain="${2:?}"; shift 2 ;;
    --port) port="${2:?}"; shift 2 ;;
    --inhaber) inhaber="${2:?}"; shift 2 ;;
    *) fehler "Unbekannte Option „$1“." ;;
  esac
done
pruefe_name "$kunde"
pruefe_name "$name"
[ -d "$NF_VORLAGE/kunden/$kunde" ] || fehler "kunden/$kunde gibt es nicht in $NF_VORLAGE."

envd="$(env_datei "$name")"
d="$(instanz_dir "$name")"
[ ! -e "$envd" ] && [ ! -e "$d" ] || fehler "Instanz „$name“ gibt es schon ($envd bzw. $d). Aktualisieren mit deploy/ausrollen.sh $name."

# 1. configuration (validated while building) + public address
if [ -z "$domain" ]; then
  domain="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["domain"])' "$NF_VORLAGE/kunden/$kunde/kunde.json")"
fi
[ -n "$port" ] || port="$(naechster_port)"
[[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || fehler "Port „$port“ ist ungültig."
grep -qs "^PB_PORT=$port$" "$NF_ETC"/*.env && fehler "Port $port ist schon vergeben."
port_belegt "$port" && fehler "Port $port ist belegt."

# 2. environment file from .env.example (secrets only here, root 600)
mkdir -p "$NF_ETC" "$NF_SRV"
chmod 700 "$NF_ETC"
chmod 755 "$NF_SRV"
webhook_basis=""
[ -f "$NF_BETRIEB_ENV" ] && webhook_basis="$(env_wert "$NF_BETRIEB_ENV" NF_N8N_WEBHOOK_BASIS)"
kennung="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["kennung"])' "$NF_VORLAGE/kunden/$kunde/kunde.json")"
install -m 600 /dev/null "$envd"
grep -v '^PB_SUPERUSER_' "$NF_VORLAGE/.env.example" >"$envd"
env_setzen "$envd" NF_KUNDE "$kunde"
env_setzen "$envd" PB_PORT "$port"
env_setzen "$envd" NF_OEFFENTLICHE_URL "https://$domain"
env_setzen "$envd" NF_WEBHOOK_SECRET "$(zufall 32)"
env_setzen "$envd" NF_WEBHOOK_URL "${webhook_basis:+$webhook_basis/$kennung}"
ok "Umgebung → $envd (Rechte 600)"

# 3. instance files
mkdir -p "$d/pb_data"
chmod 750 "$d"
app_bauen "$kunde" "$d/app" || { rm -rf "$d" "$envd"; fehler "Bauen fehlgeschlagen – nichts angelegt."; }
eigentum "$d"

# 4. database: migrations, start values, admin access (two-factor: password + code by mail)
backend "$name" migrate up >/dev/null
backend "$name" nf-startwerte "$d/app/startwerte.json"
admin_mail=""
[ -f "$NF_BETRIEB_ENV" ] && admin_mail="$(env_wert "$NF_BETRIEB_ENV" NF_ADMIN_EMAIL)"
admin_pw=""
if [ -n "$admin_mail" ]; then
  admin_pw="$(zufall 18)"
  backend "$name" superuser upsert "$admin_mail" "$admin_pw" >/dev/null
fi
inhaber_ausgabe=""
[ -z "$inhaber" ] || inhaber_ausgabe="$(backend "$name" nf-benutzer "$inhaber" inhaber)"

# 5. service
dienst enable "$name"
smoke_test "$port" || fehler "Instanz antwortet nicht auf Port $port (Log: journalctl -u novaflow@$name)."
ok "Dienst novaflow@$name läuft auf 127.0.0.1:$port"

# 6. site block
caddy_block_schreiben "$name" "$domain" "$port"
caddy_neu_laden || { rm -f "$NF_CADDY_DIR/$name.caddy"; fehler "Webserver-Konfiguration ungültig – Block entfernt."; }
ok "Webserver: https://$domain → 127.0.0.1:$port"

# 7. automation import files (credentials.json only once mail access is entered – see automationen.sh)
"$NF_DEPLOY/automationen.sh" "$name" >/dev/null
ok "Automationen: Import-Dateien → $d/n8n/"

echo
echo "Fertig: Instanz „$name“ (Konfiguration kunden/$kunde)"
echo "  Buchungsseite: https://$domain/"
echo "  Übersicht:     https://$domain/uebersicht/"
if [ -n "$admin_pw" ]; then
  echo "  Admin (nur per SSH-Tunnel, Port $port): $admin_mail / $admin_pw"
  echo "    → Passwort jetzt im Passwortmanager speichern, es wird nicht noch einmal angezeigt."
fi
[ -z "$inhaber_ausgabe" ] || echo "  $inhaber_ausgabe"
echo "  Noch zu tun: Zugangsdaten für den Mailversand in $envd eintragen, dann"
echo "  deploy/automationen.sh $name und importieren (docs/BETRIEB.md, „Automationen“)."
