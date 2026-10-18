#!/usr/bin/env bash
# Re-capture the test/fixtures/raw/ data files from the live host's disposable
# scratch pool. Runs ON the host (see Justfile fixtures-capture):
#   ssh colum@203.0.113.139 'sudo bash -s' < test/fixtures/capture.sh
# Output goes to $1 (default /tmp/zfs-capture); the Justfile copies the files
# back into test/fixtures/raw/ and re-runs test/parser-check.mjs. Recreate the
# asset first (just live-scratch-down && just live-scratch-up) so the captured
# history is exactly the 15 commands of zpool-history.txt again.
#
# Captured here (commands reproduce the original capture forms; "=MARKER="
# lines split the multiple captures packed per file):
#   zpool-status.txt      zpool status -P scratch / zpool status scratch
#   zpool-list.txt        zpool list / zpool list -Hp -o ... / zpool list -H -o ...
#   zpool-iostat.txt      zpool iostat -v / zpool iostat -H -v
#   zpool-get-all.txt     zpool get all / zpool get -H all (pool + vdev forms)
#   zpool-history.txt     zpool history / zpool history -i
#   zpool-events.txt      zpool events
#   zfs-list.txt          zfs list -H -o ... (+ snapshot/bookmark sections)
#   zfs-get-all.txt       zfs get -H all <datasets>
#   zfs-get-sources.txt   zfs get -H -o name,property,value,source[,received]
#   zfs-holds.txt         zfs holds -H / zfs holds -H -r
#   zfs-send-dryrun.txt   zfs send -nP / zfs send -nP -i
#   export-import.txt     zpool import listing (read-only) + import error text
#   offline-degraded.txt  zpool offline/online disk2 + status captures
#   upgrade-versions.txt  zfs upgrade -v / zpool upgrade -v
#   events-verbose.txt    zpool events -v
#
# NOT recaptured, kept as-is on purpose:
#   zfs-space.txt, zfs-diff.txt   - error-text captures (parser-check asserts
#     they parse to zero rows; a successful capture would break that check)
#   scrub-states.txt, replace-resilver.txt, resilver-progress.txt,
#   status-variants.txt, get-precision.txt - mid-flight/variant state captures
#     (need an in-progress scrub, a device replace, or a missing pool)
#   zpool-json.txt, zfs-json.txt, zpool-status-json.txt, zpool-zfs-json.txt -
#     2.3-only --json reference captures (zpool status --json, zfs list --json)
#   help-toplevel.txt, help-lists.txt, help-subcmd-sample.txt, help/*.txt,
#   man-zfs.txt, man-zpool.txt - one-time syntax surface captures. Redo with:
#     zfs help > help-toplevel.txt;  zpool help >> help-toplevel.txt
#     zfs help <sub> > help/zfs-<sub>.txt;  zpool help <sub> > help/zpool-<sub>.txt
#     man zfs | col -bx > man-zfs.txt;  man zpool | col -bx > man-zpool.txt
set -euo pipefail

POOL=scratch
FILES=/tmp/zfs-fixtures
OUT=${1:-/tmp/zfs-capture}
mkdir -p "$OUT"

# zpool-status.txt — plain-path and -P forms of the full asset
{
    zpool status -P "$POOL"
    echo '=PLAIN='
    zpool status "$POOL"
} > "$OUT/zpool-status.txt"

# zpool-list.txt — pretty tree, -Hp machine row, human -H row
{
    zpool list "$POOL"
    echo '=H='
    zpool list -Hp -o name,size,alloc,free,checkpoint,expandsz,fragmentation,cap,dedup,health,altroot "$POOL"
    echo '=H-O='
    zpool list -H -o name,size,alloc,free,checkpoint,expandsz,fragmentation,cap,dedup,health,autotrim,comment "$POOL"
} > "$OUT/zpool-list.txt"

# zpool-iostat.txt — pretty -v tree, then the -H machine rows
{
    zpool iostat -v "$POOL"
    echo '=P='
    zpool iostat -H -v "$POOL"
} > "$OUT/zpool-iostat.txt"

# zpool-get-all.txt — pool properties (pretty + -H) and vdev properties
{
    zpool get all "$POOL"
    echo '=H='
    zpool get -H all "$POOL"
    echo '=VD='
    zpool get -H all "$POOL" raidz1-0
    echo '=VDALL='
    zpool get all "$POOL" raidz1-0
} > "$OUT/zpool-get-all.txt"

# zpool-history.txt — user history plus the -i internal form
{
    zpool history "$POOL"
    echo '=I='
    zpool history -i "$POOL"
} > "$OUT/zpool-history.txt"

# zpool-events.txt / events-verbose.txt
zpool events > "$OUT/zpool-events.txt"
zpool events -v > "$OUT/events-verbose.txt"

# zfs-list.txt — full type set, then per-type sections
{
    zfs list -H -o name,type,used,avail,refer,mountpoint,canmount,keystatus
    echo '=S='
    zfs list -H -t snapshot -o name,used,avail,refer,written
    echo '=B='
    zfs list -H -t bookmark -o name,used,avail,refer
} > "$OUT/zfs-list.txt"

# zfs-get-all.txt — per-dataset property dumps (original =R= section was empty)
{
    zfs get -H all scratch/fs1 scratch scratch/clone1
    echo '=R='
} > "$OUT/zfs-get-all.txt"

# zfs-get-sources.txt — source column form, then the received-column form
{
    zfs get -H -o name,property,value,source all scratch/fs1
    echo '=REC='
    zfs get -H -o name,property,value,source,received all scratch/fs1
} > "$OUT/zfs-get-sources.txt"

# zfs-holds.txt — single snapshot and recursive holds
{
    zfs holds -H scratch/fs1@snap1
    echo '=R='
    zfs holds -H -r scratch/fs1
} > "$OUT/zfs-holds.txt"

# zfs-send-dryrun.txt — full and incremental dry runs
{
    zfs send -nP scratch/fs1@snap1
    echo '=INC='
    zfs send -nP -i scratch/fs1@snap1 scratch/fs1@snap2
} > "$OUT/zfs-send-dryrun.txt"

# upgrade-versions.txt — supported filesystem versions and pool features
{
    zfs upgrade -v
    echo '=ZP='
    zpool upgrade -v
} > "$OUT/upgrade-versions.txt"

# export-import.txt — read-only import listing (host pools included) plus the
# error text for importing the already-imported scratch pool
{
    echo '=IMPORT='
    zpool import
    echo '=DO='
    zpool import scratch || true
} > "$OUT/export-import.txt"

# offline-degraded.txt — DEGRADED status with an offline member, then the
# ONLINE status after the resilver. Byte counts on the scan lines vary per
# run; parser-check's expectations may need updating afterwards.
{
    zpool offline "$POOL" "$FILES/disk2.img"
    sleep 2
    zpool status -P "$POOL"
    echo '=ON='
    zpool online "$POOL" "$FILES/disk2.img"
    sleep 2
    zpool status -P "$POOL"
} > "$OUT/offline-degraded.txt"

chmod -R a+rX "$OUT"
echo "captured into $OUT:" $(ls "$OUT")
