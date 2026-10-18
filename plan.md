# ZFS & zpool Cockpit Plugin — Plan (Six Sigma)

Goal: a fully functional Cockpit plugin for complete local management of ZFS pools
(`zpool`) and datasets (`zfs`), modeled on `~/Workspace/hpssa-cockpit-plugin`.

## Define (DMAIC-D)

- **Customers**: operator managing local ZFS via Cockpit; wants full zpool + zfs
  lifecycle coverage without leaving the GUI, with a CLI escape hatch.
- **Scope (user-confirmed 2026-10-18)**:
  1. Coverage model = "complete via generic UI": dedicated dialogs for all pool +
     dataset lifecycle ops, ONE generic property editor covering every property
     (incl. user/plugin props), typed service wrappers for every subcommand, and a
     raw `zfs`/`zpool` console for the long tail (`send` pipes, `redact`,
     `program`, `allow`, …).
  2. Target OpenZFS **2.2+** with runtime version detection (feature gating).
  3. Validation = parser fixtures + mocked UI checks AND live validation against
     `colum@203.0.113.139` (Debian 13, OpenZFS 2.3.9) using disposable
     loopback-file scratch pools.
  4. Packaging = full parity with hpssa: Makefile, rpm, deb, arch, metainfo, GH
     Actions build+release.
- **CTQs**: (a) every zfs/zpool subcommand reachable or explicit; (b) destructive
  ops guarded; (c) status/events/history visible; (d) works at 390–1440 px;
  (e) installable rpm/deb.

## Measure (DMAIC-M)

Reference surfaces captured under `test/fixtures/raw/` from the live host
(OpenZFS 2.3.9, Debian 13):

- `help-toplevel.txt`, `man-zfs.txt`, `man-zpool.txt`, `help/zfs-*.txt`,
  `help/zpool-*.txt` — full syntax surface (zfs: 40 subcommands, zpool: 33).
- `zpool-status.txt`, `zpool-list.txt`, `zpool-iostat.txt`, `zpool-get-all.txt`,
  `zpool-history.txt`, `zpool-events.txt` — plain + `-H`/`-p` machine forms.
- `zfs-list.txt`, `zfs-get-all.txt`, `zfs-get-sources.txt`, `zfs-space.txt`,
  `zfs-holds.txt`, `zfs-diff*.txt`, `zfs-send-dryrun.txt`.
- State captures: `offline-degraded.txt` (DEGRADED + status/action text),
  `replace-resilver.txt` (replace + completed resilver), `scrub-states.txt`,
  `export-import.txt` (available-pool import listing incl. real UNAVAIL/DEGRADED
  pools `hdd0`/`ssd1` found on the host), `upgrade-versions.txt`.
- `zpool-json.txt`, `zfs-json.txt` — 2.3-only `--json` output, kept as reference.
- Synthetic (format documented, not captured mid-flight): scrub/resilver
  "in progress … %", initialize/trim progress lines.

Scratch test asset on the host (kept for live validation):
`scratch` pool = raidz1(4 file vdevs) + log mirror + cache + spare, datasets:
`fs1` (+`sub`, props, unmounted child), `vm` (zvol), `clone1`, `fs1@snap1/2`,
`fs1#bm1`, hold `keep`, `enc` (aes-256-gcm) + `enc/child`. Files in
`/tmp/zfs-fixtures/`. **Never touch host pools `hdd0`/`ssd1` or real disks.**

## Analyze (DMAIC-A)

- Machine-readable output beats text parsing: `zfs list/get -H -o …` and
  `zpool list/get -H/-Hp` are stable column forms across 2.1–2.3 → parse those.
  `zpool status` is indent-tree text (stable for a decade) → dedicated parser.
  2.3 `--json` exists but would force dual parsers on 2.2 → skipped (see
  decisions.md D2).
- Surface math: zfs 40 + zpool 33 subcommands × per-op flags. A dedicated dialog
  per subcommand ≈ 3x the code for near-zero usage of the tail. Coverage is
  therefore layered: dedicated dialogs (frequent/lifecycle) → generic property
  editor (all `get/set/inherit`, incl. future and plugin properties) → raw
  console (everything, with logged commands). Wrappers exist for ALL subcommands
  regardless, so nothing is unreachable.
- Destructive risk: `zpool destroy/export/labelclear`, `zfs destroy`, `send |
  receive -F`, `zpool split`, `reguid`, `checkpoint -d` need typed-confirmation
  dialogs (ConfirmDialog pattern from hpssa).
- Runtime gating: `zfs --version` → capability table (`zpool wait`,
  `zpool resilver`, `zpool ddtprune`, `zpool prefetch`, `zfs rewrite`,
  `zfs redact`, …) → hide/disable unavailable entries with reason.

## Improve (DMAIC-I)

Module contract (subagents implement against this; mirror hpssa layout):

| File | Contents |
|---|---|
| `src/types.ts` | `Pool`, `Vdev`, `PoolScan`, `Dataset`, `PoolProperty`, `DatasetProperty`, `ZfsVersion`, `ViewState`, command-log types |
| `src/zpool.ts` | parsers: `parseZpoolStatus`, `parseZpoolList`, `parseZpoolIostat`, `parseZpoolGet`, `parseZpoolHistory`, `parseZpoolEvents`, `parseZpoolImport` |
| `src/zfs.ts` | parsers: `parseZfsList`, `parseZfsGet`, `parseZfsSpace`, `parseZfsHolds`, `parseZfsSendDryRun`, `parseZfsDiff` |
| `src/service.ts` | command log (hpssa pattern), `runZfs/runZpool/runCommandLine`, `fetchOverview` + per-view fetchers, version detect, typed wrappers for EVERY subcommand (argv builders + run) |
| `src/app.tsx` | shell + tabs: Pools, Datasets, Events/History, Command log, Settings |
| `src/components/` | `actions.tsx` (menus + action defs), `dialogs.tsx` (Form/Confirm/Output/Raw), `poolsPage.tsx`, `datasetsPage.tsx`, `propertiesPanel.tsx`, `commandLog.tsx`, `settingsPage.tsx` |

Conventions: `cockpit.spawn(['zfs', …], { err: 'message', superuser: 'require' })`;
every run carries a human `reason` (command log); discovery runs are logged only
when the log toggle is on; argv-based quoting (never shell strings) except the
raw console which tokenizes like hpssa.

Waves: scaffold → (parsers ∥ service core) → wrappers → UI → tests/packaging →
independent review.

## Control (DMAIC-C)

- `test/parser-check.mjs` — fixture-backed parser self-checks (fail on regression).
- `test/ui-check.mjs` — headless Firefox BiDi, all hardware mocked (hpssa pattern),
  desktop/tablet/phone widths.
- `Justfile` — remote capture/validation commands against the live host.
- `decisions.md` / `assumptions.md` / `todo.md` — maintained per repo rules.

## External references

- hpssa reference plugin: `~/Workspace/hpssa-cockpit-plugin` (architecture, build,
  packaging, test harness; decisions.md D1–D15 lessons applied here).
- OpenZFS man pages (captured): <https://openzfs.github.io/openzfs-docs/man/master/8/zfs.8.html>,
  <https://openzfs.github.io/openzfs-docs/man/master/8/zpool.8.html>
- zfsprops: <https://openzfs.github.io/openzfs-docs/man/master/7/zfsprops.7.html>
- zpool-features: <https://openzfs.github.io/openzfs-docs/man/master/7/zpool-features.7.html>
- Cockpit starter-kit (upstream of hpssa): <https://github.com/cockpit-project/starter-kit>
- PatternFly 6 components: <https://www.patternfly.org/components>
- Live validation host: `colum@203.0.113.139` (Debian 13, OpenZFS 2.3.9).
