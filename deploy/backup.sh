#!/usr/bin/env bash
# Database backups for ELOchair: scheduled dumps with rolling retention.
#
# This is the `backup` service of deploy/docker-compose.yml; "Backups" in deploy/README.md is the
# operator's guide. The database connection comes from the usual PG* variables.
#
#   backup.sh loop                       run forever: a dump whenever the newest one is older than
#                                        BACKUP_INTERVAL_MINUTES
#   backup.sh now                        one dump now, then apply the retention policy
#   backup.sh list                       the dumps, newest first
#   backup.sh prune [--dry-run]          apply the retention policy, or only print what it deletes
#   backup.sh healthy                    exit 0 if the newest dump is recent enough (healthcheck)
#   backup.sh restore [--into DB] FILE   replace the database with a dump (FILE may be "latest"),
#                                        keeping the previous database under another name;
#                                        with --into, restore into a new database instead
#
# The contract other tools rely on (deploy/backup-offsite.md): a dump is written as
# elochair-<UTC yyyymmddThhmmssZ>.dump.partial, read back, written through to the disk, and only
# then renamed to elochair-<stamp>.dump. A file with the final name is always complete.
#
# Which dumps stay is decided by backup-retention.sh, next to this file, and nowhere else.
set -euo pipefail
export LC_ALL=C
umask 077 # dumps contain personal data and confidential reviews: owner-only

DIR="${BACKUP_DIR:-/backups}"
RETENTION="${BACKUP_RETENTION_SCRIPT:-$(dirname "$0")/backup-retention.sh}"
INTERVAL_MIN="${BACKUP_INTERVAL_MINUTES:-60}"
MAX_AGE_MIN="${BACKUP_MAX_AGE_MINUTES:-}"
RETRY_MIN=5         # after a failed dump, wait this long before the next attempt
POLL_SECONDS=30     # how often the loop looks at the clock
CLOCK_SLACK=300     # a dump stamped further ahead than this is from a wrong clock: not "recent"
STALE_PARTIAL=86400 # a .partial older than this was left by a dump that was killed part-way

NAME_RE='^elochair-([0-9]{8}T[0-9]{6}Z)\.dump$'
PARTIAL_RE='^elochair-([0-9]{8}T[0-9]{6}Z)\.dump\.partial$'

log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

usage() {
  echo "usage: backup.sh loop | now | list | prune [--dry-run] | healthy | restore [--into DB] FILE|latest" >&2
  exit 64
}

for setting in INTERVAL_MIN ${MAX_AGE_MIN:+MAX_AGE_MIN}; do
  if ! [[ ${!setting} =~ ^[0-9]{1,6}$ ]] || [ "$((10#${!setting}))" -lt 1 ]; then
    echo "backup: BACKUP_${setting/_MIN/_MINUTES} must be a whole number of minutes, at least 1, not '${!setting}'" >&2
    exit 2
  fi
  printf -v "$setting" '%d' "$((10#${!setting}))"
done
[ -n "$MAX_AGE_MIN" ] || MAX_AGE_MIN=$((2 * INTERVAL_MIN + 5))

# In the container this starts as root. Carry on as the owner of the backup directory, so the
# dumps belong to whoever owns deploy/backups on the host and can be read there without root.
if [ "$(id -u)" = 0 ] && [ -d "$DIR" ] && command -v gosu >/dev/null 2>&1; then
  owner=$(stat -c '%u:%g' "$DIR")
  if [ "${owner%%:*}" != 0 ]; then exec gosu "$owner" bash "$0" "$@"; fi
fi

# BACKUP_TEST_NOW (seconds since the epoch) stands in for the clock in the tests.
now() { printf '%s\n' "${BACKUP_TEST_NOW:-$(date -u +%s)}"; }

# Calendar arithmetic by hand, so nothing depends on which date(1) is installed.
# Sets EPOCH to the seconds since the epoch of a yyyymmddThhmmssZ stamp.
epoch_of() {
  local y=$((10#${1:0:4})) m=$((10#${1:4:2})) d=$((10#${1:6:2}))
  if [ "$m" -le 2 ]; then y=$((y - 1)); fi
  local era=$(((y >= 0 ? y : y - 399) / 400))
  local yoe=$((y - era * 400))
  local doy=$(((153 * ((m + 9) % 12) + 2) / 5 + d - 1))
  local days=$((era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468))
  EPOCH=$((days * 86400 + 10#${1:9:2} * 3600 + 10#${1:11:2} * 60 + 10#${1:13:2}))
}

# Sets STAMP to the yyyymmddThhmmssZ form of seconds since the epoch.
stamp_of() {
  local z=$(($1 / 86400 + 719468)) rest=$(($1 % 86400))
  local era=$((z / 146097))
  local doe=$((z - era * 146097))
  local yoe=$(((doe - doe / 1460 + doe / 36524 - doe / 146096) / 365))
  local doy=$((doe - (365 * yoe + yoe / 4 - yoe / 100)))
  local mp=$(((5 * doy + 2) / 153))
  local d=$((doy - (153 * mp + 2) / 5 + 1)) m=$((mp < 10 ? mp + 3 : mp - 9))
  local y=$((yoe + era * 400 + (m <= 2 ? 1 : 0)))
  printf -v STAMP '%04d%02d%02dT%02d%02d%02dZ' \
    "$y" "$m" "$d" $((rest / 3600)) $((rest % 3600 / 60)) $((rest % 60))
}

# Sets STAMPS to the stamps of the dumps in $DIR, newest first. Only files with exactly our name
# pattern count: anything else in the directory is somebody else's and is never touched.
read_stamps() {
  STAMPS=()
  local f all=()
  for f in "$DIR"/elochair-*.dump; do
    if [[ ${f##*/} =~ $NAME_RE ]] && [ -f "$f" ]; then all+=("${BASH_REMATCH[1]}"); fi
  done
  local i
  for ((i = ${#all[@]} - 1; i >= 0; i--)); do STAMPS+=("${all[i]}"); done
}

prune() {
  local dry=""
  case "${1:-}" in
    --dry-run) dry=1 ;;
    "") ;;
    *) usage ;;
  esac
  read_stamps
  local s name doomed f rc=0 t
  # The policy script fails, and prints nothing, on a setting it cannot read: nothing is deleted.
  if ! doomed=$(
    for s in ${STAMPS[@]+"${STAMPS[@]}"}; do echo "elochair-$s.dump"; done | sh "$RETENTION" prune
  ); then
    log "ERROR: the retention policy could not be worked out; nothing was deleted"
    return 1
  fi
  for name in $doomed; do
    [[ $name =~ $NAME_RE ]] || continue
    f="$DIR/$name"
    if [ -n "$dry" ]; then
      echo "would delete $f"
    elif rm -f -- "$f"; then
      log "pruned $f"
    else
      log "ERROR: could not delete $f"
      rc=1
    fi
  done
  t=$(now)
  for f in "$DIR"/elochair-*.dump.partial; do
    [[ ${f##*/} =~ $PARTIAL_RE ]] || continue
    epoch_of "${BASH_REMATCH[1]}"
    if [ $((t - EPOCH)) -le "$STALE_PARTIAL" ]; then continue; fi
    if [ -n "$dry" ]; then
      echo "would delete $f"
    elif rm -f -- "$f"; then
      log "removed unfinished $f"
    else
      rc=1
    fi
  done
  return "$rc"
}

# One dump, restore or prune at a time, across containers too: the lock is on the directory itself.
lock_dir() {
  command -v flock >/dev/null 2>&1 || return 0
  # A directory that is not there has nothing in it to work on, and nothing to wait for.
  [ -d "$DIR" ] || return 0
  exec 9<"$DIR"
  local waited=0
  until flock -n 9; do
    waited=$((waited + 1))
    if [ "$waited" -ge 600 ]; then
      log "ERROR: another backup or restore has held $DIR for ten minutes"
      return 1
    fi
    sleep 1
  done
}

take_dump() {
  if ! mkdir -p "$DIR"; then
    log "FAILED: cannot create $DIR"
    return 1
  fi
  chmod 700 "$DIR" 2>/dev/null || true
  lock_dir || return 1
  stamp_of "$(now)"
  local final="$DIR/elochair-$STAMP.dump"
  local partial="$final.partial"
  if [ -e "$final" ]; then
    log "$final was written this very second; nothing to do"
    return 0
  fi
  if ! pg_dump --format=custom --no-password --lock-wait-timeout=120000 --file="$partial"; then
    rm -f -- "$partial"
    log "FAILED: pg_dump did not finish; no dump was written"
    return 1
  fi
  # Read the whole archive back: the table of contents, then every data block.
  if ! pg_restore --list "$partial" >/dev/null || ! pg_restore --file=/dev/null "$partial"; then
    rm -f -- "$partial"
    log "FAILED: the new dump does not read back; it was discarded"
    return 1
  fi
  # Reading it back proved the bytes, not that the disk has them: pg_restore read them from
  # memory. A dump the disk did not take (it is full, or failing) is not a backup, and no older
  # dump may be deleted on its account.
  if ! sync "$partial"; then
    rm -f -- "$partial"
    log "FAILED: the new dump could not be written through to the disk; it was discarded and no older dump was touched"
    return 1
  fi
  if ! mv -- "$partial" "$final"; then
    rm -f -- "$partial"
    log "FAILED: could not rename $partial"
    return 1
  fi
  # The new name has to be on the disk as well, before anything older goes.
  if ! sync "$DIR"; then
    log "FAILED: $final is written, but its name could not be written through to the disk; no older dump was deleted"
    return 1
  fi
  log "wrote $final ($(($(wc -c <"$final"))) bytes)"
  # Only now, with a new dump safely on the disk, may older ones go.
  prune || log "ERROR: retention was not applied in full; old dumps may be piling up"
  if [ ! -e "$final" ]; then
    log "ERROR: $final was pruned as soon as it was written: dumps with later names fill every tier. Were they stamped by a wrong clock? Rename or remove them."
    return 1
  fi
}

# Sets NEWEST and NEWEST_AGE (seconds) for the newest dump, ignoring any stamped in the future by
# a clock that was wrong; fails if there is none.
newest_age() {
  read_stamps
  local s t
  t=$(now)
  for s in ${STAMPS[@]+"${STAMPS[@]}"}; do
    epoch_of "$s"
    if [ "$EPOCH" -gt $((t + CLOCK_SLACK)) ]; then continue; fi
    NEWEST=$s
    NEWEST_AGE=$((t - EPOCH))
    return 0
  done
  return 1
}

tick() {
  if newest_age && [ "$NEWEST_AGE" -lt $((INTERVAL_MIN * 60)) ]; then return 0; fi
  take_dump
}

loop() {
  trap 'exit 0' TERM INT
  log "started: a dump every $INTERVAL_MIN min in $DIR"
  while :; do
    if bash "$0" tick; then sleep "$POLL_SECONDS" & else sleep $((RETRY_MIN * 60)) & fi
    wait $! || true
  done
}

# Unhealthy when dumps have stopped arriving, and when the retention settings are unreadable
# (dumps would then pile up, because nothing is deleted on a setting that cannot be trusted).
healthy() {
  if ! sh "$RETENTION" keep </dev/null; then
    echo "the retention settings are not valid: no dump is being deleted"
    return 1
  fi
  if ! newest_age; then
    echo "no dump in $DIR yet"
    return 1
  fi
  if [ "$NEWEST_AGE" -gt $((MAX_AGE_MIN * 60)) ]; then
    echo "the newest dump, elochair-$NEWEST.dump, is $((NEWEST_AGE / 60)) min old (limit: $MAX_AGE_MIN)"
    return 1
  fi
  echo "elochair-$NEWEST.dump is $((NEWEST_AGE / 60)) min old"
}

list() {
  read_stamps
  local s
  for s in ${STAMPS[@]+"${STAMPS[@]}"}; do
    printf 'elochair-%s.dump  %d bytes\n' "$s" "$(($(wc -c <"$DIR/elochair-$s.dump")))"
  done
}

restore() {
  local into="" arg="" file
  while [ $# -gt 0 ]; do
    case "$1" in
      --into)
        [ $# -ge 2 ] || usage
        into=$2
        shift 2
        ;;
      -*) usage ;;
      *)
        arg=$1
        shift
        ;;
    esac
  done
  [ -n "$arg" ] || usage
  if [ "$arg" = latest ]; then
    read_stamps
    if [ ${#STAMPS[@]} -eq 0 ]; then
      log "ERROR: there is no dump in $DIR"
      return 1
    fi
    file="$DIR/elochair-${STAMPS[0]}.dump"
  else
    case "$arg" in
      */*) file=$arg ;;
      *) file="$DIR/$arg" ;;
    esac
  fi
  if ! [ -f "$file" ] || ! pg_restore --list "$file" >/dev/null; then
    log "ERROR: $file is not a readable dump"
    return 1
  fi
  lock_dir || return 1

  local live=${PGDATABASE:?PGDATABASE is not set} suffix target previous
  stamp_of "$(now)"
  suffix=$(printf '%s' "$STAMP" | tr 'TZ' 'tz')
  target=${into:-${live}_restoring_$suffix}
  previous=${live}_before_restore_$suffix

  # Restore into a new database first. A dump that fails to restore never touches the live one,
  # and the result holds exactly what the dump holds, with nothing left over from later.
  if ! createdb --no-password --maintenance-db=postgres --template=template0 "$target"; then
    log "ERROR: could not create the database $target"
    return 1
  fi
  if ! pg_restore --no-password --exit-on-error --dbname="$target" "$file"; then
    dropdb --no-password --maintenance-db=postgres --if-exists "$target" || true
    log "ERROR: $file did not restore; $live is untouched"
    return 1
  fi
  if [ -n "$into" ]; then
    log "restored $file into the database $target; $live is untouched"
    return 0
  fi

  # Then swap the names. Both renames happen or neither does.
  local attempt
  for attempt in 1 2 3 4 5; do
    if psql --no-password --no-psqlrc --quiet --output=/dev/null --dbname=postgres \
      -v ON_ERROR_STOP=1 -v live="$live" -v target="$target" -v previous="$previous" <<'SQL'; then
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname IN (:'live', :'target') AND pid <> pg_backend_pid();
BEGIN;
ALTER DATABASE :"live" RENAME TO :"previous";
ALTER DATABASE :"target" RENAME TO :"live";
COMMIT;
SQL
      log "restored $file as $live. The database as it was is kept as $previous; drop it once you are sure of the restore."
      return 0
    fi
    sleep "$attempt"
  done
  dropdb --no-password --maintenance-db=postgres --if-exists "$target" || true
  log "ERROR: could not swap the restored database in; $live is untouched. Is the app still running? Stop it and try again."
  return 1
}

case "${1:-}" in
  loop) loop ;;
  tick) tick ;;
  now) take_dump ;;
  list) list ;;
  healthy) healthy ;;
  prune)
    shift
    # A prune run by hand deletes, so it takes the lock that a dump and a restore take, and waits
    # for them. The lock is taken here and not in prune(): a dump prunes while it already holds
    # it. --dry-run only reads, so it waits for nobody.
    if [ "${1:-}" != --dry-run ]; then lock_dir || exit 1; fi
    prune "$@"
    ;;
  restore)
    shift
    restore "$@"
    ;;
  *) usage ;;
esac
