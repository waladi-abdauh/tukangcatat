#!/bin/sh
# Cek kesehatan device WA (Wablas) tiap 15 menit. Dipasang manual, bukan
# bagian release deploy. Loopback supaya tidak bergantung Cloudflare/Caddy.
# Source shared/.env supaya CRON_SECRET tersedia (crontab tidak mewarisi env).
set -eu
. /opt/cepatcatat/shared/.env
printf '%s ' "$(date -Is)"
/usr/bin/curl -fsS --max-time 30 \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  http://127.0.0.1:3000/api/cron/gateway-health
echo
