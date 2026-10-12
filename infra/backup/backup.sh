#!/bin/sh
# Dumps the database to /backups, drops dumps older than KEEP_DAYS, and copies the dumps and the
# recipe pictures to the restic repository when one is configured.
set -eu

stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="/backups/snapcook-$stamp.dump"

# A dump is written under another name first, so a half-written file is never taken for a backup.
pg_dump --format=custom --file="$file.part"
mv "$file.part" "$file"
echo "backup: wrote $file ($(du -h "$file" | cut -f1))"

find /backups -name 'snapcook-*.dump' -mtime "+${KEEP_DAYS:-14}" -delete

if [ -z "${RESTIC_REPOSITORY:-}" ]; then
  echo "backup: RESTIC_REPOSITORY is not set, so this dump exists on this server only" >&2
  exit 0
fi

restic cat config >/dev/null 2>&1 || restic init
paths="/backups"
[ -d /data/images ] && paths="$paths /data/images"
# shellcheck disable=SC2086
restic backup $paths --tag nightly --host snapcook
restic forget --tag nightly --host snapcook --keep-daily 14 --keep-monthly 6 --prune
echo "backup: copied to the off-server repository"
