#!/usr/bin/env bash
# Dumps the planner database (run nightly by yearly-overview-backup.timer, or by hand:
#   sudo systemctl start yearly-overview-backup
# ). Keeps the newest $BACKUP_KEEP dumps (default 14).
set -euo pipefail
umask 077

dir="${STATE_DIRECTORY:-/var/lib/yearly-overview}/backups"
keep="${BACKUP_KEEP:-14}"
if [[ ! "$keep" =~ ^[1-9][0-9]*$ ]]; then
	echo "BACKUP_KEEP must be a positive integer." >&2
	exit 1
fi
mkdir -p "$dir"

file="$dir/yearly-overview-$(date -u +%Y%m%dT%H%M%SZ).dump"
# A failed dump must not leave a half-written file that looks like a backup.
rm -f "$dir"/*.partial
trap 'rm -f "$file.partial"' EXIT
python3 "$(dirname "${BASH_SOURCE[0]}")/pg-dump.py" "$file.partial"
mv "$file.partial" "$file"

# Newest first; delete everything after the first $keep.
ls -1t "$dir"/yearly-overview-*.dump | tail -n +"$((keep + 1))" | xargs -r rm --
echo "Backed up to $file"
