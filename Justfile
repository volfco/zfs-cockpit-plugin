# ZFS Cockpit plugin — build, checks, and live-host validation commands.
# Remote recipes target the disposable scratch pool on the validation host
# (plan.md Measure/Control). Never touch host pools hdd0/ssd1 or real disks.

host := "colum@203.0.113.139"
ssh_opts := "-o BatchMode=yes"
firefox_profile := "/tmp/zfs-ui-profile"
bidi_port := "9222"
capture_dir := "/tmp/zfs-capture"

default: build

# Build the plugin bundle into dist/
build:
    npm run build

# Full local gate: typecheck, lint, parser + wrapper self-checks, build
check:
    #!/usr/bin/env bash
    set -uo pipefail
    # shortcut: the 2 known popper-core type errors in node_modules are
    # tolerated; drop this when @patternfly ships fixed types.
    tsc_out=$(npx tsc --noEmit 2>&1) || true
    unexpected=$(grep 'error TS' <<<"$tsc_out" | grep -v 'thirdparty/popper-core/types.d.ts' || true)
    if [ -n "$unexpected" ]; then echo "$unexpected"; echo 'tsc: unexpected errors'; exit 1; fi
    echo 'tsc: clean apart from the known popper-core errors'
    set -e
    npm run eslint
    node test/parser-check.mjs
    node test/wrapper-check.mjs
    npm run build

# Mocked UI check against headless Firefox BiDi (starts Firefox when needed)
ui-check:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! (echo > /dev/tcp/127.0.0.1/{{bidi_port}}) 2>/dev/null; then
        mkdir -p {{firefox_profile}}
        nohup timeout 900s firefox --headless --no-remote --profile {{firefox_profile}} --remote-debugging-port {{bidi_port}} >/tmp/zfs-ui-firefox.log 2>&1 &
        for _ in $(seq 1 50); do
            (echo > /dev/tcp/127.0.0.1/{{bidi_port}}) 2>/dev/null && break
            sleep 0.2
        done
    fi
    npm run test:ui

# Symlink dist/ into ~/.local/share/cockpit for a live cockpit session
install-dev:
    make devel-install

# --- live validation host (Debian 13, OpenZFS 2.3.9) -------------------------

# Read-only status of the scratch asset + datasets
live-status:
    ssh {{ssh_opts}} {{host}} 'sudo zpool status -P scratch; echo; sudo zfs list'

# Create the disposable loopback scratch pool + datasets (idempotent).
# Runs the exact 15 commands recorded in test/fixtures/raw/zpool-history.txt,
# in order, so a fresh run reproduces that history capture.
live-scratch-up:
    #!/usr/bin/env bash
    set -euo pipefail
    ssh {{ssh_opts}} {{host}} 'sudo bash -s' <<'REMOTE'
    set -euo pipefail
    mkdir -p /tmp/zfs-fixtures
    cd /tmp/zfs-fixtures
    for i in 1 2 3 4 5 6 7 8; do
        [ -f disk$i.img ] || truncate -s 512M disk$i.img
    done
    [ -f key ] || head -c 32 /dev/urandom > key
    if ! zpool list scratch >/dev/null 2>&1; then
        zpool create -f scratch raidz1 /tmp/zfs-fixtures/disk1.img /tmp/zfs-fixtures/disk2.img /tmp/zfs-fixtures/disk3.img /tmp/zfs-fixtures/disk4.img -o comment=cockpit-plugin-fixture
        zpool add scratch spare /tmp/zfs-fixtures/disk5.img
        zpool add scratch log mirror /tmp/zfs-fixtures/disk6.img /tmp/zfs-fixtures/disk7.img
        zpool add scratch cache /tmp/zfs-fixtures/disk8.img
        zfs create -o compression=lz4 -o quota=2G -o recordsize=128K -o mountpoint=/mnt/scratch/fs1 scratch/fs1
        zfs create -o atime=off scratch/fs1/sub
        zfs create -V 1G -o volblocksize=16K scratch/vm
        zfs snapshot scratch/fs1@snap1
        zfs snapshot scratch/fs1@snap2
        zfs clone scratch/fs1@snap1 scratch/clone1
        zfs bookmark scratch/fs1@snap2 scratch/fs1#bm1
        zfs hold keep scratch/fs1@snap1
        zfs create -o encryption=aes-256-gcm -o keyformat=raw -o keylocation=file:///tmp/zfs-fixtures/key scratch/enc
        zfs create scratch/enc/child
        zfs set canmount=noauto scratch/fs1/sub
    else
        # Pool exists: repair drift one asset at a time.
        zfs list -H -o name scratch/fs1 >/dev/null 2>&1 || zfs create -o compression=lz4 -o quota=2G -o recordsize=128K -o mountpoint=/mnt/scratch/fs1 scratch/fs1
        zfs list -H -o name scratch/fs1/sub >/dev/null 2>&1 || zfs create -o atime=off scratch/fs1/sub
        zfs list -H -o name scratch/vm >/dev/null 2>&1 || zfs create -V 1G -o volblocksize=16K scratch/vm
        zfs list -H -t snapshot -o name scratch/fs1@snap1 >/dev/null 2>&1 || zfs snapshot scratch/fs1@snap1
        zfs list -H -t snapshot -o name scratch/fs1@snap2 >/dev/null 2>&1 || zfs snapshot scratch/fs1@snap2
        zfs list -H -o name scratch/clone1 >/dev/null 2>&1 || zfs clone scratch/fs1@snap1 scratch/clone1
        zfs list -H -t bookmark -o name scratch/fs1#bm1 >/dev/null 2>&1 || zfs bookmark scratch/fs1@snap2 scratch/fs1#bm1
        zfs holds -H scratch/fs1@snap1 | grep -q keep || zfs hold keep scratch/fs1@snap1
        zfs list -H -o name scratch/enc >/dev/null 2>&1 || zfs create -o encryption=aes-256-gcm -o keyformat=raw -o keylocation=file:///tmp/zfs-fixtures/key scratch/enc
        zfs list -H -o name scratch/enc/child >/dev/null 2>&1 || zfs create scratch/enc/child
        zfs get -H -o value canmount scratch/fs1/sub | grep -qx noauto || zfs set canmount=noauto scratch/fs1/sub
    fi
    REMOTE

# Destroy the scratch pool and remove the loopback files
live-scratch-down:
    ssh {{ssh_opts}} {{host}} 'sudo zpool destroy -f scratch 2>/dev/null || true; sudo rm -rf /tmp/zfs-fixtures'

# Re-capture test/fixtures/raw/ data files from a fresh scratch asset:
# live-scratch-down && live-scratch-up first, then capture, copy back, re-check.
# Note: parser-check's scrubbed/resilvered byte counts are capture-specific and
# may need updating after a recapture (see test/fixtures/capture.sh).
fixtures-capture:
    #!/usr/bin/env bash
    set -euo pipefail
    ssh {{ssh_opts}} {{host}} 'sudo bash -s' < test/fixtures/capture.sh
    scp {{ssh_opts}} {{host}}:'{{capture_dir}}/*' test/fixtures/raw/
    node test/parser-check.mjs

# Push master to the GitHub remote (external op kept as a recipe per repo rules)
push:
    git push origin master
