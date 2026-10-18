# ZFS & zpool Manager — Cockpit Plugin

A [Cockpit](https://cockpit-project.org/) plugin for complete local management of
ZFS pools (`zpool`) and datasets (`zfs`): pool and vdev lifecycle, datasets,
volumes, snapshots, clones, bookmarks, properties, send/receive, encryption,
delegation, events and history — without leaving the browser.

## Coverage

Every `zfs` and `zpool` subcommand is reachable, in three layers:

1. **Dedicated dialogs** for all lifecycle operations: pool create/import/export/
   destroy, vdev add/remove/attach/detach/replace/online/offline/clear/labelclear,
   scrub/resilver/trim/initialize (start/pause/resume/cancel), split, reguid,
   checkpoint, upgrade, wait; dataset create/destroy/snapshot/rollback/clone/
   promote/rename/bookmark, mount/share, encryption (load/unload/change key),
   send/receive (dry-run preview, local pipes, file targets), holds, diffs,
   allow/unallow, project accounting, channel programs, redact, rewrite.
2. **A generic property editor** covering 100% of `zfs get` / `zfs set` /
   `zfs inherit` — including user and plugin properties (`org.*`) and future
   properties the plugin has never heard of — plus `zpool get/set` for pool and
   vdev properties.
3. **A raw `zfs`/`zpool` console** for everything else (exotic pipelines,
   combined flags), with every command recorded in the command log.

Also included: pool status with vdev tree and scan progress, `zpool events`
(live follow), `zpool history`, iostat data, an auditable command log of every
operation the plugin runs, and OpenZFS-version capability gating (targets
OpenZFS ≥ 2.2; commands the running version lacks are disabled with an
explanation).

Destructive operations (destroy, export, labelclear, split, reguid, checkpoint
discard, `receive -F`, unload-key, …) require typing the target name to confirm.

## Requirements

- Cockpit ≥ 137 (`cockpit-bridge`)
- OpenZFS ≥ 2.2 (`zfs`/`zpool` in `$PATH`, kernel module loaded)
- Root (the plugin runs commands via `cockpit.spawn` with `superuser: require`)

## Build & install

```
npm install        # or let `make` do it
make               # builds dist/
make devel-install # links dist/ into ~/.local/share/cockpit/zfs
```

Packages: `make rpm` (Fedora/openSUSE), `dpkg-buildpackage` via `debian/`
(Ubuntu/Debian), `packaging/arch/PKGBUILD.in` (Arch). CI builds .rpm/.deb on
every run and attaches them to tag releases (`.github/workflows/build-packages.yml`).

## Development

```
just check     # typecheck + lint + parser/wrapper self-checks + build
just ui-check  # mocked headless-Firefox UI checks (no ZFS needed)
just build
```

- `test/parser-check.mjs` pins the `zfs`/`zpool` output parsers against real
  captured outputs (`test/fixtures/raw/`).
- `test/ui-check.mjs` drives the built UI in headless Firefox (WebDriver BiDi,
  Node ≥ 22) with all system calls mocked: pools, menus, typed-name destroy
  guard, datasets + property editor, events/history, command log, settings,
  raw console, and 390–1440 px layouts.
- `just live-scratch-up` / `live-scratch-down` create and remove a disposable
  file-vdev scratch pool on the validation host for live testing;
  `just fixtures-capture` re-captures reference outputs (`test/fixtures/capture.sh`).

## Notes

- Output parsing uses stable machine forms (`-H`, `-Hp`, `zpool status` text)
  rather than OpenZFS 2.3-only `--json`, so one parser path serves 2.2–2.3.
- `send`/`receive` pipelines run under `sh -c` with strict single-quote escaping
  (raw send streams are binary); the composed command is shown in the dialog and
  recorded in the command log.
- License: LGPL-2.1-or-later (see `LICENSE`).
