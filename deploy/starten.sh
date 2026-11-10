#!/bin/sh
# ExecStart of novaflow@.service: serves one instance on 127.0.0.1:$PB_PORT only.
# PB_PORT and NF_OEFFENTLICHE_URL come from /etc/novaflow/<instanz>.env (EnvironmentFile).
set -eu
i="$1"
d="${NF_SRV:-/srv/novaflow}/$i"
: "${PB_PORT:?PB_PORT fehlt in der Umgebung}"
: "${NF_OEFFENTLICHE_URL:?NF_OEFFENTLICHE_URL fehlt in der Umgebung}"

# --automigrate=false: changes in the admin UI never write migration files on the server
exec "$d/app/pocketbase" serve \
  --http="127.0.0.1:$PB_PORT" \
  --origins="$NF_OEFFENTLICHE_URL" \
  --automigrate=false \
  --dev=false \
  --dir="$d/pb_data" \
  --hooksDir="$d/app/pb_hooks" \
  --migrationsDir="$d/app/pb_migrations" \
  --publicDir="$d/app/public"
