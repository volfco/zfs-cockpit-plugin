import cockpit from 'cockpit';
import {
    parseZpoolStatus, parseZpoolImport, parseZpoolList, parseZpoolIostat,
    parseZpoolGet, parseZpoolHistory, parseZpoolEvents
} from './zpool';
import {
    parseZfsList, parseZfsGet, parseZfsSpace, parseZfsHolds,
    parseZfsSendDryRun, parseZfsDiff
} from './zfs';
import type {
    CommandLogEntry, Dataset, DatasetProperty, DiffEntry, EventEntry, HistoryEntry,
    HoldEntry, ImportablePool, Pool, PoolIostat, PoolProperty, SendInfo, SpaceEntry,
    SystemOverview, UsageEntry, ZfsVersion
} from './types';

export type { CommandLogEntry };

// ---------------------------------------------------------------------------
// Command log — every zfs/zpool invocation is recorded with a "why" reason.
// The CommandLog UI subscribes to this and renders entries as bash snippets.
// ---------------------------------------------------------------------------

const commandLog: CommandLogEntry[] = [];
const logSubscribers = new Set<() => void>();
let nextId = 1;
// Discovery commands fired by fetchers are noisy and not user-initiated;
// skip them by default. The UI exposes a toggle to include them.
let logDiscovery = false;

export function getCommandLog(): CommandLogEntry[] {
    return commandLog;
}

export function clearCommandLog(): void {
    commandLog.length = 0;
    notifyLog();
}

export function setLogDiscovery(on: boolean): void {
    logDiscovery = on;
}

export function isLogDiscovery(): boolean {
    return logDiscovery;
}

export function subscribeCommandLog(cb: () => void): () => void {
    logSubscribers.add(cb);
    return () => logSubscribers.delete(cb);
}

function notifyLog(): void {
    for (const cb of logSubscribers) cb();
}

// ---------------------------------------------------------------------------
// Low-level command runners
// ---------------------------------------------------------------------------

interface RunOpts {
    reason?: string | undefined;
    discovery?: boolean | undefined;
    // Long ops stream output as it arrives; chunks are split into lines.
    onProgress?: ((line: string) => void) | undefined;
}

function errText(e: unknown): string {
    if (e instanceof Error) return e.message;
    if (typeof e === 'object' && e !== null && 'message' in e)
        return String((e as { message: unknown }).message);
    return String(e);
}

async function run(bin: 'zfs' | 'zpool', args: string[], reason?: string | RunOpts): Promise<string> {
    const opts: RunOpts = typeof reason === 'string' ? { reason } : (reason ?? {});
    const skip = opts.discovery && !logDiscovery;
    const entry: CommandLogEntry | null = skip
        ? null
        : {
            id: nextId++,
            timestamp: Date.now(),
            reason: opts.reason ?? `Run ${bin} command`,
            args: [bin, ...args],
            bin,
            status: 'pending',
        };
    if (entry) {
        commandLog.push(entry);
        notifyLog();
    }
    const start = Date.now();
    try {
        const proc = cockpit.spawn([bin, ...args], { err: 'message', superuser: 'require' });
        const emit = opts.onProgress;
        let flush: () => void = () => undefined;
        if (emit) {
            let buffered = '';
            proc.stream(data => {
                buffered += data;
                const lines = buffered.split('\n');
                buffered = lines.pop() ?? '';
                for (const line of lines) emit(line);
            });
            flush = () => {
                if (buffered) emit(buffered);
            };
        }
        const output = await proc;
        flush();
        if (entry) {
            entry.status = 'success';
            entry.output = output;
            entry.durationMs = Date.now() - start;
            notifyLog();
        }
        return output;
    } catch (e: unknown) {
        if (entry) {
            entry.status = 'error';
            entry.error = errText(e);
            entry.durationMs = Date.now() - start;
            notifyLog();
        }
        throw e;
    }
}

export function runZfs(args: string[], reason?: string | RunOpts): Promise<string> {
    return run('zfs', args, reason);
}

export function runZpool(args: string[], reason?: string | RunOpts): Promise<string> {
    return run('zpool', args, reason);
}

// Splits a free-form command line into argv. Strips an optional leading
// "zfs "/"zpool " so the user can paste either form. Quoted arguments are honored.
export function tokenize(cmdline: string): string[] {
    const trimmed = cmdline.trim().replace(/^(zfs|zpool)\s+/i, '');
    const out: string[] = [];
    let buf = '';
    let inQuote: '"' | "'" | null = null;
    for (const ch of trimmed) {
        if (inQuote) {
            if (ch === inQuote) inQuote = null;
            else buf += ch;
        } else if (ch === '"' || ch === "'") {
            inQuote = ch;
        } else if (/\s/.test(ch)) {
            if (buf) { out.push(buf); buf = '' }
        } else {
            buf += ch;
        }
    }
    if (buf) out.push(buf);
    return out;
}

// Raw console entry: dispatch on the leading binary ("zfs " or "zpool "). The
// subcommand namespaces overlap ("list", "get", "set", "upgrade", "wait",
// "version" exist on both CLIs), so a command line without its binary is an
// error rather than an ambiguous guess.
export async function runCommandLine(cmdline: string): Promise<string> {
    const trimmed = cmdline.trim();
    const first = (trimmed.match(/^\S+/) ?? [''])[0];
    const bin = first.toLowerCase();
    if (bin !== 'zfs' && bin !== 'zpool')
        throw new Error(`Unknown command "${first}": command lines must start with "zfs " or "zpool "`);
    return run(bin, tokenize(trimmed), 'Manual command entered in UI');
}

// ---------------------------------------------------------------------------
// Targeting helpers
// ---------------------------------------------------------------------------

// Snapshot/bookmark names are built from the dataset plus a member name.
export const snapTarget = (dataset: string, snap: string): string => `${dataset}@${snap}`;
export const bookmarkTarget = (dataset: string, bookmark: string): string => `${dataset}#${bookmark}`;

// Accepts one or many CLI targets and flattens them to argv.
function targetArgs(target: string | string[]): string[] {
    return Array.isArray(target) ? target : [target];
}

// Builds key=value pairs, omitting empty values.
function kv(params: Record<string, string | number | boolean | undefined | null>): string[] {
    const out: string[] = [];
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        out.push(`${k}=${String(v)}`);
    }
    return out;
}

// Expands a property map into repeated "<flag> key=value" argv pairs.
function propArgs(flag: string, properties?: Record<string, string>): string[] {
    const out: string[] = [];
    for (const [k, v] of Object.entries(properties ?? {})) out.push(flag, `${k}=${v}`);
    return out;
}

// Repeats a flag once per value ("a, b" -> ["-x", "a", "-x", "b"]).
function flagArgs(flag: string, values?: string | string[]): string[] {
    if (values === undefined) return [];
    return targetArgs(values).flatMap(v => [flag, v]);
}

function commaList(values: string | string[]): string {
    return Array.isArray(values) ? values.join(',') : values;
}

// ---------------------------------------------------------------------------
// Version & capability gating
// ---------------------------------------------------------------------------

// Minimum OpenZFS version (major, minor) that introduced each capability,
// from the per-subcommand captures in test/fixtures/raw/help/. Capabilities
// without a pinned baseline (zpool.rewind) are assumed present: an unknown
// baseline must not hide UI entries.
const CAPABILITY_MIN_VERSION: Record<string, [number, number]> = {
    'zpool.wait': [2, 1],
    'zpool.resilver': [2, 2],
    'zpool.prefetch': [2, 3],
    'zpool.ddtprune': [2, 3],
    'zpool.trim': [2, 0],
    'zpool.initialize': [2, 0],
    'zpool.checkpoint': [0, 8],
    'zpool.split': [0, 8],
    'zpool.status-json': [2, 3],
    'zfs.wait': [2, 1],
    'zfs.redact': [2, 0],
    'zfs.rewrite': [2, 3],
    'zfs.program': [0, 7],
    'zfs.bookmark': [0, 8],
    'zfs.send-redact': [2, 0],
    'zfs.change-key': [0, 8],
    'zfs.project': [2, 0],
};

export const CAPABILITY_LIST: string[] = [
    'zpool.wait', 'zpool.resilver', 'zpool.prefetch', 'zpool.ddtprune', 'zpool.trim',
    'zpool.initialize', 'zpool.checkpoint', 'zpool.split', 'zpool.rewind', 'zpool.status-json',
    'zfs.wait', 'zfs.redact', 'zfs.rewrite', 'zfs.program', 'zfs.bookmark',
    'zfs.send-redact', 'zfs.change-key', 'zfs.project',
];

let cachedVersion: ZfsVersion | null = null;

export function getVersion(): ZfsVersion | null {
    return cachedVersion;
}

// Conservative: when the running version or a baseline is unknown, the
// capability is assumed present (api-contract.md).
export function hasCapability(name: string): boolean {
    if (!cachedVersion) return true;
    const min = CAPABILITY_MIN_VERSION[name];
    if (!min) return true;
    const major = parseInt(cachedVersion.major, 10);
    const minor = parseInt(cachedVersion.minor, 10);
    if (Number.isNaN(major) || Number.isNaN(minor)) return true;
    return major > min[0] || (major === min[0] && minor >= min[1]);
}

export async function refreshVersion(): Promise<ZfsVersion> {
    const output = await runZfs(['--version'], { reason: 'Detect installed ZFS version', discovery: true });
    const line = output.trim().split('\n')[0] ?? '';
    const m = line.match(/zfs-(\d+)\.(\d+)\.(\d+)/);
    if (!m) throw new Error(`Cannot parse ZFS version from "${line}"`);
    cachedVersion = { major: m[1], minor: m[2], patch: m[3], raw: line };
    return cachedVersion;
}

// ---------------------------------------------------------------------------
// Fetchers — every call is logged with { discovery: true }
// ---------------------------------------------------------------------------

// zpool list columns fetched per pool (CLI spellings). parseZpoolList maps
// them positionally to its own column names.
const POOL_LIST_COLUMNS = 'name,size,alloc,free,checkpoint,expandsz,fragmentation,cap,dedup,health,altroot';
const POOL_LIST_PARSE_COLUMNS = [
    'name', 'size', 'alloc', 'free', 'checkpoint', 'expandsize', 'frag',
    'cap', 'dedup', 'health', 'altroot',
];

// The zpool list row supplies the capacity columns; the status parse wins for
// state, scan lines and the vdev tree.
function applyListColumns(pool: Pool, row: Pool): void {
    pool.size = row.size;
    pool.alloc = row.alloc;
    pool.free = row.free;
    pool.checkpoint = row.checkpoint;
    pool.expandSize = row.expandSize;
    pool.frag = row.frag;
    pool.cap = row.cap;
    pool.dedup = row.dedup;
    pool.health = row.health;
    pool.altRoot = row.altRoot;
    pool.autoTrim = row.autoTrim;
    pool.comment = row.comment;
}

export async function fetchOverview(): Promise<SystemOverview> {
    const version = await refreshVersion().catch(() => null);
    const listOutput = await runZpool(['list', '-H', '-o', POOL_LIST_COLUMNS],
                                      { reason: 'Discover pools and capacity', discovery: true });
    const rows = parseZpoolList(listOutput, POOL_LIST_PARSE_COLUMNS);
    const datasetOutput = await runZfs(['list', '-H', '-o', 'name,type,used,avail,refer,mountpoint', '-t', 'all', '-r'],
                                       { reason: 'Discover all datasets', discovery: true });
    const pools = await Promise.all(rows.map(async row => {
        const [statusOutput, propertyOutput] = await Promise.all([
            runZpool(['status', '-P', row.name],
                     { reason: `Read pool status for ${row.name}`, discovery: true }).catch(() => ''),
            runZpool(['get', '-H', 'all', row.name],
                     { reason: `Read pool properties for ${row.name}`, discovery: true }).catch(() => ''),
        ]);
        const pool = parseZpoolStatus(statusOutput)[0] ?? row;
        applyListColumns(pool, row);
        pool.properties = parseZpoolGet(propertyOutput);
        return pool;
    }));
    return { version, pools, datasets: parseZfsList(datasetOutput) };
}

export async function fetchPoolStatus(name: string): Promise<Pool> {
    const [statusOutput, listOutput, propertyOutput] = await Promise.all([
        runZpool(['status', '-P', name], { reason: `Read pool status for ${name}`, discovery: true }),
        runZpool(['list', '-H', '-o', POOL_LIST_COLUMNS, name],
                 { reason: `Read capacity columns for ${name}`, discovery: true }),
        runZpool(['get', '-H', 'all', name], { reason: `Read pool properties for ${name}`, discovery: true }),
    ]);
    const pool = parseZpoolStatus(statusOutput)[0];
    if (!pool) throw new Error(`zpool status returned no pool named ${name}`);
    const row = parseZpoolList(listOutput, POOL_LIST_PARSE_COLUMNS)[0];
    if (row) applyListColumns(pool, row);
    pool.properties = parseZpoolGet(propertyOutput);
    return pool;
}

export async function fetchIostat(name?: string): Promise<PoolIostat[]> {
    let names: string[];
    if (name) {
        names = [name];
    } else {
        const output = await runZpool(['list', '-H', '-o', 'name'],
                                      { reason: 'List pool names for I/O statistics', discovery: true });
        names = parseZpoolList(output, ['name']).map(p => p.name);
    }
    return Promise.all(names.map(async poolName => {
        const output = await runZpool(['iostat', '-H', '-v', poolName],
                                      { reason: `Read I/O statistics for pool ${poolName}`, discovery: true });
        return { name: poolName, rows: parseZpoolIostat(output) };
    }));
}

export async function fetchPoolProperties(name: string): Promise<PoolProperty[]> {
    const output = await runZpool(['get', '-H', 'all', name],
                                  { reason: `Read properties of pool ${name}`, discovery: true });
    return parseZpoolGet(output);
}

export async function fetchVdevProperties(pool: string, vdev: string): Promise<PoolProperty[]> {
    const output = await runZpool(['get', '-H', 'all', pool, vdev],
                                  { reason: `Read properties of ${vdev} in pool ${pool}`, discovery: true });
    return parseZpoolGet(output);
}

export async function fetchPoolHistory(opts: { pool?: string; incremental?: boolean } = {}): Promise<HistoryEntry[]> {
    const args = ['history', ...(opts.incremental ? ['-i'] : []), ...(opts.pool ? [opts.pool] : [])];
    const output = await runZpool(args, { reason: `Read pool history${opts.pool ? ` for ${opts.pool}` : ''}`, discovery: true });
    return parseZpoolHistory(output);
}

export async function fetchPoolEvents(opts: { pool?: string; verbose?: boolean } = {}): Promise<EventEntry[]> {
    const args = ['events', ...(opts.verbose ? ['-v'] : []), ...(opts.pool ? [opts.pool] : [])];
    const output = await runZpool(args, { reason: `Read pool events${opts.pool ? ` for ${opts.pool}` : ''}`, discovery: true });
    return parseZpoolEvents(output);
}

export async function fetchImportablePools(searchDir?: string): Promise<ImportablePool[]> {
    const args = ['import', ...(searchDir ? ['-d', searchDir] : [])];
    let output: string;
    try {
        output = await runZpool(args, {
            reason: `Search for importable pools${searchDir ? ` in ${searchDir}` : ''}`, discovery: true
        });
    } catch (e: unknown) {
        // Nothing found is not an error; a pool that cannot be imported
        // rejects with the CLI message ("cannot import 'x': ...").
        const message = errText(e);
        if (/^cannot import\b/i.test(message)) throw e;
        if (/no pools available/i.test(message)) return [];
        throw e;
    }
    if (/no pools available/i.test(output)) return [];
    return parseZpoolImport(output);
}

export async function fetchDatasetList(opts: { types?: string | string[]; root?: string; depth?: number } = {}): Promise<Dataset[]> {
    const args = ['list', '-H', '-o', 'name,type,used,avail,refer,mountpoint'];
    if (opts.types !== undefined) args.push('-t', commaList(opts.types));
    if (opts.depth !== undefined) args.push('-d', String(opts.depth));
    else args.push('-r');
    if (opts.root !== undefined) args.push(opts.root);
    const output = await runZfs(args, {
        reason: `List datasets${opts.root ? ` under ${opts.root}` : ''}`, discovery: true
    });
    return parseZfsList(output);
}

export async function fetchDatasetProperties(
    name: string,
    opts: {
        properties?: 'all' | string | string[]; fields?: string[]; sources?: string[];
        types?: string[]; recursive?: boolean; depth?: number; parsable?: boolean;
    } = {},
): Promise<DatasetProperty[]> {
    const args = ['get', '-H'];
    if (opts.parsable) args.push('-p');
    if (opts.recursive) args.push('-r');
    if (opts.depth !== undefined) args.push('-d', String(opts.depth));
    if (opts.fields) args.push('-o', opts.fields.join(','));
    if (opts.types) args.push('-t', opts.types.join(','));
    if (opts.sources) args.push('-s', opts.sources.join(','));
    args.push(typeof opts.properties === 'string'
        ? opts.properties
        : Array.isArray(opts.properties) ? opts.properties.join(',') : 'all', name);
    const output = await runZfs(args, { reason: `Read properties of ${name}`, discovery: true });
    return parseZfsGet(output);
}

export async function fetchSpace(name: string): Promise<SpaceEntry[]> {
    // "space" is the documented zfs list -o shorthand for the used-by-*
    // breakdown (name,avail,used,usedsnap,usedds,usedrefreserv,usedchild).
    const output = await runZfs(['list', '-H', '-o', 'space', name],
                                { reason: `Read space usage for ${name}`, discovery: true });
    return parseZfsSpace(output);
}

export async function fetchHolds(snapshot: string, recursive?: boolean): Promise<HoldEntry[]> {
    const args = ['holds', '-H', ...(recursive ? ['-r'] : []), snapshot];
    const output = await runZfs(args, { reason: `Read holds on ${snapshot}`, discovery: true });
    return parseZfsHolds(output);
}

// zfs userspace -H rows: type, name, used, quota [, objused, objquota].
function parseUsageRows(output: string): UsageEntry[] {
    const entries: UsageEntry[] = [];
    for (const raw of output.split('\n')) {
        if (!raw.trim() || !raw.includes('\t')) continue;
        const f = raw.split('\t');
        entries.push({
            type: f[0],
            name: f[1],
            used: f[2] ?? '',
            quota: f[3] ?? '',
            objUsed: f[4] ?? '',
            objQuota: f[5] ?? '',
        });
    }
    return entries;
}

export async function fetchUsage(
    kind: 'userspace' | 'groupspace' | 'projectspace', target: string
): Promise<UsageEntry[]> {
    const output = await runZfs([kind, '-H', target],
                                { reason: `Read ${kind} for ${target}`, discovery: true });
    return parseUsageRows(output);
}

export async function sendDryRun(args: string[]): Promise<SendInfo> {
    const output = await runZfs(['send', '-nP', ...args],
                                { reason: `Dry-run zfs send ${args.join(' ')}`, discovery: true });
    return parseZfsSendDryRun(output);
}

export async function fetchDiff(snapshot: string, target?: string): Promise<DiffEntry[]> {
    const args = ['diff', '-H', '-t', snapshot, ...(target ? [target] : [])];
    const output = await runZfs(args, {
        reason: `Compare ${snapshot} with ${target ?? 'the live dataset'}`, discovery: true
    });
    return parseZfsDiff(output);
}

// ---------------------------------------------------------------------------
// Destructive-op markers — the UI requires typed confirmation for these.
// "receive with force" and "rename with -f" are covered by dsReceive/dsRename.
// ---------------------------------------------------------------------------

export const DESTRUCTIVE_OPS: Set<string> = new Set([
    'poolDestroy', 'poolExport', 'poolLabelclear', 'poolSplit', 'poolReguid',
    'poolCheckpoint', 'poolDdtprune', 'dsDestroy', 'dsReceive', 'dsUnloadKey',
    'dsRename', 'dsChangeKey', 'dsRedact',
]);

// ---------------------------------------------------------------------------
// zpool wrappers — thin argv builders for every zpool subcommand. Flag letters
// follow test/fixtures/raw/help-toplevel.txt and the per-subcommand captures.
// ---------------------------------------------------------------------------

export const poolCreate = (opts: {
    name: string; vdevs: string[]; files?: string[];
    properties?: Record<string, string>; fsProperties?: Record<string, string>;
    mountpoint?: string; altroot?: string; force?: boolean; noFeatures?: boolean;
    dryrun?: boolean; tempName?: string;
}) => {
    // File paths are ordinary vdev arguments to `zpool create`.
    const vdevs = [...opts.vdevs, ...(opts.files ?? [])];
    const args = [
        'create', ...(opts.force ? ['-f'] : []), ...(opts.noFeatures ? ['-d'] : []),
        ...(opts.dryrun ? ['-n'] : []), ...propArgs('-o', opts.properties),
        ...propArgs('-O', opts.fsProperties), ...(opts.mountpoint ? ['-m', opts.mountpoint] : []),
        ...(opts.altroot ? ['-R', opts.altroot] : []), ...(opts.tempName ? ['-t', opts.tempName] : []),
        opts.name, ...vdevs,
    ];
    return runZpool(args, `Create pool ${opts.name} from ${vdevs.length} vdev(s)`);
};

export const poolDestroy = (opts: { pool: string; force?: boolean }) =>
    runZpool(['destroy', ...(opts.force ? ['-f'] : []), opts.pool], `Destroy pool ${opts.pool}`);

export const poolAdd = (opts: {
    pool: string; vdevs: string[]; properties?: Record<string, string>;
    force?: boolean; dryrun?: boolean; allowAshiftMismatch?: boolean;
    allowInUse?: boolean; allowReplicationMismatch?: boolean;
}) => {
    const args = [
        'add', ...(opts.force ? ['-f'] : []), ...(opts.dryrun ? ['-n'] : []),
        ...(opts.allowAshiftMismatch ? ['--allow-ashift-mismatch'] : []),
        ...(opts.allowInUse ? ['--allow-in-use'] : []),
        ...(opts.allowReplicationMismatch ? ['--allow-replication-mismatch'] : []),
        ...propArgs('-o', opts.properties), opts.pool, ...opts.vdevs,
    ];
    return runZpool(args, `Add ${opts.vdevs.length} vdev(s) to pool ${opts.pool}`);
};

export const poolRemove = (opts: {
    pool: string; devices?: string[]; stop?: boolean;
    noop?: boolean; parsable?: boolean; wait?: boolean;
}) => {
    if (opts.stop) return runZpool(['remove', '-s', opts.pool], `Cancel device removal on pool ${opts.pool}`);
    const args = [
        'remove', ...(opts.noop ? ['-n'] : []), ...(opts.parsable ? ['-p'] : []),
        ...(opts.wait ? ['-w'] : []), opts.pool, ...(opts.devices ?? []),
    ];
    return runZpool(args, `Remove device(s) ${(opts.devices ?? []).join(' ')} from pool ${opts.pool}`);
};

export const poolLabelclear = (opts: { vdev: string; force?: boolean }) =>
    runZpool(['labelclear', ...(opts.force ? ['-f'] : []), opts.vdev], `Clear label on ${opts.vdev}`);

export const poolCheckpoint = (opts: { pool: string | string[]; discard?: boolean; wait?: boolean }) =>
    runZpool(['checkpoint', ...(opts.discard ? ['-d'] : []), ...(opts.discard && opts.wait ? ['-w'] : []),
        ...targetArgs(opts.pool)], opts.discard ? 'Discard pool checkpoint' : 'Create pool checkpoint');

export const poolPrefetch = (opts: { pool: string; type: string; typeOpts?: string[] }) =>
    runZpool(['prefetch', '-t', opts.type, ...(opts.typeOpts ?? []), opts.pool], `Prefetch ${opts.type} data for pool ${opts.pool}`);

export const poolList = (opts: {
    pool?: string; properties?: string | string[]; scripting?: boolean;
    parsable?: boolean; verbose?: boolean; interval?: number; count?: number;
} = {}) => {
    const args = ['list'];
    if (opts.scripting) args.push('-H');
    if (opts.parsable) args.push('-p');
    if (opts.verbose) args.push('-v');
    if (opts.properties !== undefined) args.push('-o', commaList(opts.properties));
    if (opts.pool !== undefined) args.push(opts.pool);
    if (opts.interval !== undefined) args.push(String(opts.interval), String(opts.count ?? 1));
    return runZpool(args, 'List pools');
};

export const poolIostat = (opts: {
    targets?: string[]; interval?: number; count?: number;
    verbose?: boolean; parsable?: boolean; headersOnce?: boolean;
} = {}) => {
    const args = ['iostat'];
    if (opts.verbose) args.push('-v');
    if (opts.parsable) args.push('-p');
    args.push(...(opts.targets ?? []));
    if (opts.interval !== undefined) {
        if (opts.headersOnce) args.push('-n');
        args.push(String(opts.interval), String(opts.count ?? 1));
    }
    return runZpool(args, 'Read pool I/O statistics');
};

export const poolStatus = (opts: {
    pool?: string; verbose?: boolean; parsable?: boolean; onlyUnhealthy?: boolean;
    initialization?: boolean; power?: boolean; interval?: number; count?: number;
} = {}) => {
    const args = ['status'];
    if (opts.verbose) args.push('-v');
    if (opts.parsable) args.push('-p');
    if (opts.onlyUnhealthy) args.push('-e');
    if (opts.initialization) args.push('-i');
    if (opts.power) args.push('--power');
    if (opts.pool !== undefined) args.push(opts.pool);
    if (opts.interval !== undefined) args.push(String(opts.interval), String(opts.count ?? 1));
    return runZpool(args, `Show status of ${opts.pool ?? 'all pools'}`);
};

export const poolOnline = (opts: { pool: string; devices: string | string[]; expand?: boolean; power?: boolean }) =>
    runZpool(['online', ...(opts.power ? ['--power'] : []), ...(opts.expand ? ['-e'] : []),
        opts.pool, ...targetArgs(opts.devices)], `Bring device(s) online in pool ${opts.pool}`);

export const poolOffline = (opts: { pool: string; devices: string | string[]; force?: boolean; temporary?: boolean; power?: boolean }) =>
    runZpool(['offline', ...(opts.power ? ['--power'] : []), ...(opts.force ? ['-f'] : []),
        ...(opts.temporary ? ['-t'] : []), opts.pool, ...targetArgs(opts.devices)],
             `Take device(s) offline in pool ${opts.pool}`);

export const poolClear = (opts: { pool: string; devices?: string[]; power?: boolean }) =>
    runZpool(['clear', ...(opts.power ? ['--power'] : []), opts.pool, ...(opts.devices ?? [])],
             `Clear device errors on pool ${opts.pool}`);

export const poolReopen = (opts: { pool: string; noScrubRestart?: boolean }) =>
    runZpool(['reopen', ...(opts.noScrubRestart ? ['-n'] : []), opts.pool], `Reopen devices in pool ${opts.pool}`);

export const poolAttach = (opts: {
    pool: string; device: string; newDevice: string;
    force?: boolean; spare?: boolean; wait?: boolean; properties?: Record<string, string>;
}) => runZpool(['attach', ...(opts.force ? ['-f'] : []), ...(opts.spare ? ['-s'] : []),
    ...(opts.wait ? ['-w'] : []), ...propArgs('-o', opts.properties),
    opts.pool, opts.device, opts.newDevice], `Attach ${opts.newDevice} to ${opts.device} in pool ${opts.pool}`);

export const poolDetach = (opts: { pool: string; device: string }) =>
    runZpool(['detach', opts.pool, opts.device], `Detach ${opts.device} from pool ${opts.pool}`);

export const poolReplace = (opts: {
    pool: string; device: string; newDevice?: string;
    force?: boolean; sequential?: boolean; wait?: boolean; properties?: Record<string, string>;
}) => runZpool(['replace', ...(opts.force ? ['-f'] : []), ...(opts.sequential ? ['-s'] : []),
    ...(opts.wait ? ['-w'] : []), ...propArgs('-o', opts.properties),
    opts.pool, opts.device, ...(opts.newDevice ? [opts.newDevice] : [])],
               `Replace ${opts.device} in pool ${opts.pool}${opts.newDevice ? ` with ${opts.newDevice}` : ''}`);

export const poolSplit = (opts: {
    pool: string; newPool: string; devices?: string[]; guid?: boolean; loadKey?: boolean;
    dryrun?: boolean; altroot?: string; mntopts?: string; properties?: Record<string, string>;
}) => {
    const args = [
        'split', ...(opts.guid ? ['-g'] : []), ...(opts.loadKey ? ['-l'] : []),
        ...(opts.dryrun ? ['-n'] : []), ...(opts.altroot ? ['-R', opts.altroot] : []),
        ...(opts.mntopts ? ['-o', opts.mntopts] : []), ...propArgs('-o', opts.properties),
        opts.pool, opts.newPool, ...(opts.devices ?? []),
    ];
    return runZpool(args, `Split pool ${opts.pool} into ${opts.newPool}`);
};

export const poolInitialize = (opts: {
    pool: string; devices?: string[];
    action?: 'start' | 'cancel' | 'suspend' | 'unmonitor'; wait?: boolean; onProgress?: (line: string) => void;
}) => {
    // -u (--uninit) clears the initialization state; plain starts or resumes.
    const action = opts.action === 'cancel'
        ? ['-c']
        : opts.action === 'suspend'
            ? ['-s']
            : opts.action === 'unmonitor' ? ['-u'] : [];
    const args = ['initialize', ...action, ...(opts.wait ? ['-w'] : []), opts.pool, ...(opts.devices ?? [])];
    return runZpool(args, { reason: `Initialize pool ${opts.pool} (${opts.action ?? 'start'})`, onProgress: opts.onProgress });
};

export const poolResilver = (opts: { pool: string | string[] }) =>
    runZpool(['resilver', ...targetArgs(opts.pool)], 'Start resilver');

export const poolScrub = (opts: {
    pool: string | string[]; action?: 'start' | 'stop' | 'pause' | 'resume';
    wait?: boolean; onProgress?: (line: string) => void;
}) => {
    // A paused scrub is resumed by the plain form; -s stops, -p pauses.
    const action = opts.action === 'stop' ? ['-s'] : opts.action === 'pause' ? ['-p'] : [];
    const args = ['scrub', ...action, ...(opts.wait ? ['-w'] : []), ...targetArgs(opts.pool)];
    return runZpool(args, { reason: `Scrub pool (${opts.action ?? 'start'})`, onProgress: opts.onProgress });
};

export const poolTrim = (opts: {
    pool: string; devices?: string[]; action?: 'start' | 'cancel' | 'suspend';
    secure?: boolean; rate?: string | number; wait?: boolean; onProgress?: (line: string) => void;
}) => {
    const action = opts.action === 'cancel' ? ['-c'] : opts.action === 'suspend' ? ['-s'] : [];
    const args = ['trim', ...(opts.secure ? ['-d'] : []), ...(opts.wait ? ['-w'] : []),
        ...(opts.rate !== undefined ? ['-r', String(opts.rate)] : []), ...action, opts.pool, ...(opts.devices ?? [])];
    return runZpool(args, { reason: `Trim pool ${opts.pool} (${opts.action ?? 'start'})`, onProgress: opts.onProgress });
};

export const poolImport = (opts: {
    pool?: string; newName?: string; searchDir?: string; cachefile?: string;
    all?: boolean; destroyed?: boolean; force?: boolean; recovery?: boolean;
    recoveryDryrun?: boolean; missingLog?: boolean; nomount?: boolean; loadKey?: boolean;
    altroot?: string; mntopts?: string; properties?: Record<string, string>; rewindToCheckpoint?: boolean;
} = {}) => {
    const args = ['import'];
    if (opts.searchDir !== undefined) args.push('-d', opts.searchDir);
    if (opts.cachefile !== undefined) args.push('-c', opts.cachefile);
    if (opts.destroyed) args.push('-D');
    if (opts.loadKey) args.push('-l');
    if (opts.force) args.push('-f');
    if (opts.missingLog) args.push('-m');
    if (opts.nomount) args.push('-N');
    if (opts.altroot !== undefined) args.push('-R', opts.altroot);
    if (opts.recovery) args.push('-F');
    if (opts.recovery && opts.recoveryDryrun) args.push('-n');
    if (opts.rewindToCheckpoint) args.push('--rewind-to-checkpoint');
    if (opts.mntopts !== undefined) args.push('-o', opts.mntopts);
    args.push(...propArgs('-o', opts.properties));
    if (opts.all) args.push('-a');
    if (opts.pool !== undefined) args.push(opts.pool);
    if (opts.newName !== undefined) args.push(opts.newName);
    return runZpool(args, `Import pool ${opts.pool ?? '(all found)'}`);
};

export const poolExport = (opts: { pool: string | string[]; all?: boolean; force?: boolean }) =>
    runZpool(['export', ...(opts.all ? ['-a'] : []), ...(opts.force ? ['-f'] : []), ...targetArgs(opts.pool)],
             'Export pool');

export const poolUpgrade = (opts: { pool?: string | string[]; all?: boolean; version?: string } = {}) =>
    runZpool(['upgrade', ...(opts.version !== undefined ? ['-V', opts.version] : []),
        ...(opts.all ? ['-a'] : []), ...targetArgs(opts.pool ?? [])], 'Upgrade pool feature set');

export const poolReguid = (opts: { pool: string; guid?: string }) =>
    runZpool(['reguid', ...kv({ g: opts.guid }), opts.pool], `Regenerate GUID for pool ${opts.pool}`);

export const poolHistory = (opts: { pool?: string | string[]; internal?: boolean; long?: boolean } = {}) =>
    runZpool(['history', ...(opts.internal ? ['-i'] : []), ...(opts.long ? ['-l'] : []), ...targetArgs(opts.pool ?? [])],
             'Read pool history');

export const poolEvents = (opts: { pool?: string; verbose?: boolean; follow?: boolean; clear?: boolean; scripting?: boolean } = {}) => {
    if (opts.clear) return runZpool(['events', '-c'], 'Clear the pool event log');
    const args = ['events'];
    if (opts.verbose) args.push('-v');
    if (opts.scripting) args.push('-H');
    if (opts.follow) args.push('-f');
    if (opts.pool !== undefined) args.push(opts.pool);
    return runZpool(args, 'Read pool events');
};

export const poolSet = (opts: { properties: Record<string, string>; pool: string; vdev?: string }) =>
    runZpool(['set', ...kv(opts.properties), opts.pool, ...(opts.vdev ? [opts.vdev] : [])],
             `Set ${Object.keys(opts.properties).join(' ')} on ${opts.vdev ?? opts.pool}`);

export const poolGet = (opts: {
    properties: 'all' | string | string[]; pool: string | string[];
    fields?: string | string[]; scripting?: boolean; parsable?: boolean;
}) => {
    const args = ['get'];
    if (opts.scripting) args.push('-H');
    if (opts.parsable) args.push('-p');
    if (opts.fields !== undefined) args.push('-o', commaList(opts.fields));
    args.push(commaList(opts.properties), ...targetArgs(opts.pool));
    return runZpool(args, 'Read pool properties');
};

export const poolSync = (opts: { pool?: string | string[] } = {}) =>
    runZpool(['sync', ...targetArgs(opts.pool ?? [])], 'Sync pool state to disk');

export const poolWait = (opts: {
    pool: string; activity?: string | string[]; interval?: number;
    scripting?: boolean; parsable?: boolean; timestamp?: 'u' | 'd'; onProgress?: (line: string) => void;
}) => {
    const args = ['wait'];
    if (opts.scripting) args.push('-H');
    if (opts.parsable) args.push('-p');
    if (opts.timestamp !== undefined) args.push('-T', opts.timestamp);
    if (opts.activity !== undefined) args.push('-t', commaList(opts.activity));
    args.push(opts.pool);
    if (opts.interval !== undefined) args.push(String(opts.interval));
    return runZpool(args, { reason: `Wait for background activity on pool ${opts.pool}`, onProgress: opts.onProgress });
};

export const poolDdtprune = (opts: { pool: string; days?: string | number; percentage?: string | number }) =>
    runZpool(['ddtprune', ...(opts.days !== undefined ? ['-d', String(opts.days)] : []),
        ...(opts.percentage !== undefined ? ['-p', String(opts.percentage)] : []), opts.pool],
             `Prune DDT entries on pool ${opts.pool}`);

// ---------------------------------------------------------------------------
// zfs wrappers — thin argv builders for every zfs subcommand. Flag letters
// follow test/fixtures/raw/help-toplevel.txt and the per-subcommand captures.
// ---------------------------------------------------------------------------

export const dsVersion = (opts: { json?: boolean } = {}) =>
    runZfs(['version', ...(opts.json ? ['-j'] : [])], 'Show zfs version');

export const dsCreate = (opts: {
    name: string; properties?: Record<string, string>; parents?: boolean; nomount?: boolean;
    dryrun?: boolean; parsable?: boolean; verbose?: boolean; volumeSize?: string;
    volblocksize?: string | number; sparse?: boolean;
}) => {
    const args = [
        'create', ...(opts.parents ? ['-p'] : []), ...(opts.nomount ? ['-u'] : []),
        ...(opts.dryrun ? ['-n'] : []), ...(opts.parsable ? ['-P'] : []), ...(opts.verbose ? ['-v'] : []),
        ...(opts.sparse ? ['-s'] : []), ...(opts.volblocksize !== undefined ? ['-b', String(opts.volblocksize)] : []),
        ...propArgs('-o', opts.properties), ...(opts.volumeSize ? ['-V', opts.volumeSize] : []), opts.name,
    ];
    return runZfs(args, `Create ${opts.volumeSize ? 'volume' : 'filesystem'} ${opts.name}`);
};

export const dsDestroy = (opts: {
    targets: string | string[]; force?: boolean; dryrun?: boolean; parsable?: boolean;
    recursive?: boolean; recursiveClones?: boolean; defer?: boolean; verbose?: boolean;
}) => {
    const args = [
        'destroy', ...(opts.force ? ['-f'] : []), ...(opts.dryrun ? ['-n'] : []),
        ...(opts.parsable ? ['-p'] : []), ...(opts.recursive ? ['-r'] : []),
        ...(opts.recursiveClones ? ['-R'] : []), ...(opts.defer ? ['-d'] : []),
        ...(opts.verbose ? ['-v'] : []), ...targetArgs(opts.targets),
    ];
    return runZfs(args, `Destroy ${targetArgs(opts.targets).join(' ')}`);
};

export const dsSnapshot = (opts: { snapshots: string | string[]; recursive?: boolean; properties?: Record<string, string> }) =>
    runZfs(['snapshot', ...(opts.recursive ? ['-r'] : []), ...propArgs('-o', opts.properties),
        ...targetArgs(opts.snapshots)], `Create snapshot(s) ${targetArgs(opts.snapshots).join(' ')}`);

export const dsRollback = (opts: { snapshot: string; recursive?: boolean; recursiveClones?: boolean; force?: boolean }) =>
    runZfs(['rollback', ...(opts.recursive ? ['-r'] : []), ...(opts.recursiveClones ? ['-R'] : []),
        ...(opts.force ? ['-f'] : []), opts.snapshot], `Roll back to ${opts.snapshot}`);

export const dsClone = (opts: { snapshot: string; target: string; properties?: Record<string, string>; parents?: boolean }) =>
    runZfs(['clone', ...(opts.parents ? ['-p'] : []), ...propArgs('-o', opts.properties),
        opts.snapshot, opts.target], `Clone ${opts.snapshot} as ${opts.target}`);

export const dsPromote = (opts: { filesystem: string }) =>
    runZfs(['promote', opts.filesystem], `Promote clone ${opts.filesystem}`);

export const dsRename = (opts: {
    source: string; target: string; force?: boolean; parents?: boolean;
    unmount?: boolean; recursiveSnapshots?: boolean;
}) => {
    const args = [
        'rename', ...(opts.recursiveSnapshots ? ['-r'] : []), ...(opts.force ? ['-f'] : []),
        ...(opts.parents ? ['-p'] : []), ...(opts.unmount ? ['-u'] : []), opts.source, opts.target,
    ];
    return runZfs(args, `Rename ${opts.source} to ${opts.target}`);
};

export const dsBookmark = (opts: { source: string; bookmark: string }) =>
    runZfs(['bookmark', opts.source, opts.bookmark], `Create bookmark ${opts.bookmark}`);

export const dsDiff = (opts: {
    snapshot: string; target?: string; fileType?: boolean; timestamps?: boolean;
    noEscape?: boolean; scripting?: boolean;
}) => {
    const args = [
        'diff', ...(opts.fileType ? ['-F'] : []), ...(opts.scripting ? ['-H'] : []),
        ...(opts.timestamps ? ['-t'] : []), ...(opts.noEscape ? ['-h'] : []),
        opts.snapshot, ...(opts.target ? [opts.target] : []),
    ];
    return runZfs(args, `Compare ${opts.snapshot} with ${opts.target ?? 'the live dataset'}`);
};

export const dsList = (opts: {
    targets?: string | string[]; types?: string | string[]; recursive?: boolean; depth?: number;
    properties?: string | string[]; sort?: string; descending?: string; parsable?: boolean; scripting?: boolean;
} = {}) => {
    const args = ['list'];
    if (opts.scripting) args.push('-H');
    if (opts.parsable) args.push('-p');
    if (opts.depth !== undefined) args.push('-d', String(opts.depth));
    else if (opts.recursive) args.push('-r');
    if (opts.properties !== undefined) args.push('-o', commaList(opts.properties));
    if (opts.sort !== undefined) args.push('-s', opts.sort);
    if (opts.descending !== undefined) args.push('-S', opts.descending);
    if (opts.types !== undefined) args.push('-t', commaList(opts.types));
    args.push(...targetArgs(opts.targets ?? []));
    return runZfs(args, 'List datasets');
};

export const dsSet = (opts: { properties: Record<string, string>; targets: string | string[]; updateOnly?: boolean }) =>
    runZfs(['set', ...(opts.updateOnly ? ['-u'] : []), ...kv(opts.properties), ...targetArgs(opts.targets)],
           `Set ${Object.keys(opts.properties).join(' ')} on ${targetArgs(opts.targets).join(' ')}`);

export const dsGet = (opts: {
    properties: 'all' | string | string[]; targets: string | string[]; recursive?: boolean;
    depth?: number; fields?: string[]; types?: string[]; sources?: string[];
    parsable?: boolean; scripting?: boolean;
}) => {
    const args = ['get'];
    if (opts.recursive) args.push('-r');
    if (opts.scripting) args.push('-H');
    if (opts.parsable) args.push('-p');
    if (opts.depth !== undefined) args.push('-d', String(opts.depth));
    if (opts.fields) args.push('-o', opts.fields.join(','));
    if (opts.types) args.push('-t', opts.types.join(','));
    if (opts.sources) args.push('-s', opts.sources.join(','));
    args.push(commaList(opts.properties), ...targetArgs(opts.targets));
    return runZfs(args, `Read properties of ${targetArgs(opts.targets).join(' ')}`);
};

export const dsInherit = (opts: { property: string; targets: string | string[]; recursive?: boolean; revert?: boolean }) =>
    runZfs(['inherit', ...(opts.recursive ? ['-r'] : []), ...(opts.revert ? ['-S'] : []),
        opts.property, ...targetArgs(opts.targets)], `Inherit ${opts.property} on ${targetArgs(opts.targets).join(' ')}`);

export const dsUpgrade = (opts: { targets?: string | string[]; all?: boolean; recursive?: boolean; version?: string; verbose?: boolean } = {}) =>
    runZfs(['upgrade', ...(opts.verbose ? ['-v'] : []), ...(opts.recursive ? ['-r'] : []),
        ...(opts.version !== undefined ? ['-V', opts.version] : []), ...(opts.all ? ['-a'] : []),
        ...targetArgs(opts.targets ?? [])], 'Upgrade dataset versions');

interface UsageOpts {
    fields?: string | string[];
    numeric?: boolean;
    translateSid?: boolean;
    parsable?: boolean;
    scripting?: boolean;
    sort?: string | string[];
    reverseSort?: string | string[];
    types?: string | string[];
}

function usageArgs(cmd: 'userspace' | 'groupspace', target: string, opts: UsageOpts): string[] {
    const args: string[] = [cmd];
    if (opts.scripting) args.push('-H');
    if (opts.translateSid) args.push('-i');
    if (opts.numeric) args.push('-n');
    if (opts.parsable) args.push('-p');
    if (opts.fields !== undefined) args.push('-o', commaList(opts.fields));
    args.push(...flagArgs('-s', opts.sort), ...flagArgs('-S', opts.reverseSort));
    if (opts.types !== undefined) args.push('-t', commaList(opts.types));
    args.push(target);
    return args;
}

export const dsUserspace = (opts: { target: string } & UsageOpts) =>
    runZfs(usageArgs('userspace', opts.target, opts), `Read user space usage for ${opts.target}`);

export const dsGroupspace = (opts: { target: string } & UsageOpts) =>
    runZfs(usageArgs('groupspace', opts.target, opts), `Read group space usage for ${opts.target}`);

export const dsProjectspace = (opts: {
    target: string; fields?: string | string[]; parsable?: boolean; scripting?: boolean;
    sort?: string | string[]; reverseSort?: string | string[];
}) => {
    const args = ['projectspace'];
    if (opts.scripting) args.push('-H');
    if (opts.parsable) args.push('-p');
    if (opts.fields !== undefined) args.push('-o', commaList(opts.fields));
    args.push(...flagArgs('-s', opts.sort), ...flagArgs('-S', opts.reverseSort), opts.target);
    return runZfs(args, `Read project space usage for ${opts.target}`);
};

export const dsProject = (opts: {
    targets: string | string[]; mode?: 'show' | 'check' | 'clear' | 'set';
    id?: string; recursive?: boolean; dirOnly?: boolean; setInherit?: boolean;
    keep?: boolean; zero?: boolean;
}) => {
    const args = ['project'];
    if (opts.mode === 'check') args.push('-c');
    if (opts.mode === 'clear') args.push('-C');
    if (opts.zero) args.push('-0');
    if (opts.keep) args.push('-k');
    if (opts.dirOnly) args.push('-d');
    if (opts.id !== undefined) args.push('-p', opts.id);
    if (opts.recursive) args.push('-r');
    if (opts.setInherit) args.push('-s');
    args.push(...targetArgs(opts.targets));
    return runZfs(args, `Manage project IDs on ${targetArgs(opts.targets).join(' ')}`);
};

export const dsMount = (opts: {
    targets?: string | string[]; all?: boolean; recursiveFs?: boolean; force?: boolean;
    lazy?: boolean; loadKeys?: boolean; overlay?: boolean; options?: string; verbose?: boolean;
} = {}) => {
    const args = ['mount'];
    if (opts.force) args.push('-f');
    if (opts.lazy) args.push('-l');
    if (opts.verbose) args.push('-v');
    if (opts.overlay) args.push('-O');
    if (opts.options !== undefined) args.push('-o', opts.options);
    if (opts.all) args.push('-a');
    else if (opts.recursiveFs) args.push('-R');
    args.push(...targetArgs(opts.targets ?? []));
    return runZfs(args, 'Mount ZFS file systems');
};

export const dsUnmount = (opts: { targets?: string | string[]; all?: boolean; force?: boolean; unloadKeys?: boolean }) =>
    runZfs(['unmount', ...(opts.force ? ['-f'] : []), ...(opts.unloadKeys ? ['-u'] : []),
        ...(opts.all ? ['-a'] : []), ...targetArgs(opts.targets ?? [])], 'Unmount ZFS file systems');

export const dsShare = (opts: { filesystem?: string; all?: boolean; protocol?: 'nfs' | 'smb'; loadKeys?: boolean } = {}) =>
    runZfs(['share', ...(opts.loadKeys ? ['-l'] : []), ...(opts.all ? ['-a'] : []),
        ...(opts.protocol ? [opts.protocol] : []), ...(opts.filesystem ? [opts.filesystem] : [])],
           'Share ZFS file systems');

export const dsUnshare = (opts: { target?: string; all?: boolean }) =>
    runZfs(['unshare', ...(opts.all ? ['-a'] : []), ...(opts.target ? [opts.target] : [])],
           'Unshare ZFS file systems');

export const dsSend = (opts: {
    snapshot: string; incremental?: string; intermediates?: string; replicate?: boolean;
    excludeDatasets?: string[]; large?: boolean; embed?: boolean; compressed?: boolean;
    raw?: boolean; props?: boolean; saved?: boolean; redact?: string;
    receiveResumeToken?: string; dryrun?: boolean; verbose?: boolean; onProgress?: (line: string) => void;
}) => {
    // The stream itself is the stdout; onProgress sees it as it is produced.
    const args = [
        'send', ...(opts.dryrun ? ['-n'] : []), ...(opts.replicate ? ['-R'] : []),
        ...(opts.replicate && opts.excludeDatasets ? ['-X', opts.excludeDatasets.join(',')] : []),
        ...(opts.intermediates ? ['-I', opts.intermediates] : []), ...(opts.incremental ? ['-i', opts.incremental] : []),
        ...(opts.large ? ['-L'] : []), ...(opts.embed ? ['-e'] : []), ...(opts.compressed ? ['-c'] : []),
        ...(opts.raw ? ['-w'] : []), ...(opts.props ? ['-p'] : []), ...(opts.verbose ? ['-v'] : []),
        ...(opts.saved ? ['--saved'] : []), ...(opts.redact ? ['--redact', opts.redact] : []),
        ...(opts.receiveResumeToken ? ['-t', opts.receiveResumeToken] : [opts.snapshot]),
    ];
    return runZfs(args, { reason: `Send ${opts.receiveResumeToken ? 'resumable stream' : opts.snapshot}`, onProgress: opts.onProgress });
};

export const dsReceive = (opts: {
    target: string; options?: Record<string, string>; excludeProps?: string | string[];
    force?: boolean; rollback?: boolean; nomount?: boolean; partial?: boolean;
    verbose?: boolean; dryrun?: boolean; abort?: boolean; skipHolds?: boolean;
    discardFirst?: boolean; lastElement?: boolean; onProgress?: (line: string) => void;
}) => {
    // -A aborts an interrupted -s receive (deleting its partial state); a
    // resume is `zfs send -t token` piped into a plain receive (no flag).
    // -F is the one force/rollback flag: it rolls back to the most recent
    // snapshot before receiving.
    if (opts.abort)
        return runZfs(['receive', '-A', opts.target], `Abort interrupted receive into ${opts.target}`);
    const args = [
        'receive', ...((opts.force || opts.rollback) ? ['-F'] : []), ...(opts.skipHolds ? ['-h'] : []),
        ...(opts.nomount ? ['-u'] : []), ...(opts.partial ? ['-s'] : []), ...(opts.verbose ? ['-v'] : []),
        ...(opts.dryrun ? ['-n'] : []), ...(opts.discardFirst ? ['-d'] : []), ...(opts.lastElement ? ['-e'] : []),
        ...propArgs('-o', opts.options), ...flagArgs('-x', opts.excludeProps), opts.target,
    ];
    return runZfs(args, { reason: `Receive stream into ${opts.target}`, onProgress: opts.onProgress });
};

export const dsRedact = (opts: { snapshot: string; bookmark: string; redactionSnapshots: string[] }) =>
    runZfs(['redact', opts.snapshot, opts.bookmark, ...opts.redactionSnapshots],
           `Redact ${opts.snapshot} into bookmark ${opts.bookmark}`);

export const dsAllow = (opts: {
    target: string; entities?: string[]; perms?: string[]; everyone?: boolean;
    create?: boolean; set?: string; local?: boolean; descendent?: boolean;
    user?: boolean; group?: boolean;
}) => {
    const args = [
        'allow', ...(opts.local ? ['-l'] : []), ...(opts.descendent ? ['-d'] : []),
        ...(opts.user ? ['-u'] : []), ...(opts.group ? ['-g'] : []),
        ...(opts.create ? ['-c'] : []), ...(opts.set !== undefined ? ['-s', opts.set] : []),
        ...(opts.everyone ? ['-e'] : []), ...(opts.entities ?? []), ...(opts.perms ?? []), opts.target,
    ];
    return runZfs(args, `Delegate permissions on ${opts.target}`);
};

export const dsUnallow = (opts: {
    target: string; entities?: string[]; perms?: string[]; everyone?: boolean;
    create?: boolean; set?: string; local?: boolean; descendent?: boolean;
    user?: boolean; group?: boolean; recursive?: boolean;
}) => {
    const args = [
        'unallow', ...(opts.recursive ? ['-r'] : []), ...(opts.local ? ['-l'] : []),
        ...(opts.descendent ? ['-d'] : []), ...(opts.user ? ['-u'] : []), ...(opts.group ? ['-g'] : []),
        ...(opts.create ? ['-c'] : []), ...(opts.set !== undefined ? ['-s', opts.set] : []),
        ...(opts.everyone ? ['-e'] : []), ...(opts.entities ?? []), ...(opts.perms ?? []), opts.target,
    ];
    return runZfs(args, `Remove delegated permissions on ${opts.target}`);
};

export const dsHold = (opts: { tag: string; snapshots: string | string[]; recursive?: boolean }) =>
    runZfs(['hold', ...(opts.recursive ? ['-r'] : []), opts.tag, ...targetArgs(opts.snapshots)],
           `Hold ${targetArgs(opts.snapshots).join(' ')} with tag ${opts.tag}`);

export const dsHolds = (opts: { snapshots: string | string[]; recursive?: boolean; parsable?: boolean; scripting?: boolean }) =>
    runZfs(['holds', ...(opts.recursive ? ['-r'] : []), ...(opts.scripting ? ['-H'] : []),
        ...(opts.parsable ? ['-p'] : []), ...targetArgs(opts.snapshots)],
           `List holds on ${targetArgs(opts.snapshots).join(' ')}`);

export const dsRelease = (opts: { tag: string; snapshots: string | string[]; recursive?: boolean }) =>
    runZfs(['release', ...(opts.recursive ? ['-r'] : []), opts.tag, ...targetArgs(opts.snapshots)],
           `Release tag ${opts.tag} from ${targetArgs(opts.snapshots).join(' ')}`);

export const dsLoadKey = (opts: { targets?: string | string[]; all?: boolean; recursive?: boolean; dryrun?: boolean; keylocation?: string }) => {
    const args = ['load-key', ...(opts.recursive ? ['-r'] : []), ...(opts.dryrun ? ['-n'] : []),
        ...(opts.keylocation !== undefined ? ['-L', opts.keylocation] : []),
        ...(opts.all ? ['-a'] : []), ...targetArgs(opts.targets ?? [])];
    return runZfs(args, 'Load encryption keys');
};

export const dsUnloadKey = (opts: { targets?: string | string[]; all?: boolean; recursive?: boolean }) =>
    runZfs(['unload-key', ...(opts.recursive ? ['-r'] : []), ...(opts.all ? ['-a'] : []),
        ...targetArgs(opts.targets ?? [])], 'Unload encryption keys');

export const dsChangeKey = (opts: {
    filesystem: string; loadKey?: boolean; inherited?: boolean; properties?: Record<string, string>;
}) => {
    const args = [
        'change-key', ...(opts.inherited ? ['-i'] : []), ...(opts.loadKey ? ['-l'] : []),
        ...propArgs('-o', opts.properties), opts.filesystem,
    ];
    return runZfs(args, `Change encryption key for ${opts.filesystem}`);
};

export const dsProgram = (opts: {
    pool: string; program: string; args?: string[]; json?: boolean; readOnly?: boolean;
    instructionLimit?: string | number; memoryLimit?: string | number;
}) => {
    const args = [
        'program', ...(opts.json ? ['-j'] : []), ...(opts.readOnly ? ['-n'] : []),
        ...(opts.instructionLimit !== undefined ? ['-t', String(opts.instructionLimit)] : []),
        ...(opts.memoryLimit !== undefined ? ['-m', String(opts.memoryLimit)] : []),
        opts.pool, opts.program, ...(opts.args ?? []),
    ];
    return runZfs(args, `Run channel program ${opts.program} on pool ${opts.pool}`);
};

export const dsRewrite = (opts: {
    targets: string | string[]; recursive?: boolean; verbose?: boolean; noCrossMounts?: boolean;
    offset?: string | number; length?: string | number;
}) => {
    const args = [
        'rewrite', ...(opts.recursive ? ['-r'] : []), ...(opts.verbose ? ['-v'] : []),
        ...(opts.noCrossMounts ? ['-x'] : []), ...(opts.offset !== undefined ? ['-o', String(opts.offset)] : []),
        ...(opts.length !== undefined ? ['-l', String(opts.length)] : []), ...targetArgs(opts.targets),
    ];
    return runZfs(args, `Rewrite data in ${targetArgs(opts.targets).join(' ')}`);
};

export const dsWait = (opts: { filesystem: string; activity?: string | string[]; onProgress?: (line: string) => void }) => {
    const args = ['wait', ...(opts.activity !== undefined ? ['-t', commaList(opts.activity)] : []), opts.filesystem];
    return runZfs(args, { reason: `Wait for background activity on ${opts.filesystem}`, onProgress: opts.onProgress });
};
