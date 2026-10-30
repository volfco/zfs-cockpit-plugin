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

- All local gates green (`just check`, `just ui-check`); working tree contains
  the create-pool device multi-select change (decisions.md D15), uncommitted.

## Next up

- [ ] Extend the device multi-select to existing-pool actions (add vdev/cache/
      spare, attach, replace) — still free-text. Ref: todo.md.
- [ ] Decide whether D15's disk filter should also hide disks holding non-ZFS
      filesystems (currently only pool members are hidden). Ref: todo.md.
