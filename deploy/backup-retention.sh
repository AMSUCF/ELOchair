#!/bin/sh
# The retention policy for database dumps: which of a set of dumps stay and which go.
# It is the one definition of the policy, run wherever dumps are kept (the server's
# deploy/backups directory and any copy of it elsewhere), so every copy holds the same rolling set.
#
#   backup-retention.sh keep  < names     prints the names to keep
#   backup-retention.sh prune < names     prints the names to delete
#
# Names are read one per line. Only names of the exact form elochair-YYYYMMDDTHHMMSSZ.dump (UTC)
# take part; any other line is ignored and is never printed, so it can never be deleted.
#
# The dumps are grouped by hour, by day, by ISO 8601 week and by month. Each tier keeps the newest
# dump of each of its N most recent periods that hold at least one dump:
#   BACKUP_KEEP_HOURLY=48  BACKUP_KEEP_DAILY=14  BACKUP_KEEP_WEEKLY=8  BACKUP_KEEP_MONTHLY=12
# A tier set to 0 is off. What stays is the union of the four tiers, and always the single newest
# dump. So no more than HOURLY + DAILY + WEEKLY + MONTHLY dumps ever stay (82 by default).
#
# The periods are counted from the dumps themselves, not from the clock: while backups are
# stalled nothing ages out, and a wrong clock cannot empty the set.
#
# Plain POSIX sh, sort and awk: this runs under dash and mawk (the postgres image), under busybox
# (the rclone image) and under bash and gawk. A setting that is not a whole number is an error:
# the script prints nothing and exits non-zero, and its caller must then delete nothing.
set -eu

# On an error, still read the names to the end (unless they would come from a terminal), so that
# whatever is writing them is not cut off mid-list.
refuse() {
  echo "$2" >&2
  [ -t 0 ] || cat >/dev/null
  exit "$1"
}

mode=${1:-}
case "$mode" in
  keep | prune) ;;
  *) refuse 64 "usage: backup-retention.sh keep|prune  (dump names on standard input)" ;;
esac

hourly=${BACKUP_KEEP_HOURLY:-48}
daily=${BACKUP_KEEP_DAILY:-14}
weekly=${BACKUP_KEEP_WEEKLY:-8}
monthly=${BACKUP_KEEP_MONTHLY:-12}
for setting in "$hourly" "$daily" "$weekly" "$monthly"; do
  case "$setting" in
    *[!0-9]*)
      refuse 2 "backup-retention: BACKUP_KEEP_HOURLY, _DAILY, _WEEKLY and _MONTHLY must be whole numbers, not '$setting'"
      ;;
  esac
done

# Newest first: the names sort as text in the order of their timestamps.
LC_ALL=C sort -r | LC_ALL=C awk -v mode="$mode" \
  -v hourly="$hourly" -v daily="$daily" -v weekly="$weekly" -v monthly="$monthly" '
  # Days since 1970-01-01 of a calendar date, by arithmetic alone (no date(1) dialects).
  function days(y, m, d,    era, yoe, doy) {
    if (m <= 2) y -= 1
    era = int((y >= 0 ? y : y - 399) / 400)
    yoe = y - era * 400
    doy = int((153 * ((m + 9) % 12) + 2) / 5) + d - 1
    return era * 146097 + yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy - 719468
  }
  # Does this tier keep a dump of this period? It does for the newest dump of each of its first
  # "limit" periods; the input is newest first, so the first dump seen in a period is its newest.
  function tier(t, limit, period) {
    if (seen[t] && period == last[t]) return 0
    if (count[t] >= limit) return 0
    seen[t] = 1
    last[t] = period
    count[t]++
    return 1
  }
  BEGIN {
    limit["h"] = hourly + 0; limit["d"] = daily + 0; limit["w"] = weekly + 0; limit["m"] = monthly + 0
  }
  {
    # elochair- is 9 characters, then 8 digits, T, 6 digits, Z, .dump: 30 in all.
    if (length($0) != 30 || $0 !~ /^elochair-[0-9]+T[0-9]+Z\.dump$/ || substr($0, 18, 1) != "T") next
    if ($0 == previous) next
    kept = (previous == "") # the single newest dump always stays
    previous = $0
    stamp = substr($0, 10, 16)
    # An ISO 8601 week runs from Monday to Sunday. Counting weeks from a fixed Monday names the
    # same weeks as ISO year and week number do, with no special cases at the turn of the year.
    # (1970-01-01 was a Thursday; the 200000 weeks keep the count positive for any year.)
    week = int((days(substr(stamp, 1, 4) + 0, substr(stamp, 5, 2) + 0, substr(stamp, 7, 2) + 0) + 1400003) / 7)
    # Every tier must see every dump, so no short-circuit here.
    if (tier("h", limit["h"], substr(stamp, 1, 11))) kept = 1
    if (tier("d", limit["d"], substr(stamp, 1, 8))) kept = 1
    if (tier("w", limit["w"], week)) kept = 1
    if (tier("m", limit["m"], substr(stamp, 1, 6))) kept = 1
    if ((mode == "keep") == (kept == 1)) print
  }
'
