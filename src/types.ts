export interface KeyValue {
    [key: string]: string;
}

// --- zpool status tree ------------------------------------------------------

export type VdevType =
    'root' | 'mirror' | 'raidz' | 'raidz1' | 'raidz2' | 'raidz3' | 'draid' |
    'disk' | 'file' | 'spare' | 'replacing' | 'log' | 'cache' |
    'hole' | 'indirect' | 'special' | 'dedup';

export type VdevClass = 'normal' | 'log' | 'cache' | 'spare' | 'special' | 'dedup';

export interface VdevIostat {
    name: string;
    alloc: string;
    free: string;
    readOps: string;
    writeOps: string;
    read: string;
    write: string;
}

export interface Vdev {
    name: string;
    type: VdevType;
    class: VdevClass;
    state: string;
    read: string;
    write: string;
    cksum: string;
    path?: string | undefined;
    // Trailing text after the counters, e.g. "insufficient replicas".
    message?: string | undefined;
    scanLine?: string | undefined;
    iostat?: VdevIostat | undefined;
    children: Vdev[];
}

export type PoolScanKind = 'none' | 'scrub' | 'resilver' | 'resilver-replace';

export interface PoolScan {
    kind: PoolScanKind;
    inProgress: boolean;
    paused?: boolean | undefined;
    line: string;
    percent?: string | undefined;
    repaired?: string | undefined;
    errors?: string | undefined;
    // "since <t>" for in-progress lines, "on <t>" for completed ones.
    since?: string | undefined;
}

export interface PoolProperty {
    name: string;
    value: string;
    source: string;
    received?: string | undefined;
    default?: string | undefined;
}

export interface Pool {
    name: string;
    guid?: string | undefined;
    state: string;
    statusText?: string | undefined;
    actionText?: string | undefined;
    scan: PoolScan;
    errors: string;
    // One root node (type 'root', the pool row itself) holding the tree.
    vdevs: Vdev[];
    // zpool list columns
    size: string;
    alloc: string;
    free: string;
    checkpoint: string;
    expandSize: string;
    frag: string;
    cap: string;
    dedup: string;
    health: string;
    altRoot: string;
    autoTrim: string;
    comment: string;
    properties: PoolProperty[];
}

export interface PoolIostat {
    name: string;
    rows: VdevIostat[];
}

// --- zfs datasets -----------------------------------------------------------

export type DatasetType = 'filesystem' | 'volume' | 'snapshot' | 'bookmark';

export interface Dataset {
    name: string;
    type: DatasetType;
    used: string;
    avail: string;
    refer: string;
    mountpoint?: string | undefined;
    origin?: string | undefined;
    usedBySnapshot?: string | undefined;
    // Unrecognized zfs list -o columns land here.
    properties?: KeyValue | undefined;
}

export interface DatasetProperty {
    name: string;
    value: string;
    source: string;
    received?: string | undefined;
    default?: string | undefined;
}

// `zfs list -o space` columns: name,avail,used,usedsnap,usedds,usedrefreserv,usedchild
export interface SpaceEntry {
    name: string;
    avail: string;
    used: string;
    usedBySnapshot: string;
    usedByDataset: string;
    usedByRefreservation: string;
    usedByChildren: string;
}

export interface HoldEntry {
    name: string;
    tag: string;
    timestamp: string;
}

export interface UsageEntry {
    type: string;
    name: string;
    used: string;
    quota: string;
    objUsed: string;
    objQuota: string;
}

export interface DiffEntry {
    change: string;
    path: string;
    newPath?: string | undefined;
    // File-type column ("/", "F", …) from `zfs diff -F`; plain output omits it.
    fileType?: string | undefined;
    timestamp?: string | undefined;
}

export interface SendInfo {
    kind: 'full' | 'incremental';
    from?: string | undefined;
    to: string;
    size: string;
    properties?: KeyValue | undefined;
}

// --- history / events / import ---------------------------------------------

export interface HistoryEntry {
    time: string;
    command: string;
}

export interface EventEntry {
    time: string;
    class: string;
    detail?: string | undefined;
}

export interface ImportablePool {
    name: string;
    id: string;
    state: string;
    statusText?: string | undefined;
    actionText?: string | undefined;
    vdevs: Vdev[];
}

// --- system / UI -----------------------------------------------------------

export interface ZfsVersion {
    major: string;
    minor: string;
    patch: string;
    raw: string;
}

export interface SystemOverview {
    version: ZfsVersion | null;
    pools: Pool[];
    datasets: Dataset[];
}

export type ViewLevel = 'pools' | 'pool' | 'datasets' | 'dataset' | 'events' | 'commandlog' | 'settings';

export interface ViewState {
    level: ViewLevel;
    poolName?: string | undefined;
    datasetName?: string | undefined;
}

export interface CommandLogEntry {
    id: number;
    timestamp: number;
    reason: string;
    args: string[];
    bin: 'zfs' | 'zpool' | 'sh';
    status: 'pending' | 'success' | 'error';
    output?: string | undefined;
    error?: string | undefined;
    durationMs?: number | undefined;
}
