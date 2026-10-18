# Assumptions

Provided / inferred / assumed constraints for this project:

- User-confirmed scope (2026-10-18): coverage = "complete via generic UI" (dedicated
  dialogs for lifecycle ops + generic property editor for ALL properties + raw
  zfs/zpool console escape hatch); OpenZFS 2.2+ with runtime detection; validation
  = fixtures + mocked UI AND live host `colum@203.0.113.139`; packaging = full
  rpm/deb/arch/CI parity with hpssa.
- Live validation host: `colum@203.0.113.139`, Debian 13, OpenZFS 2.3.9,
  passwordless sudo for user `colum`. Real pools `hdd0` (UNAVAIL, damaged) and
  `ssd1` (imported 2026-10-18 by the user, active repair: `zpool replace … /dev/sdl`)
  and all real disks are OFF LIMITS. The file-vdev scratch pool `scratch`
  (`/tmp/zfs-fixtures/`) captured for fixtures was removed host-side on
  2026-10-18; recreate with `just live-scratch-up`, remove with
  `just live-scratch-down`. Live testing must only ever touch that scratch pool.
- File-based vdev pools require `zpool import -d /tmp/zfs-fixtures` (the import
  dialog therefore has a search-directory field).
- Parser design assumes stable machine forms: `zfs list/get -H -o …`,
  `zpool list/get -H/-Hp`, `zpool status` indent-tree text. 2.3 `--json` output is
  intentionally NOT used (2.2 compatibility, single parser path).
- "Everything zfs/zpool exposes" is bounded by captured OpenZFS 2.3.9 man pages
  (40 zfs + 33 zpool subcommands). FreeBSD-only subcommands (jail/unjail/zone/
  unzone) are wrapped + console-exposed but have no dedicated UI on Linux.
- Scrub/resilver/initialize/trim "in progress" scan-line fixtures are synthetic
  (documented format); the live scratch pool is too small to photograph progress.
- Plugin targets Cockpit ≥137, PatternFly 6 (`--pf-t--*` tokens), runs inside the
  Cockpit shell (no own sidebar) — hpssa assumptions carried over.
- `pkg/lib` is copied from the hpssa checkout (same cockpit repo stamp) instead of
  re-cloning cockpit from GitHub.
- Destructive operations (destroy/export/labelclear/split/reguid/checkpoint -d,
  send|receive -F, unload-key) require typed name confirmation in the UI.
- Commands are executed via `cockpit.spawn` argv arrays with
  `superuser: 'require'`; the raw console tokenizes quoted input (hpssa pattern).
- Release publishing target: GitHub Releases, .deb/.rpm attached on tag (hpssa D8).
