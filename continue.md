# Continue

Forward-looking pointers for the ZFS Cockpit plugin. Completed work lives in
decisions.md; deferred work lives in todo.md.

## Where to look

- `decisions.md` — decision log (D1–D15). Read before changing a design.
- `todo.md` — deferred follow-ups and known risks.
- `plan.md` — Six Sigma define/measure/analyze/improve/control for the build.
- `Justfile` — `just check` (local gate: tsc, eslint, parser/wrapper/argv checks,
  build), `just ui-check` (mocked browser test), live validation-host recipes.

## Current state

- All local gates green (`just check`, `just ui-check`); latest release is tag
  `v0.1.3` (D17: property-edit modal uses a `BOOLEAN_PROPS` set instead of
  value-based detection, so enum props like compression accept zstd/lz4).
  `just tag <version>` tags and pushes; packages derive the version from the tag.

## Next up

- [ ] `BOOLEAN_PROPS` in propertiesPanel.tsx is hand-maintained — verify it
      against a live `zfs get -H all` dump (D17 shortcut).
- [ ] Extend the device multi-select to existing-pool actions (add vdev/cache/
      spare, attach, replace) — still free-text. Ref: todo.md.
- [ ] Decide whether D15's disk filter should also hide disks holding non-ZFS
      filesystems (currently only pool members are hidden). Ref: todo.md.
