#!/bin/sh
# The rolling retention policy for database dumps. The server's own backups and the offsite
# pruner both use it, so that the disk and the bucket keep the same set.
#
# It reads dump names on standard input, one per line, and deletes nothing itself:
#   backup-retention.sh keep     prints the names the policy keeps
#   backup-retention.sh prune    prints the names the policy would delete
#
# A name is elochair-YYYYMMDDTHHMMSSZ.dump, in UTC. Every other line is ignored and printed by
# neither command, so delete only what "prune" prints, never "everything that was not kept".
#
# Dumps are grouped by hour, by day, by ISO 8601 week and by month. A tier set to N keeps the
# newest dump in each of the N most recent periods that have a dump at all: the count is of
# periods with dumps, not of time passed, so nothing ages out while backups are stalled.
# 0 turns a tier off. The result is the four tiers together, and always the newest dump.
#
#   BACKUP_KEEP_HOURLY=48  BACKUP_KEEP_DAILY=14  BACKUP_KEEP_WEEKLY=8  BACKUP_KEEP_MONTHLY=12
#
# So at most 82 dumps are kept with the defaults. With a setting that is not a whole number
# this prints nothing and fails, and the caller must then delete nothing.
#
# POSIX sh, sort and awk only, and no date command: it has to give the same answer under
# busybox (the rclone image) and under dash with mawk (the postgres image).
set -eu

mode="${1:-}"
case "$mode" in
  keep | prune) ;;
  *)
    echo "usage: backup-retention.sh keep|prune   (dump names on standard input)" >&2
    exit 64
    ;;
esac

hourly="${BACKUP_KEEP_HOURLY:-48}"
daily="${BACKUP_KEEP_DAILY:-14}"
weekly="${BACKUP_KEEP_WEEKLY:-8}"
monthly="${BACKUP_KEEP_MONTHLY:-12}"

for setting in "BACKUP_KEEP_HOURLY=$hourly" "BACKUP_KEEP_DAILY=$daily" \
  "BACKUP_KEEP_WEEKLY=$weekly" "BACKUP_KEEP_MONTHLY=$monthly"; do
  case "${setting#*=}" in
    *[!0-9]* | ?????????*)
      echo "backup-retention: ${setting%%=*} must be a whole number from 0 up, not \"${setting#*=}\". Nothing is kept or pruned." >&2
      exit 65
      ;;
  esac
done

# Newest first. With fixed-width UTC stamps, the order of the names is the order of time.
LC_ALL=C sort -ru | LC_ALL=C awk -v mode="$mode" \
  -v hourly="$hourly" -v daily="$daily" -v weekly="$weekly" -v monthly="$monthly" '
  function leap(y) { return (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 }
  function days_in(y, m) {
    if (m == 2) return leap(y) ? 29 : 28
    return (m == 4 || m == 6 || m == 9 || m == 11) ? 30 : 31
  }
  # The weekday of 31 December, 0 for Sunday.
  function dec31(y) { return (y + int(y / 4) - int(y / 100) + int(y / 400)) % 7 }
  function weeks_in(y) { return (dec31(y) == 4 || dec31(y - 1) == 3) ? 53 : 52 }
  # The ISO 8601 week as "year-Wnn". Its year is not always the calendar year: 1 January 2027
  # is in 2026-W53.
  function iso_week(y, m, d,    i, day_of_year, weekday, week) {
    day_of_year = d
    for (i = 1; i < m; i++) day_of_year += days_in(y, i)
    weekday = (dec31(y - 1) + day_of_year) % 7
    if (weekday == 0) weekday = 7
    week = int((day_of_year - weekday + 10) / 7)
    if (week < 1) return (y - 1) "-W" weeks_in(y - 1)
    if (week > weeks_in(y)) return (y + 1) "-W01"
    return y "-W" sprintf("%02d", week)
  }
  BEGIN {
    d = "[0-9]"
    name = "^elochair-" d d d d d d d d "T" d d d d d d "Z[.]dump$"
  }
  {
    if ($0 !~ name) next
    y = substr($0, 10, 4) + 0
    m = substr($0, 14, 2) + 0
    day = substr($0, 16, 2) + 0
    if (m < 1 || m > 12 || day < 1 || day > days_in(y, m)) next
    if (substr($0, 19, 2) + 0 > 23 || substr($0, 21, 2) + 0 > 59 || substr($0, 23, 2) + 0 > 60) next

    seen++
    keep = (seen == 1)
    period = substr($0, 10, 8) substr($0, 19, 2)
    if (period != last_hour) { last_hour = period; if (++hours <= hourly) keep = 1 }
    period = substr($0, 10, 8) ""
    if (period != last_day) { last_day = period; if (++days <= daily) keep = 1 }
    period = iso_week(y, m, day)
    if (period != last_week) { last_week = period; if (++weeks <= weekly) keep = 1 }
    period = substr($0, 10, 6) ""
    if (period != last_month) { last_month = period; if (++months <= monthly) keep = 1 }

    if (keep == (mode == "keep")) print
  }
'
