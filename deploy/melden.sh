#!/usr/bin/env bash
# Sends a short operations alert to NovaFlow (Telegram; settings in /etc/novaflow/betrieb.env)
# and writes it to the system log. Never pass personal data – only instance names and what failed.
#
#   deploy/melden.sh <text>
set -uo pipefail
NF_ETC="${NF_ETC:-/etc/novaflow}"
text="NovaFlow-Betrieb: $*"
logger -t novaflow -- "$text" 2>/dev/null || echo "$text" >&2

datei="$NF_ETC/betrieb.env"
[ -r "$datei" ] || exit 0
token="$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$datei" | tail -n 1)"
chat="$(sed -n 's/^TELEGRAM_CHAT_ID=//p' "$datei" | tail -n 1)"
[ -n "$token" ] && [ -n "$chat" ] || exit 0
# token via stdin config, so it never shows up in the process list
printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
  curl -fsS --max-time 15 -K - --data-urlencode "chat_id=$chat" --data-urlencode "text=$text" -o /dev/null
