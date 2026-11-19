#!/bin/sh
# Tests for backup-retention.sh, the retention policy shared by the server's backups and the
# offsite pruner. POSIX sh on purpose: backup-offsite.test.sh runs this file under busybox (the
# rclone image) and under dash with mawk (the postgres image), and both must agree.
#   sh deploy/backup-offsite.test-retention.sh [path/to/backup-retention.sh]
set -eu

POLICY="${1:-$(dirname "$0")/backup-retention.sh}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
failures=0

ok() { printf 'ok   - %s\n' "$1"; }
fail() {
  printf 'FAIL - %s\n' "$1"
  failures=$((failures + 1))
}

# policy <hourly> <daily> <weekly> <monthly> keep|prune   (names on standard input)
policy() {
  BACKUP_KEEP_HOURLY="$1" BACKUP_KEEP_DAILY="$2" BACKUP_KEEP_WEEKLY="$3" BACKUP_KEEP_MONTHLY="$4" \
    sh "$POLICY" "$5"
}

# expect <description> <file with the output> <expected names...>   (order does not matter)
expect() {
  description="$1"
  LC_ALL=C sort "$2" >"$T/got"
  shift 2
  for name in "$@"; do printf '%s\n' "$name"; done | LC_ALL=C sort >"$T/want"
  if cmp -s "$T/got" "$T/want"; then
    ok "$description"
  else
    fail "$description"
    echo "  wanted:" && sed 's/^/    /' "$T/want"
    echo "  got:" && sed 's/^/    /' "$T/got"
  fi
}

n() { printf 'elochair-%s.dump\n' "$@"; }

# name_at <seconds since 1970>: the dump name for that moment.
name_at() { date -u -d "@$1" +elochair-%Y%m%dT%H%M%SZ.dump; }

# --- one tier at a time ---------------------------------------------------------------------

n 20261117T090000Z 20261117T093000Z 20261117T100000Z 20261117T110000Z 20261117T115959Z \
  20261117T120000Z 20261117T130000Z >"$T/in"
policy 3 0 0 0 keep <"$T/in" >"$T/out"
expect "hourly only is the latest N hours, the newest dump of each" "$T/out" \
  elochair-20261117T130000Z.dump elochair-20261117T120000Z.dump elochair-20261117T115959Z.dump
policy 3 0 0 0 prune <"$T/in" >"$T/out"
expect "prune is everything else" "$T/out" \
  elochair-20261117T090000Z.dump elochair-20261117T093000Z.dump elochair-20261117T100000Z.dump \
  elochair-20261117T110000Z.dump

n 20261115T010000Z 20261115T230000Z 20261116T050000Z 20261116T060000Z 20261117T000000Z >"$T/in"
policy 0 2 0 0 keep <"$T/in" >"$T/out"
expect "daily keeps the newest dump of each of the latest N days" "$T/out" \
  elochair-20261117T000000Z.dump elochair-20261116T060000Z.dump

# 28 December 2026 to 3 January 2027 is ISO week 2026-W53; 4 January starts 2027-W01.
n 20261226T120000Z 20261227T120000Z 20261228T120000Z 20261231T120000Z 20270101T120000Z \
  20270103T120000Z 20270104T120000Z 20270105T120000Z >"$T/in"
policy 0 0 3 0 keep <"$T/in" >"$T/out"
expect "weekly follows ISO weeks across the new year" "$T/out" \
  elochair-20270105T120000Z.dump elochair-20270103T120000Z.dump elochair-20261227T120000Z.dump

n 20260930T230000Z 20261001T000000Z 20261031T235959Z 20261101T000000Z 20261117T000000Z >"$T/in"
policy 0 0 0 2 keep <"$T/in" >"$T/out"
expect "monthly keeps the newest dump of each of the latest N months" "$T/out" \
  elochair-20261117T000000Z.dump elochair-20261031T235959Z.dump

# --- the tiers together ---------------------------------------------------------------------

n 20260101T000000Z 20260820T000000Z 20261110T000000Z 20261116T000000Z 20261117T000000Z \
  20261117T010000Z >"$T/in"
policy 1 2 2 2 keep <"$T/in" >"$T/out"
expect "the result is the four tiers together" "$T/out" \
  elochair-20261117T010000Z.dump elochair-20261116T000000Z.dump elochair-20261110T000000Z.dump \
  elochair-20260820T000000Z.dump

policy 0 0 0 0 keep <"$T/in" >"$T/out"
expect "the newest dump is kept even with every tier off" "$T/out" elochair-20261117T010000Z.dump

n 20190301T000000Z 20190301T010000Z 20190302T000000Z >"$T/in"
sh "$POLICY" prune <"$T/in" >"$T/out"
expect "old dumps do not age out: the count is of periods with dumps, not of the clock" "$T/out"

# --- what is not a dump name is never touched ------------------------------------------------

{
  n 20261117T010000Z 20261117T020000Z 20261117T030000Z
  n 20261117T030000Z # a duplicate
  printf '%s\n' elochair-20261117T040000Z.dump.partial elochair-manual.dump notes.txt \
    elochair-20261340T000000Z.dump elochair-20260230T000000Z.dump elochair-20261117T250000Z.dump \
    'elochair-20261117T050000Z.dump ' ' elochair-20261117T050000Z.dump' \
    elochair-20261117T050000Z.dump.bin ELOCHAIR-20261117T050000Z.DUMP ''
} >"$T/in"
policy 1 0 0 0 keep <"$T/in" >"$T/out"
expect "keep prints only dump names, once each" "$T/out" elochair-20261117T030000Z.dump
policy 1 0 0 0 prune <"$T/in" >"$T/out"
expect "prune prints only dump names" "$T/out" \
  elochair-20261117T010000Z.dump elochair-20261117T020000Z.dump

n 20240229T120000Z 20240228T120000Z >"$T/in"
policy 0 5 0 0 keep <"$T/in" >"$T/out"
expect "29 February of a leap year is a date" "$T/out" \
  elochair-20240229T120000Z.dump elochair-20240228T120000Z.dump

: >"$T/in"
policy 1 1 1 1 prune <"$T/in" >"$T/out"
expect "no names in, no names out" "$T/out"

# --- settings that are not whole numbers: fail, and say nothing ------------------------------

n 20261117T010000Z 20261117T020000Z >"$T/in"
for bad in abc -1 1.5 ' 5' 1e3 123456789; do
  for mode in keep prune; do
    status=0
    policy "$bad" 1 1 1 "$mode" <"$T/in" >"$T/out" 2>"$T/err" || status=$?
    if [ "$status" -ne 0 ] && [ ! -s "$T/out" ] && [ -s "$T/err" ]; then
      ok "BACKUP_KEEP_HOURLY=\"$bad\" $mode fails and prints no names"
    else
      fail "BACKUP_KEEP_HOURLY=\"$bad\" $mode fails and prints no names (status $status)"
    fi
  done
done
status=0
policy 1 1 1 x prune <"$T/in" >"$T/out" 2>/dev/null || status=$?
if [ "$status" -ne 0 ] && [ ! -s "$T/out" ]; then
  ok "a bad BACKUP_KEEP_MONTHLY fails too"
else
  fail "a bad BACKUP_KEEP_MONTHLY fails too"
fi
status=0
sh "$POLICY" delete <"$T/in" >"$T/out" 2>/dev/null || status=$?
if [ "$status" -ne 0 ] && [ ! -s "$T/out" ]; then
  ok "an unknown command fails and prints no names"
else
  fail "an unknown command fails and prints no names"
fi
BACKUP_KEEP_HOURLY='' BACKUP_KEEP_DAILY='' BACKUP_KEEP_WEEKLY='' BACKUP_KEEP_MONTHLY='' \
  sh "$POLICY" keep <"$T/in" >"$T/out"
expect "an empty setting means the default" "$T/out" \
  elochair-20261117T010000Z.dump elochair-20261117T020000Z.dump

# --- ISO weeks against the date command, one dump a day for thirteen years -------------------

# From Sunday 1 December 2019. With only the weekly tier and room for every week, the policy
# must keep exactly the Sundays (the newest day of each Monday-to-Sunday week) and the last day.
start=1575158400
days=4800
: >"$T/days"
i=0
while [ "$i" -lt "$days" ]; do
  at=$((start + i * 86400 + 43200))
  date -u -d "@$at" '+elochair-%Y%m%dT%H%M%SZ.dump %u' >>"$T/days"
  i=$((i + 1))
done
awk '{ print $1 }' "$T/days" >"$T/in"
awk -v last="$days" '$2 == 7 || NR == last { print $1 }' "$T/days" | LC_ALL=C sort >"$T/want-weekly"
policy 0 0 99999 0 keep <"$T/in" | LC_ALL=C sort >"$T/got-weekly"
if cmp -s "$T/got-weekly" "$T/want-weekly"; then
  ok "ISO weeks agree with the date command for $days days in a row"
else
  fail "ISO weeks agree with the date command for $days days in a row"
  diff "$T/want-weekly" "$T/got-weekly" | head -20
fi

# --- many rounds: the set never grows past the bound, and pruning is stable ------------------

# simulate <hourly> <daily> <weekly> <monthly> <rounds> <seconds between dumps>
# Each round adds one dump and prunes, as the server and the pruner do.
simulate() {
  bound=$(($1 + $2 + $3 + $4))
  [ "$bound" -gt 0 ] || bound=1
  : >"$T/set"
  round=0
  worst=0
  at=1700000000
  problem=""
  while [ "$round" -lt "$5" ]; do
    at=$((at + $6))
    newest="$(name_at "$at")"
    printf '%s\n' "$newest" >>"$T/set"
    policy "$1" "$2" "$3" "$4" keep <"$T/set" >"$T/kept"
    policy "$1" "$2" "$3" "$4" prune <"$T/set" >"$T/pruned"
    count=$(($(wc -l <"$T/kept")))
    [ "$count" -le "$worst" ] || worst="$count"
    if [ "$count" -gt "$bound" ]; then problem="round $round kept $count, over the bound of $bound"; fi
    if ! grep -qxF "$newest" "$T/kept"; then problem="round $round did not keep the newest dump"; fi
    if [ $((count + $(wc -l <"$T/pruned"))) -ne "$(($(wc -l <"$T/set")))" ]; then
      problem="round $round: kept and pruned do not add up to the whole set"
    fi
    # Pruning what is left must change nothing: otherwise two machines would never agree.
    if [ -n "$(policy "$1" "$2" "$3" "$4" prune <"$T/kept")" ]; then
      problem="round $round: pruning the kept set again deleted more"
    fi
    cp "$T/kept" "$T/set"
    round=$((round + 1))
    [ -z "$problem" ] || break
  done
  if [ -z "$problem" ]; then
    ok "$5 rounds with tiers $1/$2/$3/$4: never more than $worst dumps (the bound is $bound)"
  else
    fail "$5 rounds with tiers $1/$2/$3/$4: $problem"
  fi
}

simulate 5 4 3 3 400 32400    # a dump every 9 hours for 150 days
simulate 48 14 8 12 1000 36000 # the defaults: a dump every 10 hours for 416 days
simulate 4 0 0 0 60 600        # "latest N": six dumps an hour, four hours kept
simulate 0 0 0 0 20 3600       # every tier off: only the newest

if [ "$failures" -ne 0 ]; then
  echo "$failures test(s) FAILED"
  exit 1
fi
echo "all retention tests passed"
