#!/bin/sh
# Kirim pengingat "nyatet" (Web Push) tiap 15 menit. Endpoint-nya sendiri yang
# menentukan user mana yang jadwalnya sudah lewat (idempoten per hari), jadi
# aman dipanggil sesering ini.
#
# Dipasang manual ke crontab (bukan bagian release deploy). Pakai loopback
# supaya tidak bergantung Cloudflare/Caddy, dan source shared/.env supaya
# CRON_SECRET tersedia (crontab tidak mewarisi env dari shell).
set -eu
. /opt/cepatcatat/shared/.env
printf '%s ' "$(date -Is)"
/usr/bin/curl -fsS --max-time 60 \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  http://127.0.0.1:3000/api/cron/push-reminder
echo
