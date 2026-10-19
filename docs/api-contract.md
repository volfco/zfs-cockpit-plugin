# API Contract (src layer)

Stable interface that UI code is written against. `service.ts` MUST export exactly
these names; signatures follow the conventions below.

## Conventions

- Runners use `cockpit.spawn(['zfs'|'zpool', ...args], { err: 'message', superuser: 'require' })`.
- Every wrapper takes an options object mirroring its CLI flags (`-f` → `{force: true}`,
  `-o k=v` → `{properties: Record<string,string>}`), returns `Promise<string>` (stdout),
  and logs a human `reason` string into the command log.
- Wrappers are thin argv builders: no shell strings, no extra validation beyond what
  the CLI enforces. Empty/undefined options are omitted from argv.
- Names: `pool<Op>` for zpool, `ds<Op>` for zfs. Verb mirrors the subcommand.
  (`zpool create` → `poolCreate`, `zfs snapshot` → `dsSnapshot`.)

## Command log (hpssa-compatible)

`CommandLogEntry { id, timestamp, reason, args, bin, status: 'pending'|'success'|'error', output?, error?, durationMs? }`
plus `getCommandLog()`, `clearCommandLog()`, `setLogDiscovery(on)`, `isLogDiscovery()`,
`subscribeCommandLog(cb): () => void`. Discovery calls pass `{ discovery: true }`.

## Runners & raw console

`runZfs(args, reason?)`, `runZpool(args, reason?)`, `runShell(command, reason?)`
(logged `sh -c` runner for composed send/receive pipelines and file redirects —
decisions.md D8/D9), `runCommandLine(cmdline)` (raw
console entry: tokenizes like hpssa, strips optional leading `zfs `/`zpool `, dispatches),
`tokenize(cmdline)`.

## Version & capability gating

`getVersion(): ZfsVersion | null`, `hasCapability(name: string): boolean`,
`CAPABILITY_LIST: string[]`, `refreshVersion(): Promise<ZfsVersion>`.
Capability names: `zpool.wait`, `zpool.resilver`, `zpool.prefetch`, `zpool.ddtprune`,
`zpool.trim`, `zpool.initialize`, `zpool.checkpoint`, `zpool.split`, `zpool.rewind` (import --rewind-to-checkpoint),
`zpool.status-json` (2.3, unused but detectable), `zfs.wait`, `zfs.redact`, `zfs.rewrite`,
`zfs.program`, `zfs.bookmark`, `zfs.send-redact`, `zfs.change-key`, `zfs.project`.
Gate by parsed `zfs --version` (major/minor) per the table in `service.ts`; UI hides
or disables (with tooltip) entries whose capability is false.

## Fetchers (return parsed models from src/types.ts)

- `fetchOverview(): Promise<SystemOverview>` — pools (incl. vdev trees, scan lines,
  list columns, pool properties) + dataset list (all types, recursive) + version.
- `fetchPoolStatus(name): Promise<Pool>`, `fetchIostat(name?): Promise<PoolIostat[]>`,
  `fetchPoolProperties(name): Promise<PoolProperty[]>`,
  `fetchVdevProperties(pool, vdev): Promise<PoolProperty[]>`,
  `fetchPoolHistory(opts?: { pool?: string; incremental?: boolean }): Promise<HistoryEntry[]>`,
  `fetchPoolEvents(opts?: { pool?: string; verbose?: boolean }): Promise<EventEntry[]>`,
  `fetchImportablePools(searchDir?: string): Promise<ImportablePool[]>`.
- `fetchDatasetList(opts?: { types?, root?, depth? }): Promise<Dataset[]>`,
  `fetchDatasetProperties(name, opts?): Promise<DatasetProperty[]>`,
  `fetchSpace(name): Promise<SpaceEntry[]>`, `fetchHolds(snap, recursive?): Promise<HoldEntry[]>`,
  `fetchUsage(kind: 'userspace'|'groupspace'|'projectspace', target): Promise<UsageEntry[]>`,
  `sendDryRun(args: string[]): Promise<SendInfo>` (`zfs send -nP`, parsed),
  `fetchDiff(snapshot, target?): Promise<DiffEntry[]>`.
- Every fetcher is logged with `discovery: true`.

## Wrappers — required exports (1:1 with captured man surface)

zpool (`test/fixtures/raw/help-toplevel.txt` zpool section):
`poolCreate, poolDestroy, poolAdd, poolRemove, poolLabelclear, poolCheckpoint,
poolPrefetch, poolList, poolIostat, poolStatus, poolOnline, poolOffline, poolClear,
poolReopen, poolAttach, poolDetach, poolReplace, poolSplit, poolInitialize,
poolResilver, poolScrub (start|stop|pause|resume via opts), poolTrim, poolImport,
poolExport, poolUpgrade, poolReguid, poolHistory, poolEvents, poolSet, poolGet,
poolSync, poolWait, poolDdtprune`.

zfs: `dsVersion, dsCreate, dsDestroy, dsSnapshot, dsRollback, dsClone, dsPromote,
dsRename, dsBookmark, dsDiff, dsList, dsSet, dsGet, dsInherit, dsUpgrade, dsUserspace,
dsGroupspace, dsProjectspace, dsProject, dsMount, dsUnmount, dsShare, dsUnshare,
dsSend, dsReceive, dsRedact, dsAllow, dsUnallow, dsHold, dsHolds, dsRelease,
dsLoadKey, dsUnloadKey, dsChangeKey, dsProgram, dsRewrite, dsWait`.

Long-running ops (`scrub -w`, `initialize -w`, `trim -w`, `wait`, `send`, `receive`)
must be spawnable without blocking the UI: expose both a fire-and-forget form and an
optional stream/progress hook (`spawnStream` returning cockpit promise with
`stream()` support is acceptable for send/receive progress).

## Destructive-op markers

`export const DESTRUCTIVE_OPS: Set<string>` — informational checklist of
destructive wrapper names (incl. destroy, export, labelclear, split, reguid,
checkpoint discard, receive with force, unload-key, rename with `-f`, change-key,
redact, ddtprune, rollback). It does NOT drive UI gating: typed-confirmation is
decided per action in `src/components/actions.tsx` / `datasetActions.tsx`.
