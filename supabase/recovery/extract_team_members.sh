#!/bin/sh
# Pull the team_members table out of a Supabase database backup, as one INSERT
# into recovery.old_team_members — step 2 of docs/checkin-teams-recovery.md.
#
#   sh supabase/recovery/extract_team_members.sh db_cluster-01-10-2026@04-00-00.backup.gz > old_team_members.sql
#
# Reads the backup's `COPY public.team_members (...) FROM stdin;` block, finds
# the team_id and student_id columns by name, and prints every row. The backup
# holds every course's teams; step 4 only ever uses the rows for the course
# being restored, so nothing needs filtering here.
set -eu

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "usage: sh $0 <backup file, .gz or plain .sql>" >&2
  exit 2
fi

case "$1" in
  *.gz) reader="gunzip -c" ;;
  *) reader="cat" ;;
esac

$reader "$1" | awk -F '\t' '
  /^COPY public\.team_members / {
    hdr = $0
    sub(/^[^(]*\(/, "", hdr)
    sub(/\).*$/, "", hdr)
    n = split(hdr, cols, /, */)
    for (i = 1; i <= n; i++) {
      if (cols[i] == "team_id") t = i
      if (cols[i] == "student_id") s = i
    }
    if (!t || !s) {
      print "could not find team_id and student_id in: " $0 > "/dev/stderr"
      bad = 1
      exit 1
    }
    print "insert into recovery.old_team_members (team_id, student_id) values"
    on = 1
    rows = 0
    next
  }
  on && $0 == "\\." {
    if (rows == 0) {
      print "-- the backup holds no team_members rows"
    } else {
      print ""
      print "on conflict do nothing;"
    }
    found = 1
    exit
  }
  on {
    printf "%s  (%c%s%c, %c%s%c)", (rows ? ",\n" : ""), 39, $t, 39, 39, $s, 39
    rows++
  }
  END {
    if (bad) exit 1
    if (!found) {
      print "no COPY public.team_members block in this file — is it the database backup?" > "/dev/stderr"
      exit 1
    }
  }
'
