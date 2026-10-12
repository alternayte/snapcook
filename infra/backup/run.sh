#!/bin/sh
# Runs the backup once a day at BACKUP_AT (HHMM, in TZ), and the restore drill on the first day
# of each month after that day's backup. A failure is logged and the loop goes on.
set -u

last=""
echo "backup: waiting for ${BACKUP_AT} ${TZ} each day"
while true; do
  today=$(date +%Y%m%d)
  if [ "$(date +%H%M)" = "$BACKUP_AT" ] && [ "$last" != "$today" ]; then
    last=$today
    backup.sh || echo "backup: FAILED" >&2
    if [ "$(date +%d)" = "01" ]; then
      restore-drill.sh || echo "restore drill: FAILED" >&2
    fi
  fi
  sleep 30
done
