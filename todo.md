# TODO

(follow-ups discovered during implementation land here)

## Done

(none yet)

- [ ] Vdev Capacity/iostat columns are empty (`Vdev.iostat` never populated): join `fetchIostat` output into the pool tree in fetchOverview or poolsPage. Ref: src/service.ts, src/components/poolsPage.tsx.
- [ ] Progress streaming UI for long ops (scrub -w / initialize -w / trim -w / wait / send / receive): `onProgress` hooks exist in service.ts but dialogs await silently. Ref: src/components/actions.tsx, datasetActions.tsx.
- [ ] Dedupe UI plumbing: `destructiveConfirm`/`typedName`/`defined()` are copied across actions.tsx / datasetActions.tsx (3x `defined`). Export from actions.tsx and reuse. Ref: src/components/.
- [ ] `poolStatus` wrapper has no `-P` (full paths) option (`parsable` maps to `-p`); raw-status view calls `runZpool(['status','-P'])` directly. Add a `paths` option. Ref: src/service.ts.
- [ ] Cosmetic: `logbias` property shows the size-suffix helper hint though it is an enum. Ref: src/components/propertiesPanel.tsx.
- [ ] `zfs change-key` passphrase entry needs a TTY — dialog warns; file:// keylocation works. A future cockpit.file-based key upload could remove the limitation. Ref: src/components/datasetActions.tsx.

- [ ] Packaging gaps not verifiable locally: lintian pass on the .deb, Arch `makepkg` build, spec `rebuild_bundle` opt-in branch. Ref: decisions.md D11.
- [ ] Re-add `%doc README.md` to debian/docs + PKGBUILD docs array if desired (spec now has it; deb/arch currently ship no README). Ref: packaging/.

- [ ] Review nits deferred: TableCaption duplicated (app/poolsPage/datasetsPage), `errText` not exported (error mapping repeated ~15x), `parseUsageRows` lives in service.ts not zfs.ts, `vdevType` misses draid config-form names (`draid2:2d:6c:0s-0`), events follow re-parses full log every 2s (unbounded), Unshare `-a [nfs|smb]` only reachable via wrapper/raw console (dialog is target-only). Ref: quality review.

- [ ] Device multi-select (D15) only landed in the create-pool dialog; existing-pool actions (add vdev/cache/spare, attach, replace) still use free-text device fields. Extend `multiselect` + `fetchAvailableDisks` there. Ref: src/components/actions.tsx `devicesField`.
- [ ] D15 keeps disks with non-ZFS filesystems (and whole disks whose partitions are mounted) in the pick list — `zpool create` refuses without -f, but the Force switch can still wipe them. Tighten the filter if that proves too easy to hit. Ref: decisions.md D15, src/zpool.ts `parseAvailableDisks`.
- [ ] D15 pick lists offer `disk`/`part` only — loop/mapper/mpath devices are not selectable (file vdevs need the raw console since D15). Ref: src/zpool.ts `parseAvailableDisks`.
- [ ] Create-pool dialog does not stop the same device being chosen in two sections (e.g. members + spares); `zpool create` rejects it. Cheap client-side cross-field validation if it annoys. Ref: src/components/dialogs.tsx.
- [ ] FormDialog init-on-open-transition (D15) dropped the old re-init-on-fields-change safety net; harmless today (every form mounts fresh per open) but if a direct form→form transition is ever built, values would leak between dialogs. Re-add a reset guard then. Ref: src/components/dialogs.tsx `wasOpen`.
