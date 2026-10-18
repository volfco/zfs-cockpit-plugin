# Decision Log

- **D1 (major)** Coverage model = "complete via generic UI" (user-selected): dedicated dialogs for lifecycle ops, one generic property editor for ALL `zfs get/set/inherit` (incl. plugin/user properties), typed wrappers for every subcommand in service.ts, raw `zfs`/`zpool` console as escape hatch. Why: literal per-subcommand dialogs ≈ 3x the code for near-zero tail usage; generic mechanisms cover 100% of the surface. Ref: plan.md Define.
- **D2 (major)** Parse stable text/machine forms (`-H`, `-Hp`, `zpool status` tree) instead of OpenZFS 2.3 `--json`: JSON is 2.3-only and the target floor is 2.2, so JSON would mean dual parser paths. Ref: test/fixtures/raw/zpool-json.txt.
- **D3 (minor)** `pkg/lib` copied from the hpssa checkout (same cockpit repo stamp) rather than re-fetched from GitHub. Ref: hpssa Makefile COCKPIT_REPO_STAMP.
- **D4 (minor)** Live validation uses file-vdev scratch pools under `/tmp/zfs-fixtures/` on colum@203.0.113.139; host pools `hdd0`/`ssd1` and real disks are off limits. Ref: assumptions.md.
- **D5 (minor)** Scaffold copied from hpssa verbatim; placeholder `src/app.tsx` uses PF6 `Content` (not `Text`, which PF6 6.5.0 removed) and the build emits per-language `po.<lang>.js`/`po.manifest.<lang>.js` exactly like hpssa (no aggregate `po.js`). Ref: hpssa build.js cockpit-po-plugin.
