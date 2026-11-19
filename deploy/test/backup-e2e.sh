#!/usr/bin/env bash
# End-to-end check of the backup service against a real Postgres, in a throwaway Compose project:
# a scheduled dump, a manual dump, the retention policy, a restore, and a failure that shows.
#
#   deploy/test/backup-e2e.sh      needs Docker; takes about four minutes
#
# It works on a copy in a temporary directory, so deploy/.env and deploy/backups are not touched.
# BACKUP_E2E_PROJECT names the Compose project (default: elochair-backup-e2e).
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
project=${BACKUP_E2E_PROJECT:-elochair-backup-e2e}
work=$(mktemp -d)

step() { printf '\n== %s\n' "$*"; }
fail() {
  printf '\nFAILED: %s\n' "$*" >&2
  exit 1
}

cp "$root/deploy/docker-compose.yml" "$root/deploy/backup.sh" "$root/deploy/backup-retention.sh" "$work/"
mkdir "$work/backups"
cat >"$work/.env" <<'ENV'
POSTGRES_PASSWORD=e2e-only-password
ELOCHAIR_DOMAIN=e2e.invalid
SECRET_KEY=e2e-only
BACKUP_KEEP_HOURLY=3
BACKUP_KEEP_DAILY=0
BACKUP_KEEP_WEEKLY=0
BACKUP_KEEP_MONTHLY=0
ENV
# Probe every 2 s instead of every minute, so the test does not wait on the healthcheck.
cat >"$work/fast.yml" <<'YAML'
services:
  backup:
    healthcheck:
      interval: 2s
      retries: 2
      start_period: 30s
YAML
# The fault: the backup directory cannot be written to. A dump is due every minute, and the
# service must report unhealthy once the newest dump is more than a minute old.
cat >"$work/readonly.yml" <<'YAML'
services:
  backup:
    environment:
      BACKUP_INTERVAL_MINUTES: "1"
      BACKUP_MAX_AGE_MINUTES: "1"
    volumes:
      - ./backups:/backups:ro
YAML

compose() { docker compose -p "$project" -f "$work/docker-compose.yml" -f "$work/fast.yml" "$@"; }
sql() { compose exec -T db psql -U elochair -v ON_ERROR_STOP=1 -At -d "${2:-elochair}" -c "$1"; }
dumps() { find "$work/backups" -maxdepth 1 -type f -name 'elochair-*.dump' | sort; }
health() { docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q backup)"; }
wait_for_health() {
  local want=$1 seconds=$2 i
  for ((i = 0; i < seconds; i++)); do
    if [ "$(health)" = "$want" ]; then return 0; fi
    sleep 1
  done
  fail "the backup service did not become $want within $seconds s (it is $(health))"
}
retention() { # hourly daily weekly monthly mode, names on standard input
  BACKUP_KEEP_HOURLY=$1 BACKUP_KEEP_DAILY=$2 BACKUP_KEEP_WEEKLY=$3 BACKUP_KEEP_MONTHLY=$4 \
    sh "$work/backup-retention.sh" "$5"
}
retention_in() { # image hourly daily weekly monthly mode, names on standard input
  docker run --rm -i --entrypoint sh -v "$work/backup-retention.sh:/backup-retention.sh:ro" \
    -e BACKUP_KEEP_HOURLY="$2" -e BACKUP_KEEP_DAILY="$3" -e BACKUP_KEEP_WEEKLY="$4" \
    -e BACKUP_KEEP_MONTHLY="$5" "$1" /backup-retention.sh "$6"
}

cleanup() {
  if [ "$?" -ne 0 ]; then compose logs --tail=40 db backup >&2 || true; fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work" 2>/dev/null || true
}
trap cleanup EXIT

step "The retention policy gives the same answer under dash and mawk, under busybox, and here"
names=$(awk 'BEGIN {
  # A dump every hour for 70 days across a year end, with a burst of extra dumps now and then.
  split("31 28 31 30 31 30 31 31 30 31 30 31", len, " ")
  y = 2026; m = 11; d = 20; h = 0
  for (i = 0; i < 70 * 24; i++) {
    printf "elochair-%04d%02d%02dT%02d0000Z.dump\n", y, m, d, h
    if (i % 37 == 0) for (x = 1; x <= 3; x++) printf "elochair-%04d%02d%02dT%02d%02d00Z.dump\n", y, m, d, h, x * 13
    if (++h == 24) { h = 0; if (++d > len[m]) { d = 1; if (++m > 12) { m = 1; y++ } } }
  }
  print "elochair-manual.dump"; print "elochair-20270101T000000Z.dump.partial"; print "notes.txt"
}')
total=$(printf '%s\n' "$names" | grep -c 'Z\.dump$')
for settings in "48 14 8 12" "3 2 2 2" "5 0 0 0" "0 0 3 0" "0 0 0 0"; do
  read -r hourly daily weekly monthly <<<"$settings"
  for mode in keep prune; do
    expected=$(printf '%s\n' "$names" | retention "$hourly" "$daily" "$weekly" "$monthly" "$mode")
    [ -n "$expected" ] || fail "the retention script printed nothing here ($settings, $mode)"
    for image in postgres:16 rclone/rclone; do
      actual=$(printf '%s\n' "$names" | retention_in "$image" "$hourly" "$daily" "$weekly" "$monthly" "$mode")
      [ "$actual" = "$expected" ] || fail "$image disagrees on '$mode' with settings $settings"
    done
    if [ "$mode" = keep ]; then staying=$(printf '%s\n' "$expected" | wc -l); fi
  done
  bound=$((hourly + daily + weekly + monthly))
  [ "$staying" -le $((bound > 0 ? bound : 1)) ] || fail "$staying dumps stay with settings $settings: more than their sum"
  echo "ok   hourly/daily/weekly/monthly $settings: $staying of $total dumps stay"
done
for image in postgres:16 rclone/rclone; do
  if out=$(printf '%s\n' "$names" | retention_in "$image" 48 many 8 12 prune 2>/dev/null); then
    fail "$image accepted an invalid setting"
  fi
  [ -z "$out" ] || fail "$image printed names to delete despite an invalid setting"
done
echo "ok   an invalid setting prints nothing and fails, in both images"

step "Starting db and backup: the first dump is taken without being asked for"
compose up -d --wait db backup
[ "$(dumps | wc -l)" -eq 1 ] || fail "expected one dump after start, found: $(dumps)"
first=$(dumps)
[[ ${first##*/} =~ ^elochair-[0-9]{8}T[0-9]{6}Z\.dump$ ]] || fail "unexpected dump name: $first"
[ -n "$(find "$first" -perm 600 -user "$(id -u)")" ] || fail "the dump is not private to the directory's owner: $(ls -ln "$first")"
[ -n "$(find "$work/backups" -maxdepth 0 -perm 700)" ] || fail "the backup directory is not private: $(ls -lnd "$work/backups")"
[ -z "$(find "$work/backups" -name '*.partial')" ] || fail "a .partial file was left behind"
echo "ok   ${first##*/}, mode 600, owned by uid $(id -u)"

step "Loading the real schema and some rows"
for migration in "$root"/apps/server/drizzle/*.sql; do
  compose exec -T db psql -U elochair -d elochair -v ON_ERROR_STOP=1 -q <"$migration"
done
sql "INSERT INTO people (email, display_name) VALUES ('before@example.org', 'Before the dump');
     INSERT INTO audit_log (actor_kind, action) VALUES ('system', 'e2e.before');" >/dev/null

step "A manual backup, as before an upgrade"
sleep 1
compose run --rm -T backup now
good=$(dumps | tail -n 1)
[ "$good" != "$first" ] || fail "the manual backup wrote no new dump"

step "Later changes that the restore must undo, one of them a table from a later migration"
sql "INSERT INTO people (email) VALUES ('after@example.org');
     INSERT INTO audit_log (actor_kind, action) VALUES ('system', 'e2e.after');
     CREATE TABLE from_a_later_migration (id int);" >/dev/null

step "Restoring into a spare database leaves the live one alone"
# From a copy under a name of its own, made on the host without root: the way to keep a dump for good.
cp "$good" "$work/backups/before-upgrade.dump"
compose run --rm -T backup restore --into elochair_drill before-upgrade.dump
[ "$(sql "SELECT count(*) FROM people" elochair_drill)" = 1 ] || fail "the spare database does not hold the dump"
[ "$(sql "SELECT count(*) FROM people")" = 2 ] || fail "restoring into a spare database touched the live one"
sql "DROP DATABASE elochair_drill" postgres >/dev/null

step "Restoring for real, while a client is still connected"
compose exec -T db psql -U elochair -d elochair -c "SELECT pg_sleep(300)" >/dev/null 2>&1 &
sleep 2
compose run --rm -T backup restore "${good##*/}"
[ "$(sql "SELECT string_agg(email, ',') FROM people")" = "before@example.org" ] || fail "people were not restored"
[ "$(sql "SELECT string_agg(action, ',') FROM audit_log")" = "e2e.before" ] || fail "the audit log was not restored"
[ "$(sql "SELECT to_regclass('from_a_later_migration') IS NULL")" = t ] || fail "a table from after the dump survived the restore"
if sql "DELETE FROM audit_log" >/dev/null 2>&1; then fail "the audit log lost its append-only trigger"; fi
previous=$(sql "SELECT datname FROM pg_database WHERE datname LIKE 'elochair_before_restore_%'" postgres)
[ -n "$previous" ] || fail "the previous database was not kept"
[ "$(sql "SELECT count(*) FROM people" "$previous")" = 2 ] || fail "the kept database is not the one from before the restore"
echo "ok   restored; the database as it was is kept as $previous"

step "Retention: with BACKUP_KEEP_HOURLY=3 and the other tiers off, three hours of dumps stay"
for _ in 1 2 3; do
  sleep 1
  compose run --rm -T backup now >/dev/null
done
# One per clock hour: one dump, or two if this test happened to run across the top of an hour.
[ "$(dumps | wc -l)" -le 2 ] || fail "dumps taken minutes apart should leave one per hour: $(dumps)"
[ "$(dumps | tail -n 1)" != "$good" ] || fail "the newest dump did not stay"
echo "ok   five dumps within minutes, $(dumps | wc -l) kept: the hourly tier keeps one per hour"
: >"$work/backups/elochair-20200101T000000Z.dump"
: >"$work/backups/elochair-20200101T010000Z.dump"
: >"$work/backups/elochair-20200101T020000Z.dump"
: >"$work/backups/elochair-20200101T030000Z.dump"
: >"$work/backups/keep-me-before-upgrade.dump"
sleep 1
compose run --rm -T backup now >/dev/null
[ "$(dumps | wc -l)" -eq 3 ] || fail "expected the newest three hours to stay: $(dumps)"
if [ -e "$work/backups/elochair-20200101T000000Z.dump" ] || [ -e "$work/backups/elochair-20200101T010000Z.dump" ]; then
  fail "the oldest dumps were not pruned"
fi
if [ ! -e "$work/backups/keep-me-before-upgrade.dump" ] || [ ! -e "$work/backups/before-upgrade.dump" ]; then
  fail "a file that is not one of ours was deleted"
fi
echo "ok   three stay, and a file with another name is left alone"

step "A fault: the backup directory becomes read-only"
compose -f "$work/readonly.yml" up -d backup
before=$(dumps)
wait_for_health unhealthy 150
[ "$(docker inspect -f '{{.State.Status}}' "$(compose ps -q backup)")" = running ] || fail "the backup service stopped instead of carrying on"
for ((i = 0; i < 90; i++)); do
  if compose logs backup | grep -q "FAILED"; then break; fi
  sleep 1
done
compose logs backup | grep -q "FAILED" || fail "the failed dump was not logged"
[ "$(dumps)" = "$before" ] || fail "the set of dumps changed while the directory was read-only"
echo "ok   unhealthy, still running, and the failure is in the log:"
compose logs backup | grep "FAILED" | tail -n 1

step "The fault is fixed: backups resume on their own"
BACKUP_INTERVAL_MINUTES=1 compose up -d --wait backup
for ((i = 0; i < 30; i++)); do
  if [ "$(dumps | tail -n 1)" != "$(printf '%s\n' "$before" | tail -n 1)" ]; then break; fi
  sleep 1
done
[ "$(dumps | tail -n 1)" != "$(printf '%s\n' "$before" | tail -n 1)" ] || fail "no new dump after the fault was fixed"
echo "ok   healthy again with $(basename "$(dumps | tail -n 1)")"

printf '\nAll backup checks passed.\n'
