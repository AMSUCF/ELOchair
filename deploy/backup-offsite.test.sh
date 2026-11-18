#!/usr/bin/env bash
# Tests for the offsite copies of the database dumps (backup-offsite.md). Needs only Docker.
#   bash deploy/backup-offsite.test.sh
#
# 1. The retention policy, under both shells that run it (backup-offsite.test-retention.sh).
# 2. The uploader and the pruner end to end against a local S3 server (MinIO), each with a key
#    limited to what the documentation says it needs, using real pg_dump output.
#
# Everything runs in a temporary copy of deploy/ under its own compose project names, so a real
# deploy/.env, deploy/backups and running stack are never touched. OFFSITE_TEST_KEEP=1 leaves
# the containers and the temporary copy in place afterwards, to look around.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${OFFSITE_TEST_PROJECT:-elochair-test-offsite}"
PRUNE_PROJECT="$PROJECT-prune"
RCLONE_IMAGE="$(awk '$1 == "image:" { print $2; exit }' "$HERE/docker-compose.offsite.yml")"
BUCKET=elochair-backups
T="$(mktemp -d)"
D="$T/deploy"
failures=0

ok() { printf 'ok   - %s\n' "$1"; }
fail() {
  printf 'FAIL - %s\n' "$1"
  failures=$((failures + 1))
}
# check <description> <command...>: passes if the command succeeds.
check() {
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then ok "$description"; else fail "$description"; fi
}
# refuses <command...>: succeeds if the command fails.
refuses() { ! "$@"; }
section() { printf '\n# %s\n' "$1"; }

dc() { docker compose -p "$PROJECT" -f "$D/docker-compose.yml" -f "$D/docker-compose.offsite.yml" -f "$D/backup-offsite.test.yml" "$@"; }
pc() { docker compose -p "$PRUNE_PROJECT" -f "$D/offsite-prune/docker-compose.yml" -f "$D/offsite-prune/test.yml" "$@"; }
mc() { dc exec -T minio mc "$@"; }

cleanup() {
  if [ -n "${OFFSITE_TEST_KEEP:-}" ]; then
    echo "OFFSITE_TEST_KEEP is set: left running, with its files in $T"
    return
  fi
  pc down -v --remove-orphans >/dev/null 2>&1
  dc down -v --remove-orphans >/dev/null 2>&1
  rm -rf "$T"
}
trap cleanup EXIT

# set_env <file> <NAME> <value>: sets or replaces one variable.
set_env() {
  grep -v "^$2=" "$1" >"$1.new" || true
  printf '%s=%s\n' "$2" "$3" >>"$1.new"
  mv "$1.new" "$1"
}
uploader_env() { set_env "$D/.env" "$1" "$2"; }
pruner_env() { set_env "$D/offsite-prune/.env" "$1" "$2"; }

# The uploader and the pruner, one round each. Output goes to $T/out; the status is returned.
upload_once() { dc run --rm -T backup-offsite once >"$T/out" 2>&1; }
prune_once() { pc run --rm -T prune-once >"$T/out" 2>&1; }

# stored <prefix>: the object names under the prefix, as the bucket itself lists them.
stored() { mc ls "local/$BUCKET/$1/" 2>/dev/null | awk '{ print $NF }' | LC_ALL=C sort; }
# stored_is <description> <prefix> <names...>
stored_is() {
  local description="$1" prefix="$2"
  shift 2
  if [ "$(stored "$prefix")" = "$(printf '%s\n' "$@" | LC_ALL=C sort)" ]; then
    ok "$description"
  else
    fail "$description"
    echo "  wanted:" && printf '    %s\n' "$@"
    echo "  the bucket has:" && stored "$prefix" | sed 's/^/    /'
    echo "  the last round said:" && sed 's/^/    /' "$T/out"
  fi
}
said() { grep -q -- "$1" "$T/out"; }
health() { docker inspect -f '{{.State.Health.Status}}' "$("$1" ps -q "$2")" 2>/dev/null; }
# becomes <dc|pc> <service> <health>: waits up to 30 seconds for that health status.
becomes() {
  for _ in $(seq 1 30); do
    [ "$(health "$1" "$2")" = "$3" ] && return 0
    sleep 1
  done
  return 1
}
versions_has() { mc ls --versions "local/$BUCKET/$1/" | grep -q -- "$2"; }
restore_lists() { dc exec -T db pg_restore --list <"$1" | grep -q 'TABLE DATA public marker'; }

name() { printf 'elochair-%s.dump' "$1"; }
# real_dump <stamp>: a real pg_dump of the test database, written the way backups are.
real_dump() {
  local file
  file="$D/backups/$(name "$1")"
  dc exec -T db pg_dump -U elochair -d elochair -Fc >"$file.partial" && mv "$file.partial" "$file" && chmod 600 "$file"
}
# copy_dump <stamp>: another dump with the same contents, for tests that are only about names.
copy_dump() { cp -p "$T/first.dump" "$D/backups/$(name "$1")"; }
# put_stored <prefix> <object name>: an object put in the bucket by someone else (the root key).
put_stored() { mc pipe "local/$BUCKET/$1/$2" <"$T/first.dump" >/dev/null; }
# with_key <user> <secret> <rclone arguments...>: plain rclone against the bucket with that key.
with_key() {
  local user="$1" secret="$2"
  shift 2
  docker run --rm --network "${PROJECT}_offsite" -e RCLONE_CONFIG=/dev/null \
    -e RCLONE_CONFIG_T_TYPE=s3 -e RCLONE_CONFIG_T_PROVIDER=Minio -e RCLONE_CONFIG_T_ENDPOINT=http://minio:9000 \
    -e RCLONE_CONFIG_T_REGION=us-east-1 -e RCLONE_CONFIG_T_ACCESS_KEY_ID="$user" \
    -e RCLONE_CONFIG_T_SECRET_ACCESS_KEY="$secret" "$RCLONE_IMAGE" "$@" --s3-no-check-bucket --retries 1
}
# policy <name> <statements, JSON>: creates or replaces a MinIO policy.
policy() {
  printf '{"Version":"2012-10-17","Statement":[%s]}\n' "$2" >"$T/policy.json"
  dc cp "$T/policy.json" "minio:/tmp/policy.json" >/dev/null 2>&1 && mc admin policy create local "$1" /tmp/policy.json >/dev/null
}
LIST='{"Effect":"Allow","Action":["s3:ListBucket"],"Resource":["arn:aws:s3:::'$BUCKET'"]}'
PUT='{"Effect":"Allow","Action":["s3:PutObject"],"Resource":["arn:aws:s3:::'$BUCKET'/*"]}'
DELETE='{"Effect":"Allow","Action":["s3:DeleteObject"],"Resource":["arn:aws:s3:::'$BUCKET'/*"]}'

# --- 1. the retention policy -------------------------------------------------------------------

section "the retention policy under busybox ($RCLONE_IMAGE)"
docker run --rm -v "$HERE:/deploy:ro" --entrypoint sh "$RCLONE_IMAGE" /deploy/backup-offsite.test-retention.sh || fail "retention tests under busybox"
section "the retention policy under dash and mawk (postgres:16)"
docker run --rm -v "$HERE:/deploy:ro" --entrypoint sh postgres:16 /deploy/backup-offsite.test-retention.sh || fail "retention tests under dash and mawk"

# --- 2. a temporary deployment with MinIO ------------------------------------------------------

section "setting up: Postgres, MinIO, and one key per role"
mkdir -p "$D/backups" "$D/offsite-prune"
chmod 700 "$D/backups"
cp "$HERE/docker-compose.yml" "$HERE/docker-compose.offsite.yml" "$HERE/backup-offsite.test.yml" \
  "$HERE/backup-offsite.sh" "$HERE/backup-retention.sh" "$D/"
cp "$HERE/offsite-prune/docker-compose.yml" "$D/offsite-prune/"
cp "$HERE/.env.example" "$D/.env"
# The uploader's settings, in deploy/.env as on a server.
cat >>"$D/.env" <<EOF
BACKUP_OFFSITE_DEST=offsite:$BUCKET/elochair
BACKUP_OFFSITE_INTERVAL=2
RCLONE_CONFIG_OFFSITE_TYPE=s3
RCLONE_CONFIG_OFFSITE_PROVIDER=Minio
RCLONE_CONFIG_OFFSITE_ENDPOINT=http://minio:9000
RCLONE_CONFIG_OFFSITE_REGION=us-east-1
RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=uploader
RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=uploader-secret
EOF
# The pruner's settings, in its own .env as on the second machine.
cat >"$D/offsite-prune/.env" <<EOF
BACKUP_OFFSITE_DEST=offsite:$BUCKET/elochair
BACKUP_OFFSITE_INTERVAL=2
RCLONE_CONFIG_OFFSITE_TYPE=s3
RCLONE_CONFIG_OFFSITE_PROVIDER=Minio
RCLONE_CONFIG_OFFSITE_ENDPOINT=http://minio:9000
RCLONE_CONFIG_OFFSITE_REGION=us-east-1
RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=pruner
RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=pruner-secret
BACKUP_KEEP_HOURLY=3
BACKUP_KEEP_DAILY=0
BACKUP_KEEP_WEEKLY=0
BACKUP_KEEP_MONTHLY=0
OFFSITE_DRY_RUN=1
EOF
# In the test the second machine is this one: put the pruner on the network MinIO is on.
cat >"$D/offsite-prune/test.yml" <<EOF
services:
  prune:
    networks: [offsite]
    healthcheck:
      interval: 2s
      start_period: 0s
  prune-once:
    networks: [offsite]
networks:
  offsite:
    external: true
    name: ${PROJECT}_offsite
EOF

if ! dc up -d --wait db minio >"$T/out" 2>&1; then
  cat "$T/out"
  fail "Postgres and MinIO start"
  exit 1
fi
mc alias set local http://localhost:9000 testroot testroot-secret >/dev/null
mc mb "local/$BUCKET" >/dev/null
mc version enable "local/$BUCKET" >/dev/null
mc admin user add local uploader uploader-secret >/dev/null
mc admin user add local pruner pruner-secret >/dev/null
policy uploader "$LIST,$PUT" && mc admin policy attach local uploader --user uploader >/dev/null
policy pruner "$LIST,$DELETE" && mc admin policy attach local pruner --user pruner >/dev/null
dc exec -T db psql -U elochair -d elochair -qc \
  "create table marker (id int primary key, note text); insert into marker select g, 'row ' || g from generate_series(1, 500) g;"

# --- the uploader -----------------------------------------------------------------------------

section "the uploader, with a key that can only list and put"
real_dump 20261101T010000Z
cp "$D/backups/$(name 20261101T010000Z)" "$T/first.dump"
copy_dump 20261101T020000Z
echo "half-written" >"$D/backups/$(name 20261101T030000Z).partial"
# Owner-only files of another user, as a backup container would leave them.
docker run --rm -v "$D/backups:/b" --entrypoint chown "$RCLONE_IMAGE" 999:999 "/b/$(name 20261101T020000Z)"

dc up -d backup-offsite >/dev/null 2>&1
for _ in $(seq 1 30); do
  [ "$(stored elochair | wc -l)" -ge 2 ] && break
  sleep 1
done
dc logs --no-log-prefix backup-offsite >"$T/out" 2>&1
stored_is "finished dumps are uploaded to an empty prefix, a .partial is not" elochair \
  "$(name 20261101T010000Z)" "$(name 20261101T020000Z)"
check "a dump owned by another user with mode 0600 is read" said "$(name 20261101T020000Z): Copied"
check "the bucket has the dump byte for byte" cmp "$T/first.dump" <(mc cat "local/$BUCKET/elochair/$(name 20261101T010000Z)")
check "the service is healthy once the newest dump is in the bucket" becomes dc backup-offsite healthy

section "the uploader container is given no way to the database"
dc exec -T backup-offsite env >"$T/out" 2>&1
check "it has the bucket key in its environment" grep -q RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID "$T/out"
check "it has none of the server's secrets there" refuses grep -qiE 'postgres|database_url|secret_key|smtp|mail_from' "$T/out"
check "it can reach the bucket" dc exec -T backup-offsite nc -z -w 2 minio 9000
check "it cannot resolve or reach the database" refuses dc exec -T backup-offsite nc -z -w 2 db 5432
check "it cannot write to the backups directory or to its own disk" \
  refuses dc exec -T backup-offsite sh -c 'touch /backups/x || touch /x'
dc stop backup-offsite >/dev/null 2>&1

section "the uploader's key cannot delete or read"
with_key uploader uploader-secret delete "t:$BUCKET/elochair" >"$T/out" 2>&1
stored_is "deleting with the uploader's key deletes nothing" elochair \
  "$(name 20261101T010000Z)" "$(name 20261101T020000Z)"
check "downloading with the uploader's key is refused" \
  refuses with_key uploader uploader-secret cat "t:$BUCKET/elochair/$(name 20261101T010000Z)"
check "the same download with a key that may read works" \
  with_key testroot testroot-secret cat "t:$BUCKET/elochair/$(name 20261101T010000Z)"

section "the uploader only adds"
echo "changed after upload" >>"$D/backups/$(name 20261101T010000Z)"
upload_once
check "a dump changed under the same name does not replace the one in the bucket" \
  cmp "$T/first.dump" <(mc cat "local/$BUCKET/elochair/$(name 20261101T010000Z)")
rm -f "$D/backups/$(name 20261101T010000Z)"
upload_once
stored_is "deleting a dump on the server leaves it in the bucket" elochair \
  "$(name 20261101T010000Z)" "$(name 20261101T020000Z)"

rm -f "$D/backups/"elochair-*
if upload_once; then fail "an empty backups directory is reported as a failure"; else
  check "an empty backups directory is reported as a failure" said "FAILED: no finished dump"
fi
stored_is "an empty backups directory leaves the history in the bucket" elochair \
  "$(name 20261101T010000Z)" "$(name 20261101T020000Z)"

copy_dump 20261102T010000Z
check "a fresh directory with one new dump uploads it" upload_once
stored_is "a fresh directory with one new dump only adds to the history" elochair \
  "$(name 20261101T010000Z)" "$(name 20261101T020000Z)" "$(name 20261102T010000Z)"

rm -f "$D/backups/"elochair-*
copy_dump 20261031T000000Z
if upload_once; then fail "dumps older than the bucket's newest are not uploaded, and it says so"; else
  check "dumps older than the bucket's newest are not uploaded, and it says so" said "is older than the newest in the bucket"
fi
stored_is "the bucket is unchanged by the older dump" elochair \
  "$(name 20261101T010000Z)" "$(name 20261101T020000Z)" "$(name 20261102T010000Z)"
copy_dump 20261101T020000Z
check "when the newest dump here is in the bucket but is not the bucket's newest, the round succeeds" upload_once
check "and warns that this server is behind the bucket" said "WARNING: the newest dump here ($(name 20261101T020000Z)) is older than the newest in the bucket ($(name 20261102T010000Z))"

section "a failed upload stops the round"
rm -f "$D/backups/"elochair-*
copy_dump 20261103T010000Z
copy_dump 20261103T020000Z
copy_dump 20261103T030000Z
policy uploader "$LIST,$PUT,"'{"Effect":"Deny","Action":["s3:PutObject"],"Resource":["arn:aws:s3:::'$BUCKET'/elochair/'"$(name 20261103T020000Z)"'"]}'
if upload_once; then fail "the round fails at the dump that cannot be uploaded"; else
  check "the round fails at the dump that cannot be uploaded" said "FAILED: could not upload $(name 20261103T020000Z)"
fi
stored_is "dumps before the failure are in the bucket, dumps after it are not" elochair \
  "$(name 20261101T010000Z)" "$(name 20261101T020000Z)" "$(name 20261102T010000Z)" "$(name 20261103T010000Z)"
policy uploader "$LIST,$PUT"
check "the next round carries on from the dump that failed" upload_once
stored_is "and no gap is left" elochair \
  "$(name 20261101T010000Z)" "$(name 20261101T020000Z)" "$(name 20261102T010000Z)" \
  "$(name 20261103T010000Z)" "$(name 20261103T020000Z)" "$(name 20261103T030000Z)"

# --- the pruner -------------------------------------------------------------------------------

section "the pruner, with a key that can only list and delete"
check "a dry run succeeds" prune_once
check "a dry run names what it would delete" said "dry run: would delete $(name 20261101T010000Z)"
stored_is "a dry run deletes nothing" elochair \
  "$(name 20261101T010000Z)" "$(name 20261101T020000Z)" "$(name 20261102T010000Z)" \
  "$(name 20261103T010000Z)" "$(name 20261103T020000Z)" "$(name 20261103T030000Z)"

pruner_env OFFSITE_DRY_RUN 0
pruner_env BACKUP_KEEP_HOURLY abc
if prune_once; then fail "a setting the policy refuses stops the pruner"; else
  check "a setting the policy refuses stops the pruner" said "BACKUP_KEEP_HOURLY must be a whole number"
fi
pruner_env BACKUP_KEEP_HOURLY 3
pruner_env RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY wrong
if prune_once; then fail "a listing that fails stops the pruner"; else
  check "a listing that fails stops the pruner" said "FAILED: could not list"
fi
pruner_env RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY pruner-secret
stored_is "and in both cases nothing is deleted" elochair \
  "$(name 20261101T010000Z)" "$(name 20261101T020000Z)" "$(name 20261102T010000Z)" \
  "$(name 20261103T010000Z)" "$(name 20261103T020000Z)" "$(name 20261103T030000Z)"

check "the pruner runs" prune_once
stored_is "hourly only cuts the bucket to the latest N" elochair \
  "$(name 20261103T010000Z)" "$(name 20261103T020000Z)" "$(name 20261103T030000Z)"
for stamp in 20261101T010000Z 20261101T020000Z 20261102T010000Z; do
  check "the deletion of $(name "$stamp") is logged by name" said "deleting $(name "$stamp")"
done
check "with versioning on, a pruned dump is still there as an old version" versions_has elochair "$(name 20261101T010000Z)"
check "pruning again changes nothing" prune_once
stored_is "the bucket is stable" elochair \
  "$(name 20261103T010000Z)" "$(name 20261103T020000Z)" "$(name 20261103T030000Z)"

check "downloading with the pruner's key is refused" \
  refuses with_key pruner pruner-secret cat "t:$BUCKET/elochair/$(name 20261103T030000Z)"
check "uploading with the pruner's key is refused" \
  refuses with_key pruner pruner-secret rcat "t:$BUCKET/elochair/$(name 20261103T040000Z)"
stored_is "and the bucket is as it was" elochair \
  "$(name 20261103T010000Z)" "$(name 20261103T020000Z)" "$(name 20261103T030000Z)"

section "what the pruner removed is not uploaded again"
copy_dump 20261101T010000Z
copy_dump 20261102T010000Z
check "the uploader runs with pruned dumps still on the server" upload_once
stored_is "none of them goes back to the bucket" elochair \
  "$(name 20261103T010000Z)" "$(name 20261103T020000Z)" "$(name 20261103T030000Z)"

section "the pruner holds the bucket to the bound"
# A history left by an earlier server: a dump every 9 hours from 1 June to 3 November 2026.
mkdir "$T/history"
docker run --rm --entrypoint sh "$RCLONE_IMAGE" -c \
  'at=1780272000; while [ "$at" -lt 1793664000 ]; do date -u -d "@$at" +elochair-%Y%m%dT%H%M%SZ.dump; at=$((at + 32400)); done' |
  while IFS= read -r stored_name; do cp "$T/first.dump" "$T/history/$stored_name"; done
docker run --rm --network "${PROJECT}_offsite" -v "$T/history:/history:ro" -e RCLONE_CONFIG=/dev/null \
  -e RCLONE_CONFIG_T_TYPE=s3 -e RCLONE_CONFIG_T_PROVIDER=Minio -e RCLONE_CONFIG_T_ENDPOINT=http://minio:9000 \
  -e RCLONE_CONFIG_T_REGION=us-east-1 -e RCLONE_CONFIG_T_ACCESS_KEY_ID=testroot \
  -e RCLONE_CONFIG_T_SECRET_ACCESS_KEY=testroot-secret "$RCLONE_IMAGE" \
  copy /history "t:$BUCKET/elochair" --s3-no-check-bucket --transfers 16 >"$T/out" 2>&1 || fail "the history is put in the bucket"
pruner_env BACKUP_KEEP_HOURLY 4
pruner_env BACKUP_KEEP_DAILY 3
pruner_env BACKUP_KEEP_WEEKLY 3
pruner_env BACKUP_KEEP_MONTHLY 3
stored elochair >"$T/before"
BACKUP_KEEP_HOURLY=4 BACKUP_KEEP_DAILY=3 BACKUP_KEEP_WEEKLY=3 BACKUP_KEEP_MONTHLY=3 \
  sh "$HERE/backup-retention.sh" keep <"$T/before" | LC_ALL=C sort >"$T/want"
check "the pruner runs over $(($(wc -l <"$T/before"))) dumps" prune_once
stored elochair >"$T/after"
check "what is left is exactly what the policy keeps" cmp "$T/want" "$T/after"
check "and that is within the bound of 4 + 3 + 3 + 3 ($(($(wc -l <"$T/after"))) left)" \
  test "$(($(wc -l <"$T/after")))" -le 13
check "the newest dump is among them" grep -qxF "$(name 20261103T030000Z)" "$T/after"

rm -f "$D/backups/"elochair-*
copy_dump 20261104T010000Z
check "a rebuilt server with one new dump uploads it" upload_once
{ cat "$T/after" && name 20261104T010000Z && echo; } | LC_ALL=C sort >"$T/want"
stored elochair >"$T/now"
check "and the tiered history is still in the bucket" cmp "$T/want" "$T/now"

section "the looping pruner"
pc up -d prune >/dev/null 2>&1
check "the looping service is healthy after a good round" becomes pc prune healthy
pc stop prune >/dev/null 2>&1

# --- encryption -------------------------------------------------------------------------------

section "client-side encryption (rclone crypt, names left readable)"
password="$(docker run --rm "$RCLONE_IMAGE" obscure 'correct horse battery staple')"
uploader_env BACKUP_OFFSITE_DEST offsitecrypt:
uploader_env RCLONE_CONFIG_OFFSITECRYPT_TYPE crypt
uploader_env RCLONE_CONFIG_OFFSITECRYPT_REMOTE "offsite:$BUCKET/encrypted"
uploader_env RCLONE_CONFIG_OFFSITECRYPT_PASSWORD "$password"
uploader_env RCLONE_CONFIG_OFFSITECRYPT_FILENAME_ENCRYPTION off
rm -f "$D/backups/"elochair-*
real_dump 20261105T010000Z
copy_dump 20261105T020000Z
copy_dump 20261105T030000Z
copy_dump 20261105T040000Z
check "the uploader runs through the crypt remote, to an empty prefix" upload_once
stored_is "the bucket holds the dumps under their names plus .bin" encrypted \
  "$(name 20261105T010000Z).bin" "$(name 20261105T020000Z).bin" "$(name 20261105T030000Z).bin" "$(name 20261105T040000Z).bin"
mc cat "local/$BUCKET/encrypted/$(name 20261105T010000Z).bin" >"$T/encrypted.bin"
check "the dump itself starts with pg_dump's signature" grep -q PGDMP "$D/backups/$(name 20261105T010000Z)"
check "what the bucket holds does not" refuses grep -q PGDMP "$T/encrypted.bin"
upload_once
check "a second round uploads nothing more" said "uploaded 0 dump"

# The restore drill of backup-offsite.md: fetch with a key that can read, decrypt, compare, list.
mkdir -p "$T/restore"
docker run --rm --network "${PROJECT}_offsite" -v "$T/restore:/restore" -e RCLONE_CONFIG=/dev/null \
  -e RCLONE_CONFIG_OFFSITE_TYPE=s3 -e RCLONE_CONFIG_OFFSITE_PROVIDER=Minio -e RCLONE_CONFIG_OFFSITE_ENDPOINT=http://minio:9000 \
  -e RCLONE_CONFIG_OFFSITE_REGION=us-east-1 -e RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=testroot \
  -e RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=testroot-secret \
  -e RCLONE_CONFIG_OFFSITECRYPT_TYPE=crypt -e RCLONE_CONFIG_OFFSITECRYPT_REMOTE="offsite:$BUCKET/encrypted" \
  -e RCLONE_CONFIG_OFFSITECRYPT_PASSWORD="$password" -e RCLONE_CONFIG_OFFSITECRYPT_FILENAME_ENCRYPTION=off \
  "$RCLONE_IMAGE" copy "offsitecrypt:$(name 20261105T010000Z)" /restore >"$T/out" 2>&1
check "a dump fetched back and decrypted is the dump that was uploaded" \
  cmp "$D/backups/$(name 20261105T010000Z)" "$T/restore/$(name 20261105T010000Z)"
check "pg_restore reads it" restore_lists "$T/restore/$(name 20261105T010000Z)"

section "the pruner on an encrypted bucket, without the password"
pruner_env BACKUP_OFFSITE_DEST "offsite:$BUCKET/encrypted"
pruner_env BACKUP_KEEP_HOURLY 2
pruner_env BACKUP_KEEP_DAILY 0
pruner_env BACKUP_KEEP_WEEKLY 0
pruner_env BACKUP_KEEP_MONTHLY 0
check "the pruner has no crypt settings and no password" refuses grep -qiE 'offsitecrypt|password' "$D/offsite-prune/.env"
check "the pruner runs" prune_once
stored_is "it prunes by the stored names" encrypted \
  "$(name 20261105T030000Z).bin" "$(name 20261105T040000Z).bin"
check "the uploader runs again" upload_once
stored_is "and uploads nothing the pruner removed" encrypted \
  "$(name 20261105T030000Z).bin" "$(name 20261105T040000Z).bin"

# --- when the bucket cannot be reached --------------------------------------------------------

section "a key the bucket refuses"
uploader_env RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY wrong
dc up -d --force-recreate backup-offsite >/dev/null 2>&1
check "the uploader becomes unhealthy" becomes dc backup-offsite unhealthy
dc logs --no-log-prefix backup-offsite >"$T/out" 2>&1
check "and its log says plainly that nothing was uploaded" said "FAILED: could not list offsitecrypt:, so nothing was uploaded"

section "the documented command, with the main compose file"
check "docker-compose.yml and docker-compose.offsite.yml load together" \
  docker compose -f "$D/docker-compose.yml" -f "$D/docker-compose.offsite.yml" config --quiet

echo
if [ "$failures" -ne 0 ]; then
  echo "$failures test(s) FAILED"
  exit 1
fi
echo "all offsite backup tests passed"
