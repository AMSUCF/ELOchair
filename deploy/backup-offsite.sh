#!/bin/sh
# Offsite copies of the database dumps, in S3-compatible object storage. It runs inside the
# rclone image; setup is in backup-offsite.md. There are two roles, on two machines, and each
# has its own bucket key, so that no single machine can both add to the bucket and empty it.
#
# The uploader runs on the ELOchair server (docker-compose.offsite.yml). Its key can list the
# bucket and put objects, nothing else. It only ever adds: it never deletes, never overwrites
# an object that exists, and uploads nothing older than the newest dump already in the bucket.
#   backup-offsite.sh              upload now, then again every BACKUP_OFFSITE_INTERVAL seconds
#   backup-offsite.sh once         upload once; the exit status says whether it worked
#
# The pruner runs on another machine (offsite-prune/docker-compose.yml). Its key can list the
# bucket and delete objects, nothing else: it cannot read a dump. It deletes what the shared
# policy, backup-retention.sh, no longer keeps, so the bucket holds a fixed rolling set.
#   backup-offsite.sh prune-loop   prune now, then again every BACKUP_OFFSITE_INTERVAL seconds
#   backup-offsite.sh prune        prune once (for cron); OFFSITE_DRY_RUN=1 only says what it would do
#
#   backup-offsite.sh healthy      succeed if the last good round is recent (the healthcheck)
set -eu

SRC="${BACKUP_OFFSITE_SOURCE:-/backups}"
DEST="${BACKUP_OFFSITE_DEST:-}"
INTERVAL="${BACKUP_OFFSITE_INTERVAL:-}"
DRY_RUN="${OFFSITE_DRY_RUN:-0}"
MARKER="${BACKUP_OFFSITE_MARKER:-/tmp/backup-offsite.ok}"
RETENTION="${BACKUP_RETENTION_SCRIPT:-$(dirname "$0")/backup-retention.sh}"

# A dump as the uploader names it, and as it may be named in the bucket: rclone's crypt adds
# ".bin" when it encrypts the contents but not the names.
DUMP='^elochair-[0-9]{8}T[0-9]{6}Z[.]dump$'
STORED='^elochair-[0-9]{8}T[0-9]{6}Z[.]dump([.]bin)?$'

# Remotes come from RCLONE_CONFIG_* variables only: no configuration file is read or written.
export RCLONE_CONFIG=/dev/null

log() { printf '%s backup-offsite: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

die() {
  log "$*"
  exit 64
}

# Runs a command so that "docker stop" interrupts it at once instead of waiting for it.
child=""
run() {
  "$@" &
  child=$!
  wait "$child"
}
stop() {
  if [ -n "$child" ]; then kill "$child" 2>/dev/null || true; fi
  log "stopped"
  exit 0
}

# rclone, asking the bucket for nothing beyond listing, putting and deleting:
# --s3-no-check-bucket   do not create or look up the bucket
# --s3-no-head           do not read an upload back
# --s3-no-head-object    do not probe whether the destination is a single object
# --s3-upload-cutoff 5G  one PUT per dump (the largest S3 allows), which the provider checks
#                        against the MD5 sent with it and which the bucket listing can show
rc() {
  run rclone "$@" --s3-no-check-bucket --s3-no-head --s3-no-head-object --s3-upload-cutoff 5G \
    --retries 1 --stats 0 --stats-log-level DEBUG --log-level INFO
}

# list <file>: writes the names of the objects in $DEST to the file.
list() {
  listed=0
  rc lsf "$DEST" --files-only --max-depth 1 --include '/elochair-*' >"$1" || listed=$?
  # 3 is "directory not found". S3 lists a prefix that has nothing in it as empty; storage with
  # real directories says this instead, and it means the same.
  [ "$listed" -eq 0 ] || [ "$listed" -eq 3 ]
}

# older <a> <b>: whether dump name a sorts before b, which is whether it was taken earlier.
older() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n' "$1" "$2" | LC_ALL=C sort | head -n 1)" = "$1" ]
}

check_config() {
  case "$INTERVAL" in
    *[!0-9]* | 0) die "BACKUP_OFFSITE_INTERVAL must be a whole number of seconds, not \"$INTERVAL\"." ;;
  esac
  case "$DEST" in
    "") die "BACKUP_OFFSITE_DEST is not set. Set it to remote:bucket/prefix (see deploy/backup-offsite.md)." ;;
    ?*:*) ;;
    *) die "BACKUP_OFFSITE_DEST must look like remote:bucket/prefix, not \"$DEST\" (see deploy/backup-offsite.md)." ;;
  esac
  remote="${DEST%%:*}"
  if ! rclone listremotes | grep -qxF "$remote:"; then
    upper="$(printf '%s' "$remote" | tr '[:lower:]-' '[:upper:]_')"
    die "the remote \"$remote\" named by BACKUP_OFFSITE_DEST is not configured. Set RCLONE_CONFIG_${upper}_TYPE and the other RCLONE_CONFIG_${upper}_* variables (see deploy/backup-offsite.md)."
  fi
}

# --- the uploader ----------------------------------------------------------------------------

# One round. The newest dump name in the bucket is a high-water mark: only local dumps after it
# are uploaded, oldest first and one at a time, and the round stops at the first failure, so
# the mark never moves past a dump that is missing. Nothing the pruner removed is older than the
# mark's own dump, so nothing it removed is ever uploaded again, and a rebuilt server with an
# empty backups directory only adds to the history in the bucket.
upload_round() {
  work="$1"
  for dump in "$SRC"/elochair-*.dump; do
    if [ -f "$dump" ]; then printf '%s\n' "${dump##*/}"; fi
  done | grep -E "$DUMP" | LC_ALL=C sort -u >"$work/local"
  if [ ! -s "$work/local" ]; then
    log "FAILED: no finished dump (elochair-<UTC time>.dump) in $SRC, so there is nothing to upload. Is the database backup running?"
    return 1
  fi
  newest_local="$(tail -n 1 "$work/local")"

  if ! list "$work/listing"; then
    log "FAILED: could not list $DEST, so nothing was uploaded. The lines above say why; check the bucket, the key and the RCLONE_CONFIG_* variables."
    return 1
  fi
  grep -E "$DUMP" "$work/listing" | LC_ALL=C sort -u >"$work/remote"
  newest_remote="$(tail -n 1 "$work/remote")"

  if [ -z "$newest_remote" ]; then
    cp "$work/local" "$work/todo"
  else
    LC_ALL=C awk -v mark="$newest_remote" '($0 "") > (mark "")' "$work/local" >"$work/todo"
  fi

  uploaded=0
  while IFS= read -r name <&3; do
    printf '+ /%s\n- **\n' "$name" >"$work/filter"
    # --immutable: if the bucket has an object of this name that differs, fail, never overwrite.
    # --checksum: compare by size and MD5 from the bucket listing, so nothing is read back.
    if ! rc copy "$SRC" "$DEST" --filter-from "$work/filter" --max-depth 1 --checksum --immutable; then
      log "FAILED: could not upload $name to $DEST. This round stops here, so that no later dump is uploaded past the gap; the next round starts again from this dump. The lines above say why."
      return 1
    fi
    uploaded=$((uploaded + 1))
  done 3<"$work/todo"

  if [ "$uploaded" -gt 0 ]; then
    if ! list "$work/listing"; then
      log "FAILED: uploaded $uploaded dump(s) but could not list $DEST afterwards to confirm it."
      return 1
    fi
    grep -E "$DUMP" "$work/listing" | LC_ALL=C sort -u >"$work/remote"
    newest_remote="$(tail -n 1 "$work/remote")"
  fi

  if ! grep -qxF "$newest_local" "$work/remote"; then
    if older "$newest_local" "$newest_remote"; then
      log "FAILED: the newest dump here ($newest_local) is older than the newest in the bucket ($newest_remote) and is not in the bucket. Only dumps newer than the bucket's newest are uploaded, so nothing was. Is the database backup running, and is this server's clock right?"
    else
      log "FAILED: $DEST does not list $newest_local after its upload."
    fi
    return 1
  fi
  if older "$newest_local" "$newest_remote"; then
    log "WARNING: the newest dump here ($newest_local) is older than the newest in the bucket ($newest_remote). Is the database backup running here, or is another server uploading to this bucket?"
  fi
  log "ok: uploaded $uploaded dump(s); the newest here ($newest_local) is in $DEST"
}

# --- the pruner ------------------------------------------------------------------------------

check_prune_config() {
  case "$DRY_RUN" in
    0 | 1) ;;
    *) die "OFFSITE_DRY_RUN must be 1 (only say what would be deleted) or 0, not \"$DRY_RUN\"." ;;
  esac
  [ -f "$RETENTION" ] || die "the retention policy, $RETENTION, is missing. The compose file mounts deploy/backup-retention.sh there."
  sh "$RETENTION" prune </dev/null >/dev/null || die "the retention policy refused the BACKUP_KEEP_* settings (the line above says which). Nothing will be deleted."
}

# One round: list the bucket, ask the policy which of those names to drop, delete exactly those.
# It works on the names as stored, so it needs no encryption password. Any doubt deletes nothing.
prune_round() {
  work="$1"
  if ! list "$work/listing"; then
    log "FAILED: could not list $DEST, so nothing was deleted. The lines above say why; check the bucket, the key and the RCLONE_CONFIG_* variables."
    return 1
  fi
  grep -E "$STORED" "$work/listing" | LC_ALL=C sort -u >"$work/stored"
  sed 's/[.]bin$//' "$work/stored" | LC_ALL=C sort -u >"$work/names"

  if ! sh "$RETENTION" prune <"$work/names" >"$work/policy"; then
    log "FAILED: the retention policy failed (the line above says why), so nothing was deleted."
    return 1
  fi
  LC_ALL=C sort -u "$work/policy" >"$work/drop"
  total=$(($(wc -l <"$work/names")))
  drop=$(($(wc -l <"$work/drop")))
  if [ -n "$(LC_ALL=C comm -23 "$work/drop" "$work/names")" ]; then
    log "FAILED: the retention policy named a dump that is not in $DEST. Refusing to delete anything."
    return 1
  fi
  if [ "$drop" -gt 0 ] && [ "$drop" -ge "$total" ]; then
    log "FAILED: the retention policy would delete every dump in $DEST. Refusing to delete anything."
    return 1
  fi
  if [ "$drop" -eq 0 ]; then
    log "ok: $total dump(s) in $DEST, none outside the retention policy"
    return 0
  fi

  : >"$work/filter"
  while IFS= read -r name <&3; do
    for stored in "$name" "$name.bin"; do
      if grep -qxF "$stored" "$work/stored"; then
        if [ "$DRY_RUN" -eq 1 ]; then
          log "dry run: would delete $stored"
        else
          log "deleting $stored"
          printf '+ /%s\n' "$stored" >>"$work/filter"
        fi
      fi
    done
  done 3<"$work/drop"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "ok (dry run): $drop of $total dump(s) in $DEST are outside the retention policy; nothing was deleted"
    return 0
  fi

  # The filter names each object to delete and excludes everything else: it cannot match more.
  printf '%s\n' '- **' >>"$work/filter"
  if ! rc delete "$DEST" --filter-from "$work/filter" --max-depth 1; then
    log "FAILED: could not delete every dump outside the retention policy from $DEST. The lines above say why; the next round tries again."
    return 1
  fi
  log "ok: deleted $drop dump(s) outside the retention policy; $((total - drop)) remain in $DEST"
}

# --- rounds, loops and health ----------------------------------------------------------------

# round <function>: one round in a scratch directory of its own.
round() {
  scratch="$(mktemp -d /tmp/backup-offsite.XXXXXX)"
  result=0
  "$1" "$scratch" || result=$?
  rm -rf "$scratch"
  return "$result"
}

# loop <function>: a round now and then every $INTERVAL seconds. Each good round is noted for
# the healthcheck, with the age at which it is too old: three rounds missed.
loop() {
  trap stop TERM INT
  while :; do
    if round "$1"; then echo "$(date +%s) $((INTERVAL * 3 + 60))" >"$MARKER"; fi
    run sleep "$INTERVAL" || true
  done
}

healthy() {
  if [ ! -s "$MARKER" ]; then
    echo "no successful round since this container started"
    return 1
  fi
  read -r at limit <"$MARKER"
  age=$(($(date +%s) - at))
  if [ "$age" -gt "$limit" ]; then
    echo "the last successful round was ${age}s ago (the limit is ${limit}s)"
    return 1
  fi
  echo "the last successful round was ${age}s ago"
}

case "${1:-loop}" in
  healthy)
    healthy
    ;;
  loop | once)
    INTERVAL="${INTERVAL:-900}"
    check_config
    [ -d "$SRC" ] || die "$SRC is not a directory. The compose file mounts deploy/backups there."
    if [ "${1:-loop}" = once ]; then
      round upload_round
    else
      log "uploader: new dumps in $SRC go to $DEST, checked every ${INTERVAL}s"
      loop upload_round
    fi
    ;;
  prune-loop | prune)
    INTERVAL="${INTERVAL:-3600}"
    check_config
    check_prune_config
    if [ "$1" = prune ]; then
      round prune_round
    else
      log "pruner: $DEST is kept to the retention policy, checked every ${INTERVAL}s"
      loop prune_round
    fi
    ;;
  *)
    echo "usage: backup-offsite.sh [loop|once|prune-loop|prune|healthy]" >&2
    exit 64
    ;;
esac
