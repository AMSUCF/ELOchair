#!/usr/bin/env bash
# Nightly database backup with rotation. Example crontab entry on the server:
#   15 3 * * *  /srv/elochair/deploy/backup.sh >> /var/log/elochair-backup.log 2>&1
# Copy the backup directory off the server too (a backup on the same disk is not a backup).
set -euo pipefail
umask 077 # dumps contain personal data and confidential reviews: owner-only
cd "$(dirname "$0")"
DEST="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
mkdir -p "$DEST"
chmod 700 "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DEST/elochair-$STAMP.dump"
docker compose exec -T db pg_dump -U elochair -d elochair -Fc > "$FILE.partial"
mv "$FILE.partial" "$FILE"
find "$DEST" -name 'elochair-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "backup written: $FILE"
