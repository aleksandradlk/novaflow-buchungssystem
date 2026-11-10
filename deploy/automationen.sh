#!/usr/bin/env bash
# Writes the automation import files of one instance to /srv/novaflow/<instanz>/n8n/ (root only):
#   workflows.json    – always (no secrets)
#   credentials.json  – once mail access is entered in /etc/novaflow/<instanz>.env (contains secrets!)
#
#   deploy/automationen.sh <instanz>
#
# Import order and commands: docs/BETRIEB.md, section "Automationen". Delete credentials.json afterwards.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

name="${1:-}"
[ -n "$name" ] || fehler "Aufruf: automationen.sh <instanz>"
pruefe_name "$name"
envd="$(env_datei "$name")"
[ -f "$envd" ] || fehler "Instanz „$name“ gibt es nicht ($envd fehlt)."
kunde="$(env_wert "$envd" NF_KUNDE)"
ziel="$(instanz_dir "$name")/n8n"

mkdir -p "$ziel"
chmod 700 "$ziel"
"$NF_NODE" "$NF_VORLAGE/kern/tools/n8n.mjs" "$kunde" --env "$envd" --ziel "$ziel"
