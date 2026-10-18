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
