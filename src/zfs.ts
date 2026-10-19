import type {
    Dataset, DatasetProperty, DatasetType, DiffEntry, HoldEntry, SendInfo,
    SpaceEntry
} from './types';

// ---------------------------------------------------------------------------
// zfs list -H rows over a loadable -o column set. Type is inferred from the
// name (snapshot '@', bookmark '#') when the set has no type column.
// ---------------------------------------------------------------------------

const LIST_DEFAULT_COLUMNS = ['name', 'type', 'used', 'avail', 'refer', 'mountpoint'];

function datasetType(name: string, value: string): DatasetType {
    if (value === 'snapshot' || value === 'snap' || (!value && name.includes('@'))) return 'snapshot';
    if (value === 'bookmark' || (!value && name.includes('#'))) return 'bookmark';
    if (value === 'volume' || value === 'vol') return 'volume';
    return 'filesystem';
}

export function parseZfsList(output: string, columns: string[] = LIST_DEFAULT_COLUMNS): Dataset[] {
    const datasets: Dataset[] = [];
    for (const raw of output.split('\n')) {
        if (!raw.trim() || !raw.includes('\t')) continue;
        const fields = raw.split('\t');
        const row: Record<string, string> = {};
        columns.forEach((col, i) => { row[col.toLowerCase()] = fields[i] ?? '' });

        const name = row.name ?? '';
        if (!name) continue;
        const ds: Dataset = {
            name,
            type: datasetType(name, row.type ?? ''),
            used: row.used ?? '',
            avail: row.avail ?? row.available ?? '',
            refer: row.refer ?? row.referenced ?? '',
            properties: {},
        };
        for (const [col, value] of Object.entries(row)) {
            if (col === 'name' || col === 'type' || col === 'used') continue;
            if (col === 'avail' || col === 'available') { ds.avail = value; continue }
            if (col === 'refer' || col === 'referenced') { ds.refer = value; continue }
            if (col === 'mountpoint') { ds.mountpoint = value; continue }
            if (col === 'origin') { ds.origin = value; continue }
            if (col === 'usedbysnapshots' || col === 'usedsnap') { ds.usedBySnapshot = value; continue }
            ds.properties = ds.properties ?? {};
            ds.properties[col] = value;
        }
        datasets.push(ds);
    }
    return datasets;
}

// ---------------------------------------------------------------------------
// zfs get rows: name, property, value [, source [, received]].
// DatasetProperty.name is the property name; source is kept verbatim
// ("local", "default", "-", "inherited from <ds>", "received").
// ---------------------------------------------------------------------------

export function parseZfsGet(output: string): DatasetProperty[] {
    const props: DatasetProperty[] = [];
    for (const raw of output.split('\n')) {
        if (!raw.trim() || !raw.includes('\t')) continue;
        const f = raw.split('\t');
        if (f.length >= 5) props.push({ name: f[1], value: f[2], source: f[3], received: f[4] });
        else if (f.length === 4) props.push({ name: f[1], value: f[2], source: f[3] });
        else if (f.length === 3) props.push({ name: f[1], value: f[2], source: '' });
    }
    return props;
}

// ---------------------------------------------------------------------------
// `zfs list -H -o space` rows:
// name,avail,used,usedsnap,usedds,usedrefreserv,usedchild
// ---------------------------------------------------------------------------

export function parseZfsSpace(output: string): SpaceEntry[] {
    const entries: SpaceEntry[] = [];
    for (const raw of output.split('\n')) {
        if (!raw.trim() || !raw.includes('\t')) continue;
        const f = raw.split('\t');
        if (f.length < 7) continue;
        entries.push({
            name: f[0],
            avail: f[1],
            used: f[2],
            usedBySnapshot: f[3],
            usedByDataset: f[4],
            usedByRefreservation: f[5],
            usedByChildren: f[6],
        });
    }
    return entries;
}

// `zfs holds -H` rows: name, tag, timestamp
export function parseZfsHolds(output: string): HoldEntry[] {
    const entries: HoldEntry[] = [];
    for (const raw of output.split('\n')) {
        if (!raw.trim() || !raw.includes('\t')) continue;
        const f = raw.split('\t');
        entries.push({ name: f[0], tag: f[1], timestamp: f[2] ?? '' });
    }
    return entries;
}

// ---------------------------------------------------------------------------
// `zfs send -nP` dry run: "full <to> [size]" / "incremental <from> <to> [size]"
// header line, "size <n>" line, plus property lines from -P if present.
// ---------------------------------------------------------------------------

export function parseZfsSendDryRun(output: string): SendInfo {
    let info: SendInfo | null = null;
    const properties: Record<string, string> = {};
    for (const raw of output.split('\n')) {
        if (!raw.trim()) continue;
        const f = raw.split('\t');
        if (f[0] === 'full' || f[0] === 'incremental') {
            info = {
                kind: f[0] === 'full' ? 'full' : 'incremental',
                from: f[0] === 'incremental' ? f[1] : undefined,
                to: f[0] === 'incremental' ? (f[2] ?? '') : (f[1] ?? ''),
                size: f[0] === 'incremental' ? (f[3] ?? '') : (f[2] ?? ''),
            };
        } else if (f[0] === 'size' && info) {
            info.size = f[1];
        } else if (f.length > 1) {
            properties[f[0]] = f.slice(1).join('\t');
        }
    }
    if (!info) throw new Error('zfs send dry-run: no full/incremental line in output');
    if (Object.keys(properties).length) info.properties = properties;
    return info;
}

// ---------------------------------------------------------------------------
// `zfs diff` tab rows. Plain: change<TAB>path[<TAB>newPath]. With -t
// (what service.ts runs): epoch<TAB>change<TAB>path; with -F the file type is
// its own column: epoch<TAB>change<TAB>type<TAB>path[<TAB>newPath]. Timestamps
// are kept verbatim (epoch seconds.nanos per platform; see
// test/fixtures/raw/zfs-diff.txt).
// ---------------------------------------------------------------------------

export function parseZfsDiff(output: string): DiffEntry[] {
    const entries: DiffEntry[] = [];
    for (const raw of output.split('\n')) {
        if (!raw.trim()) continue;
        const fields = raw.split('\t');
        let timestamp: string | undefined;
        let fileType: string | undefined;
        let change: string;
        let path: string;
        let newPath: string | undefined;
        if (fields.length >= 4) {
            // -t with -F: epoch, change, file type, path [newPath]
            [timestamp, change, fileType, path] = fields;
            newPath = fields[4];
        } else if (fields.length === 3 && /^\d+(\.\d+)?$/.test(fields[0])) {
            // -t without -F: epoch, change, path
            [timestamp, change, path] = fields;
        } else {
            // plain: change, path [newPath]
            [change, path, newPath] = fields;
        }
        if (!/^[M+\-RT]([BFDCPS@U=|>-])?$/.test(change ?? '')) continue;
        path = path ?? '';
        const arrow = path.split(' -> ');
        if (arrow.length === 2) {
            path = arrow[0];
            newPath = arrow[1];
        }
        entries.push({ change, path, newPath, fileType, timestamp });
    }
    return entries;
}

// ---------------------------------------------------------------------------
// `zfs upgrade -v` / `zpool upgrade -v`: filesystem version rows (" 1  desc")
// and pool feature rows ("name (read-only compatible)" + indented description).
// Names only; descriptions stay in the raw output.
// ---------------------------------------------------------------------------

export function parseZfsUpgrade(output: string): { versions: string[]; features: string[] } {
    const versions: string[] = [];
    const features: string[] = [];
    for (const raw of output.split('\n')) {
        const ver = raw.match(/^\s*(\d+)\s{2,}\S/);
        if (ver) {
            versions.push(ver[1]);
            continue;
        }
        const feat = raw.match(/^([a-z0-9_]+)\s{2,}(\([^)]*\))?\s*$/);
        if (feat) features.push(feat[1]);
    }
    return { versions, features };
}
