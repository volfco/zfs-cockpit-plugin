// Cockpit module stub + fixture-backed models for the isolated browser check.
// Nothing here invokes real zfs/zpool: models come from running the real
// parsers over embedded captures of test/fixtures/raw/ (trimmed to what the
// UI check renders). This module is loaded by the ui-check esbuild bundle,
// not Node — imports mirror the src/ style (extensionless).
import type {
    BlockDevice, CommandLogEntry, Dataset, DatasetProperty, DiffEntry, EventEntry, HistoryEntry,
    HoldEntry, ImportablePool, Pool, PoolIostat, PoolProperty, SendInfo, SpaceEntry,
    SystemOverview, UsageEntry, ZfsVersion,
} from '../../src/types';
import {
    parseZpoolStatus, parseZpoolList, parseZpoolGet, parseZpoolHistory,
    parseZpoolEvents, parseZpoolImport, parseAvailableDisks,
} from '../../src/zpool';
import {
    parseZfsList, parseZfsGet, parseZfsSpace, parseZfsHolds, parseZfsSendDryRun,
} from '../../src/zfs';

export type { CommandLogEntry };

// ---------------------------------------------------------------------------
// Embedded raw captures (test/fixtures/raw/). The scan line in STATUS_TEXT is
// the completed-resilver line captured in offline-degraded.txt's =ON= section.
// DS_GET_TEXT gains one user property (none were captured live); SPACE_TEXT is
// the synthetic `zfs list -H -o space` row format from test/parser-check.mjs.
// ---------------------------------------------------------------------------

const STATUS_TEXT = `  pool: scratch
 state: ONLINE
  scan: resilvered 4.50K in 00:00:00 with 0 errors on Sun Oct 18 11:30:01 2026
config:

	NAME                             STATE     READ WRITE CKSUM
	scratch                          ONLINE       0     0     0
	  raidz1-0                       ONLINE       0     0     0
	    /tmp/zfs-fixtures/disk1.img  ONLINE       0     0     0
	    /tmp/zfs-fixtures/disk2.img  ONLINE       0     0     0
	    /tmp/zfs-fixtures/disk3.img  ONLINE       0     0     0
	    /tmp/zfs-fixtures/disk4.img  ONLINE       0     0     0
	logs
	  mirror-1                       ONLINE       0     0     0
	    /tmp/zfs-fixtures/disk6.img  ONLINE       0     0     0
	    /tmp/zfs-fixtures/disk7.img  ONLINE       0     0     0
	cache
	  /tmp/zfs-fixtures/disk8.img    ONLINE       0     0     0
	spares
	  /tmp/zfs-fixtures/disk5.img    AVAIL

errors: No known data errors
`;

// `lsblk -J -b -p -o NAME,SIZE,MODEL,ROTA,TYPE,FSTYPE` (synthetic capture in
// the real output shape): sda/sdb/nvme0n1 free, sdc is a whole-disk pool member
// (zfs_member partition), sdd holds a non-ZFS filesystem (still offered).
const LSBLK_TEXT = JSON.stringify({
    blockdevices: [
        { name: '/dev/sda', size: 1000204886016, model: 'ST1000DM003-1ER162', rota: true, type: 'disk', fstype: null },
        { name: '/dev/sdb', size: 1000204886016, model: 'ST1000DM003-1ER162', rota: true, type: 'disk', fstype: null },
        {
            name: '/dev/sdc', size: 512110190592, model: 'Samsung SSD 850', rota: false, type: 'disk', fstype: null,
            children: [
                { name: '/dev/sdc1', size: 512109142016, model: null, rota: false, type: 'part', fstype: 'zfs_member' },
            ],
        },
        { name: '/dev/sdd', size: 250059350016, model: 'WDC WD2500AAKS-00L7A0', rota: true, type: 'disk', fstype: 'ext4' },
        { name: '/dev/nvme0n1', size: 256060514304, model: 'Samsung SSD 970 EVO Plus 250GB', rota: false, type: 'disk', fstype: null },
    ],
});

// `zpool list -H -o name,size,alloc,free,checkpoint,expandsz,fragmentation,cap,dedup,health,altroot`
const LIST_TEXT = `scratch	1.88G	976K	1.87G	-	-	4%	0%	1.00	ONLINE	-
`;
const LIST_COLS = [
    'name', 'size', 'alloc', 'free', 'checkpoint', 'expandsize', 'frag',
    'cap', 'dedup', 'health', 'altroot',
];

// `zfs list -H -o name,type,used,avail,refer,mountpoint,canmount,keystatus`
const DS_LIST_TEXT = `scratch	filesystem	1.05G	236M	32.9K	/scratch	on	-
scratch/clone1	filesystem	0B	236M	32.9K	/scratch/clone1	on	-
scratch/enc	filesystem	223K	236M	112K	/scratch/enc	on	available
scratch/enc/child	filesystem	111K	236M	111K	/scratch/enc/child	on	available
scratch/fs1	filesystem	65.8K	236M	32.9K	/mnt/scratch/fs1	on	-
scratch/fs1@snap1	snapshot	0B	-	32.9K	-	-	-
scratch/fs1@snap2	snapshot	0B	-	32.9K	-	-	-
scratch/fs1#bm1	bookmark	-	-	32.9K	-	-	-
scratch/fs1/sub	filesystem	32.9K	236M	32.9K	/mnt/scratch/fs1/sub	noauto	-
scratch/vm	volume	1.05G	1.28G	18.0K	-	-	-
`;

// `zfs get -H all scratch/fs1` (zfs-get-all.txt, scratch/fs1 rows) + the
// org.openzfs:* user property the UI check asserts on.
const DS_GET_TEXT = `scratch/fs1	type	filesystem	-
scratch/fs1	creation	Sun Oct 18 11:28 2026	-
scratch/fs1	used	65.8K	-
scratch/fs1	available	236M	-
scratch/fs1	referenced	32.9K	-
scratch/fs1	compressratio	1.00x	-
scratch/fs1	mounted	yes	-
scratch/fs1	quota	2G	local
scratch/fs1	reservation	none	default
scratch/fs1	recordsize	128K	local
scratch/fs1	mountpoint	/mnt/scratch/fs1	local
scratch/fs1	sharenfs	off	default
scratch/fs1	checksum	on	default
scratch/fs1	compression	lz4	local
scratch/fs1	atime	on	default
scratch/fs1	devices	on	default
scratch/fs1	exec	on	default
scratch/fs1	setuid	on	default
scratch/fs1	readonly	off	default
scratch/fs1	zoned	off	default
scratch/fs1	snapdir	hidden	default
scratch/fs1	aclmode	discard	default
scratch/fs1	aclinherit	restricted	default
scratch/fs1	createtxg	22	-
scratch/fs1	canmount	on	default
scratch/fs1	xattr	on	default
scratch/fs1	copies	1	default
scratch/fs1	version	5	-
scratch/fs1	utf8only	off	-
scratch/fs1	normalization	none	-
scratch/fs1	casesensitivity	sensitive	-
scratch/fs1	vscan	off	default
scratch/fs1	nbmand	off	default
scratch/fs1	sharesmb	off	default
scratch/fs1	refquota	none	default
scratch/fs1	refreservation	none	default
scratch/fs1	guid	11458417090376016640	-
scratch/fs1	primarycache	all	default
scratch/fs1	secondarycache	all	default
scratch/fs1	usedbysnapshots	0B	-
scratch/fs1	usedbydataset	32.9K	-
scratch/fs1	usedbychildren	32.9K	-
scratch/fs1	usedbyrefreservation	0B	-
scratch/fs1	logbias	latency	default
scratch/fs1	syn	standard	default
scratch/fs1	refcompressratio	1.00x	-
scratch/fs1	written	32.9K	-
scratch/fs1	written32	24K	-
scratch/fs1	clones	-
scratch/fs1	defer_destroy	off	-
scratch/fs1	userrefs	0	-
scratch/fs1	mlslabel	none	default
scratch/fs1	dnodesize	legacy	default
scratch/fs1	refdnodesize	legacy	default
scratch/fs1	redact_snaps	off	-
scratch/fs1	redact_bookmarks	off	-
scratch/fs1	redacted	off	-
scratch/fs1	encryption	off	-
scratch/fs1	encryptionroot	-	-
scratch/fs1	keystatus	-	-
scratch/fs1	keyformat	none	-
scratch/fs1	keylocation	none	-
scratch/fs1	pbkdf2iters	0	-
scratch/fs1	special_small_blocks	0	default
scratch/fs1	remaptxg	0	-
scratch/fs1	snapdev	hidden	default
scratch/fs1	acltype	off	default
scratch/fs1	selinux	none	default
scratch/fs1	context	none	default
scratch/fs1	fscontext	none	default
scratch/fs1	defcontext	none	default
scratch/fs1	rootcontext	none	default
scratch/fs1	relatime	on	default
scratch/fs1	redundant_metadata	all	default
scratch/fs1	overlay	on	default
scratch/fs1	dedup	off	default
scratch/fs1	org.openzfs:owner	ui-check-fixture	local
`;

// `zpool get -H all scratch` (zpool-get-all.txt head, aligned columns).
const ZPOOL_GET_TEXT = `NAME     PROPERTY                       VALUE                          SOURCE
scratch  size                           1.88G                          -
scratch  capacity                       0%                             -
scratch  altroot                        -                              default
scratch  health                         ONLINE                         -
scratch  guid                           9824044321402070287            -
scratch  version                        -                              default
scratch  bootfs                         -                              default
scratch  delegation                     on                             default
scratch  autoreplace                    off                            default
scratch  cachefile                      none                           local
scratch  failmode                       wait                           default
scratch  listsnapshots                   off                            default
scratch  autoexpand                      off                            default
scratch  dedupditto                      0                              default
scratch  dedupratio                      1.00x                          -
scratch  free                            1.87G                          -
scratch  allocated                       976K                           -
scratch  readonly                         off                            -
scratch  ashift                          12                             local
scratch  comment                         cockpit-plugin-fixture          local
scratch  expandsize                       -                              -
scratch  freeing                           0                            -
scratch  fragmentation                    4%                             -
scratch  leaked                            0                            -
scratch  multihost                        off                            default
scratch  checkpoint                       -                              -
scratch  load_guid                        9877839757423445742            -
scratch  autotrim                         off                            default
scratch  feature@async_destroy            enabled                        local
scratch  feature@lz4_compress             active                         local
`;

// `zpool history scratch` (zpool-history.txt '' section).
const HISTORY_TEXT = `History for 'scratch':
2026-10-18.11:28:30 zpool create -f scratch raidz1 /tmp/zfs-fixtures/disk1.img /tmp/zfs-fixtures/disk2.img /tmp/zfs-fixtures/disk3.img /tmp/zfs-fixtures/disk4.img -o comment=cockpit-plugin-fixture
2026-10-18.11:28:31 zpool add scratch spare /tmp/zfs-fixtures/disk5.img
2026-10-18.11:28:31 zpool add scratch log mirror /tmp/zfs-fixtures/disk6.img /tmp/zfs-fixtures/disk7.img
2026-10-18.11:28:31 zpool add scratch cache /tmp/zfs-fixtures/disk8.img
2026-10-18.11:28:59 zfs create -o compression=lz4 -o quota=2G -o recordsize=128K -o mountpoint=/mnt/scratch/fs1 scratch/fs1
2026-10-18.11:28:59 zfs create -o atime=off scratch/fs1/sub
2026-10-18.11:28:59 zfs create -V 1G -o volblocksize=16K scratch/vm
2026-10-18.11:28:59 zfs snapshot scratch/fs1@snap1
2026-10-18.11:28:59 zfs snapshot scratch/fs1@snap2
2026-10-18.11:28:59 zfs clone scratch/fs1@snap1 scratch/clone1
2026-10-18.11:28:59 zfs bookmark scratch/fs1@snap2 scratch/fs1#bm1
2026-10-18.11:28:59 zfs hold keep scratch/fs1@snap1
2026-10-18.11:29:05 zfs create -o encryption=aes-256-gcm -o keyformat=raw -o keylocation=file:///tmp/zfs-fixtures/key scratch/enc
2026-10-18.11:29:05 zfs create scratch/enc/child
2026-10-18.11:29:05 zfs set canmount=noauto scratch/fs1/sub
`;

// `zpool events` (zpool-events.txt, trimmed to the first entries).
const EVENTS_TEXT = `Oct 18 2026 11:28:31.039625796	sysevent.fs.zfs.config_sync
Oct 18 2026 11:28:31.039625796	sysevent.fs.zfs.vdev_add
Oct 18 2026 11:28:31.123623721	sysevent.fs.zfs.config_sync
Oct 18 2026 11:28:31.143623227	sysevent.fs.zfs.config_sync
Oct 18 2026 11:28:31.143623227	sysevent.fs.zfs.vdev_add
Oct 18 2026 11:28:31.235620955	sysevent.fs.zfs.config_sync
Oct 18 2026 11:28:31.235620955	sysevent.fs.zfs.vdev_add
Oct 18 2026 11:28:59.018935777	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.026935580	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.030935481	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.030935481	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.030935481	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.070934497	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.078934300	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.126933118	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.134932921	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.170932035	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.202931247	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.242930262	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.290929080	sysevent.fs.zfs.history_event
Oct 18 2026 11:28:59.322928292	sysevent.fs.zfs.history_event
Oct 18 2026 11:29:05.266782001	sysevent.fs.zfs.history_event
Oct 18 2026 11:29:05.270781902	sysevent.fs.zfs.history_event
Oct 18 2026 11:29:05.314780820	sysevent.fs.zfs.history_event
`;

// `zfs holds -H scratch/fs1@snap1` (zfs-holds.txt).
const HOLDS_TEXT = `scratch/fs1@snap1	keep	Sun Oct 18 11:28 2026
`;

// `zpool import` listing (export-import.txt =IMPORT=, host pools hdd0/ssd1).
const IMPORT_TEXT = `  pool: hdd0
    id: 7202412747075044166
 state: UNAVAIL
status: One or more devices contains corrupted data.
action: The pool cannot be imported due to damaged devices or data.
   see: https://openzfs.github.io/openzfs-docs/msg/ZFS-8000-5E
config:

	hdd0                                           UNAVAIL  insufficient replicas
	  mirror-0                                     ONLINE
	    sdm                                        ONLINE
	    sdk                                        ONLINE
	  mirror-1                                     UNAVAIL  insufficient replicas
	    wwn-0xT5000LM000-2AN170_WCJ2WP3S           UNAVAIL
	    wwn-0xT5000LM000-2AN170_WCJ2VH6B           UNAVAIL
	  mirror-2                                     DEGRADED
	    sdo                                        ONLINE
	    wwn-0xDC_WD40NPZZ-00PDPT0_WD-WX41E493KUW0  UNAVAIL
	  mirror-3                                     ONLINE
	    sdn                                        ONLINE
	    sdq                                        ONLINE
	  indirect-4                                   ONLINE
	  indirect-5                                   ONLINE
	  mirror-6                                     DEGRADED
	    wwn-0xT4000LM024-2AN17V_WCK0QVZM           UNAVAIL
	    sdp                                        ONLINE

  pool: ssd1
    id: 3511725845866588333
 state: DEGRADED
status: One or more devices contains corrupted data.
action: The pool can be imported despite missing or damaged devices.  The
	fault tolerance of the pool may be compromised if imported.
   see: https://openzfs.github.io/openzfs-docs/msg/ZFS-8000-4J
config:

	ssd1                        DEGRADED
	  raidz2-0                  DEGRADED
	    sdj                     ONLINE
	    sdd                     ONLINE
	    sde                     ONLINE
	    sda                     ONLINE
	    sdc                     ONLINE
	    sdi                     ONLINE
	    sdg                     ONLINE
	    sdb                     ONLINE
	    scsi-358ce38ee204afda9  UNAVAIL
`;

// `zfs send -nP scratch/fs1@snap1` (zfs-send-dryrun.txt).
const SEND_TEXT = `full	scratch/fs1@snap1	12912
size	12912
`;

const SPACE_TEXT = `scratch/fs1	236M	65.8K	0B	32.9K	0B	0B
`;

const VERSION_TEXT = `zfs-2.3.9-1
zfs-kmod-2.3.9-1
`;

// ---------------------------------------------------------------------------
// Fixture-backed models, parsed with the real parsers.
// ---------------------------------------------------------------------------

const statusPool = parseZpoolStatus(STATUS_TEXT)[0];
const listRow = parseZpoolList(LIST_TEXT, LIST_COLS)[0];
const pool: Pool = statusPool!;
for (const k of [
    'size', 'alloc', 'free', 'checkpoint', 'expandSize', 'frag',
    'cap', 'dedup', 'health', 'altRoot', 'autoTrim', 'comment',
] as const) {
    pool[k] = listRow![k];
}
pool.properties = parseZpoolGet(ZPOOL_GET_TEXT);

const datasets: Dataset[] = parseZfsList(
    DS_LIST_TEXT, ['name', 'type', 'used', 'avail', 'refer', 'mountpoint', 'canmount', 'keystatus']);
const historyEntries: HistoryEntry[] = parseZpoolHistory(HISTORY_TEXT);
const eventEntries: EventEntry[] = parseZpoolEvents(EVENTS_TEXT);
const importable: ImportablePool[] = parseZpoolImport(IMPORT_TEXT);
const holdEntries: HoldEntry[] = parseZfsHolds(HOLDS_TEXT);
const spaceEntries: SpaceEntry[] = parseZfsSpace(SPACE_TEXT);

function datasetProperties(name: string): DatasetProperty[] {
    return parseZfsGet(DS_GET_TEXT.split('\n').filter(l => l.split('\t')[0] === name).join('\n'));
}

const version: ZfsVersion = { major: '2', minor: '3', patch: '9', raw: 'zfs-2.3.9-1' };

// ---------------------------------------------------------------------------
// cockpit module stub — gettext/format/spawn. spawn records argv on
// window.__calls, answers known argv prefixes with the embedded captures and
// the magic 'error' argument with a rejection.
// ---------------------------------------------------------------------------

const win = window as unknown as { __calls: string[][] };
win.__calls = [];

function spawnOutput(args: string[]): string {
    switch (args.slice(0, 2).join(' ')) {
    case 'zpool status': return STATUS_TEXT;
    case 'zpool list': return LIST_TEXT;
    case 'zpool get': return ZPOOL_GET_TEXT;
    case 'zpool history': return HISTORY_TEXT;
    case 'zpool events': return EVENTS_TEXT;
    case 'zpool import': return IMPORT_TEXT;
    case 'zfs list': return DS_LIST_TEXT;
    case 'zfs get': return DS_GET_TEXT;
    case 'zfs holds': return HOLDS_TEXT;
    case 'zfs --version': return VERSION_TEXT;
    default: return 'Mock command completed successfully.\n' + 'output '.repeat(80);
    }
}

const cockpitStub = {
    gettext: (s: string) => s,
    format: (s: string, ...args: string[]) =>
        s.replace(/\$(\d+)/g, (_match, i) => args[Number(i)] ?? ''),
    format_bytes: (n: number) => {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let v = n;
        let u = 0;
        while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
        return `${u === 0 ? v : v.toFixed(1)} ${units[u]}`;
    },
    spawn: (args: string[]): Promise<string> => {
        win.__calls.push(args);
        return new Promise<string>((resolve, reject) => {
            if (args.includes('error')) reject(new Error('Mock command failure'));
            else resolve(spawnOutput(args));
        });
    },
};

export default cockpitStub;

// ---------------------------------------------------------------------------
// Command log — same semantics as src/service.ts (discovery runs are recorded
// only while the log toggle is on). The generated service mock re-exports
// these and routes every wrapper through mockRun below.
// ---------------------------------------------------------------------------

const commandLog: CommandLogEntry[] = [];
const logSubscribers = new Set<() => void>();
let nextId = 1;
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

interface RunOpts {
    reason?: string | undefined;
    discovery?: boolean | undefined;
}

async function run(bin: 'zfs' | 'zpool' | 'sh', args: string[], reason?: string | RunOpts): Promise<string> {
    const opts: RunOpts = typeof reason === 'string' ? { reason } : (reason ?? {});
    const entry: CommandLogEntry | null = (opts.discovery && !logDiscovery)
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
        const output = await cockpitStub.spawn([bin, ...args]);
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
            entry.error = e instanceof Error ? e.message : String(e);
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

export function runShell(command: string, reason?: string | RunOpts): Promise<string> {
    return run('sh', ['-c', command], reason);
}

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

export async function runCommandLine(cmdline: string): Promise<string> {
    const trimmed = cmdline.trim();
    const first = (trimmed.match(/^\S+/) ?? [''])[0];
    const bin = first.toLowerCase();
    if (bin !== 'zfs' && bin !== 'zpool')
        throw new Error(`Unknown command "${first}": command lines must start with "zfs " or "zpool "`);
    return run(bin, tokenize(trimmed), 'Manual command entered in UI');
}

export const snapTarget = (dataset: string, snap: string): string => `${dataset}@${snap}`;
export const bookmarkTarget = (dataset: string, bookmark: string): string => `${dataset}#${bookmark}`;

// Generic stand-in for the typed zpool*/ds* wrappers: derive a plausible argv
// ("zpool destroy scratch") so the command log and window.__calls stay useful.
export function mockRun(name: string, opts?: unknown): Promise<string> {
    const bin = name.startsWith('pool') ? 'zpool' : 'zfs';
    const sub = name.replace(/^(pool|ds)/, '')
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const operands: string[] = [];
    if (opts && typeof opts === 'object') {
        for (const v of Object.values(opts as Record<string, unknown>)) {
            if (typeof v === 'string' || typeof v === 'number') operands.push(String(v));
            else if (Array.isArray(v)) operands.push(v.map(String).join(','));
        }
    }
    return run(bin, [sub, ...operands], name);
}

// ---------------------------------------------------------------------------
// Version & capabilities. ?caps=old pretends an OpenZFS without the newer
// subcommands so capability-gated menu entries can be exercised.
// ---------------------------------------------------------------------------

export const CAPABILITY_LIST: string[] = [
    'zpool.wait', 'zpool.resilver', 'zpool.prefetch', 'zpool.ddtprune', 'zpool.trim',
    'zpool.initialize', 'zpool.checkpoint', 'zpool.split', 'zpool.rewind', 'zpool.status-json',
    'zfs.wait', 'zfs.redact', 'zfs.rewrite', 'zfs.program', 'zfs.bookmark',
    'zfs.send-redact', 'zfs.change-key', 'zfs.project',
];

export function getVersion(): ZfsVersion | null {
    return version;
}

export function hasCapability(_name: string): boolean {
    return !window.location.search.includes('caps=old');
}

export async function refreshVersion(): Promise<ZfsVersion> {
    return version;
}

// ---------------------------------------------------------------------------
// Fetchers — resolve with the parsed fixture models; each records its
// discovery run through the normal command-log path.
// ---------------------------------------------------------------------------

export const DESTRUCTIVE_OPS: Set<string> = new Set([
    'poolDestroy', 'poolExport', 'poolLabelclear', 'poolSplit', 'poolReguid',
    'poolCheckpoint', 'poolDdtprune', 'dsDestroy', 'dsReceive', 'dsUnloadKey',
    'dsRename', 'dsChangeKey', 'dsRedact',
]);

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function fetchOverview(): Promise<SystemOverview> {
    // Brief delay so the check can observe the loading state instead of
    // racing through microtasks (hpssa harness pattern).
    await delay(100);
    if (window.location.search.includes('error')) throw new Error('Mock discovery failure');
    if (window.location.search.includes('empty'))
        return { version, pools: [], datasets: [] };
    await run('zpool', ['list', '-H', '-o', 'name,size,alloc,free,checkpoint,expandsz,fragmentation,cap,dedup,health,altroot'],
              { reason: 'Discover pools and capacity', discovery: true });
    await run('zfs', ['list', '-H', '-o', 'name,type,used,avail,refer,mountpoint', '-t', 'all', '-r'],
              { reason: 'Discover all datasets', discovery: true });
    return { version, pools: [pool], datasets };
}

export async function fetchPoolStatus(_name: string): Promise<Pool> {
    await run('zpool', ['status', '-P', _name], { reason: `Read pool status for ${_name}`, discovery: true });
    return pool;
}

export async function fetchIostat(name?: string): Promise<PoolIostat[]> {
    return [{ name: name ?? 'scratch', rows: [] }];
}

export async function fetchPoolProperties(name: string): Promise<PoolProperty[]> {
    await run('zpool', ['get', '-H', 'all', name], { reason: `Read properties of pool ${name}`, discovery: true });
    return pool.properties;
}

export async function fetchVdevProperties(_pool: string, _vdev: string): Promise<PoolProperty[]> {
    return [];
}

export async function fetchPoolHistory(_opts: { pool?: string; incremental?: boolean } = {}): Promise<HistoryEntry[]> {
    await run('zpool', ['history'], { reason: 'Read pool history', discovery: true });
    return historyEntries;
}

export async function fetchPoolEvents(_opts: { pool?: string; verbose?: boolean } = {}): Promise<EventEntry[]> {
    await run('zpool', ['events'], { reason: 'Read pool events', discovery: true });
    return eventEntries;
}

export async function fetchImportablePools(_searchDir?: string): Promise<ImportablePool[]> {
    await run('zpool', ['import'], { reason: 'Search for importable pools', discovery: true });
    return importable;
}

export async function fetchAvailableDisks(): Promise<BlockDevice[]> {
    await run('sh', ['-c', 'lsblk -J -b -p -o NAME,SIZE,MODEL,ROTA,TYPE,FSTYPE'],
              { reason: 'List disks available for pool creation', discovery: true });
    return parseAvailableDisks(LSBLK_TEXT);
}

export async function fetchDatasetList(_opts: { types?: string | string[]; root?: string; depth?: number } = {}): Promise<Dataset[]> {
    await run('zfs', ['list'], { reason: 'List datasets', discovery: true });
    return datasets;
}

export async function fetchDatasetProperties(name: string, _opts: Record<string, unknown> = {}): Promise<DatasetProperty[]> {
    await run('zfs', ['get', '-H', 'all', name], { reason: `Read properties of ${name}`, discovery: true });
    return datasetProperties(name);
}

export async function fetchSpace(name: string): Promise<SpaceEntry[]> {
    await run('zfs', ['list', '-H', '-o', 'space', name], { reason: `Read space usage for ${name}`, discovery: true });
    return spaceEntries.filter(e => e.name === name);
}

export async function fetchHolds(snapshot: string, _recursive?: boolean): Promise<HoldEntry[]> {
    await run('zfs', ['holds', '-H', snapshot], { reason: `Read holds on ${snapshot}`, discovery: true });
    return holdEntries.filter(e => e.name === snapshot);
}

export async function fetchUsage(_kind: 'userspace' | 'groupspace' | 'projectspace', _target: string): Promise<UsageEntry[]> {
    return [];
}

export async function sendDryRun(args: string[]): Promise<SendInfo> {
    await run('zfs', ['send', '-nP', ...args], { reason: `Dry-run zfs send ${args.join(' ')}`, discovery: true });
    return parseZfsSendDryRun(SEND_TEXT);
}

export async function fetchDiff(_snapshot: string, _target?: string): Promise<DiffEntry[]> {
    return [];
}
