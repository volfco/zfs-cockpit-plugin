import type {
    EventEntry, HistoryEntry, ImportablePool, Pool, PoolProperty, PoolScan,
    Vdev, VdevClass, VdevIostat, VdevType
} from './types';

// ---------------------------------------------------------------------------
// Shared tree building for `zpool status` / `zpool import` / `zpool list -v`
// config trees. Row indents are 2 spaces per level (status rows carry a
// leading tab before the indent). Class section labels ("logs", "cache",
// "spares", ...) sit at the root indent and become section nodes between the
// root and their vdevs, so every node keeps its class.
// ---------------------------------------------------------------------------

const CLASS_LABELS: Record<string, { type: VdevType; class: VdevClass }> = {
    logs: { type: 'log', class: 'log' },
    log: { type: 'log', class: 'log' },
    cache: { type: 'cache', class: 'cache' },
    spares: { type: 'spare', class: 'spare' },
    spare: { type: 'spare', class: 'spare' },
    special: { type: 'special', class: 'special' },
    dedup: { type: 'dedup', class: 'dedup' },
};

export function vdevType(name: string): VdevType {
    if (/^mirror-\d+$/.test(name)) return 'mirror';
    if (/^raidz1-\d+$/.test(name)) return 'raidz1';
    if (/^raidz2-\d+$/.test(name)) return 'raidz2';
    if (/^raidz3-\d+$/.test(name)) return 'raidz3';
    if (/^raidz\d*-\d+$/.test(name)) return 'raidz';
    // shortcut: draid config names like draid2:2d:6c:0s-0 are not matched,
    // upgrade when a live capture shows them in zpool status output
    if (/^draid\d*-\d+$/.test(name)) return 'draid';
    if (/^replacing-\d+$/.test(name)) return 'replacing';
    if (/^spare-\d+$/.test(name)) return 'spare';
    if (/^indirect-\d+$/.test(name)) return 'indirect';
    if (/^hole-\d+$/.test(name)) return 'hole';
    if (name.startsWith('/dev/') || !name.includes('/')) return 'disk';
    return 'file';
}

function makeNode(name: string, type: VdevType, cls: VdevClass, state: string): Vdev {
    return {
        name,
        type,
        class: cls,
        state,
        read: '',
        write: '',
        cksum: '',
        path: name.startsWith('/') ? name : undefined,
        children: [],
    };
}

interface TreeBuilder {
    root: Vdev;
    stack: Vdev[];
    section: Vdev | null;
}

function newTreeBuilder(root: Vdev): TreeBuilder {
    return { root, stack: [root], section: null };
}

function addClassSection(tb: TreeBuilder, label: string): void {
    const meta = CLASS_LABELS[label.toLowerCase()];
    if (!meta) return;
    const node = makeNode(label, meta.type, meta.class, '');
    tb.root.children.push(node);
    tb.section = node;
    tb.stack = [tb.root, node];
}

function addTreeNode(tb: TreeBuilder, node: Vdev, depth: number): void {
    // Class section labels live at the root indent; their vdevs at depth 1.
    const parent = depth === 1 && tb.section
        ? tb.section
        : (tb.stack[depth - 1] ?? tb.root);
    node.class = parent === tb.root ? (tb.section?.class ?? 'normal') : parent.class;
    parent.children.push(node);
    tb.stack[depth] = node;
    tb.stack.length = depth + 1;
}

// Leading tab is the row marker in status/import trees; 2 spaces per level.
function statusRowDepth(line: string): number {
    return Math.floor((line.match(/^\t( *)/)?.[1].length ?? 0) / 2);
}

function splitColumns(line: string): string[] {
    return line.trim().split(line.includes('\t') ? /\t+/ : /\s{2,}/);
}

// ---------------------------------------------------------------------------
// zpool status / zpool import block layout:
//   pool: name / id: guid / state: / status: (prose) / action: (prose)
//   scan: / config: (tree) / errors:
// ---------------------------------------------------------------------------

const BLOCK_LABEL = /^ {0,6}(id|pool|state|status|action|scan|config|errors):[ \t]*(.*)$/;

export function parsePoolScan(text: string): PoolScan {
    const line = text.replace(/^scan:\s*/i, '').trim();
    const scan: PoolScan = { kind: 'none', inProgress: false, line };
    if (!line || /^none/i.test(line)) return scan;

    scan.kind = /scrub/i.test(line) ? 'scrub' : /resilver/i.test(line) ? 'resilver' : 'none';

    const firstLine = line.split('\n')[0];
    const since = firstLine.match(/\bsince\s+(.+?)(?=,\s*[\d.]+%\s*done|,\s*\S+\s+to go|$)/i);
    if (since) scan.since = since[1];

    const percent = line.match(/([\d.]+)%\s*done/i);
    if (percent) scan.percent = percent[1];

    if (/in progress/i.test(line)) {
        scan.inProgress = true;
    } else if (/paused/i.test(line)) {
        scan.paused = true;
    } else {
        const done = line.match(/(?:repaired|resilvered)\s+(\S+)\s+in\s+\S+\s+with\s+(\S+)\s+errors?\s+on\s+(.+?)\s*$/im);
        if (done) {
            scan.repaired = done[1];
            scan.errors = done[2];
            scan.since = done[3];
        }
    }
    return scan;
}

function parsePoolBlocks(output: string): Pool[] {
    const pools: Pool[] = [];
    let pool: Pool | null = null;
    let tb: TreeBuilder | null = null;
    let mode: 'none' | 'status' | 'action' | 'scan' | 'tree' = 'none';
    let scanText = '';

    const finish = () => {
        if (!pool) return;
        pool.scan = parsePoolScan(scanText);
        if (tb && !tb.root.name) tb.root.name = pool.name;
        pool.vdevs = tb ? [tb.root] : [];
        pools.push(pool);
        pool = null;
        tb = null;
    };

    for (const raw of output.split('\n')) {
        // Tree rows start with a tab; a trailing tab means a bare class label.
        if (mode === 'tree' && /^\t/.test(raw)) {
            const body = raw.replace(/^\t/, '').replace(/\t+$/, '')
                    .trimEnd();
            const fields = splitColumns(body);
            const name = fields[0] ?? '';
            if (!name || name === 'NAME') continue;

            if (tb && fields.length === 1 && CLASS_LABELS[name.toLowerCase()]) {
                addClassSection(tb, name);
                continue;
            }
            if (!tb) continue;

            let read = ''; let write = ''; let cksum = ''; let message = '';
            const rest = fields.slice(2);
            if (rest.length && /^\d/.test(rest[0])) {
                read = rest[0] ?? '';
                write = rest[1] ?? '';
                cksum = rest[2] ?? '';
                message = rest.slice(3).join(' ');
            } else {
                message = rest.join(' ');
            }
            const depth = statusRowDepth(raw);
            if (depth === 0 && tb.root === tb.stack[0] && tb.root.children.length === 0 && tb.root.name === '') {
                // Root row: the pool itself (holds the pool's counters).
                tb.root.name = name;
                tb.root.type = 'root';
                tb.root.state = fields[1] ?? '';
                tb.root.read = read;
                tb.root.write = write;
                tb.root.cksum = cksum;
                tb.root.message = message || undefined;
            } else {
                const node = makeNode(name, vdevType(name), 'normal', fields[1] ?? '');
                node.read = read;
                node.write = write;
                node.cksum = cksum;
                node.message = message || undefined;
                addTreeNode(tb, node, Math.max(depth, 1));
            }
            continue;
        }

        const label = raw.match(BLOCK_LABEL);

        if (mode !== 'none' && mode !== 'tree' && !label && raw.trim() !== '') {
            // Prose continuation lines (status:/action:/scan: blocks).
            if (mode === 'scan') scanText += '\n' + raw.trim();
            else if (pool) {
                const key = mode === 'status' ? 'statusText' : 'actionText';
                pool[key] = pool[key] ? pool[key] + '\n' + raw.trim() : raw.trim();
            }
            continue;
        }
        if (raw.trim() === '') {
            if (mode !== 'tree') mode = 'none';
            continue;
        }
        if (!label || /^\t/.test(raw)) continue;

        const [, which, value] = label;
        switch (which) {
        case 'pool':
            finish();
            pool = {
                name: value,
                state: '',
                scan: { kind: 'none', inProgress: false, line: '' },
                errors: '',
                vdevs: [],
                size: '',
                alloc: '',
                free: '',
                checkpoint: '',
                expandSize: '',
                frag: '',
                cap: '',
                dedup: '',
                health: '',
                altRoot: '',
                autoTrim: '',
                comment: '',
                properties: [],
            };
            // Root node is named by the tree's depth-0 row.
            tb = newTreeBuilder(makeNode('', 'root', 'normal', ''));
            scanText = '';
            mode = 'none';
            break;
        case 'id':
            if (pool) pool.guid = value;
            break;
        case 'state':
            if (pool) pool.state = value;
            if (tb) tb.root.state = value;
            break;
        case 'status':
            if (pool) pool.statusText = value;
            mode = 'status';
            break;
        case 'action':
            if (pool) pool.actionText = value;
            mode = 'action';
            break;
        case 'scan':
            scanText = value;
            mode = 'scan';
            break;
        case 'config':
            mode = 'tree';
            break;
        case 'errors':
            if (pool) pool.errors = value;
            mode = 'none';
            break;
        default:
            break;
        }
    }
    finish();
    return pools;
}

export function parseZpoolStatus(output: string): Pool[] {
    return parsePoolBlocks(output);
}

export function parseZpoolImport(output: string): ImportablePool[] {
    return parsePoolBlocks(output).map(p => ({
        name: p.name,
        id: p.guid ?? '',
        state: p.state,
        statusText: p.statusText,
        actionText: p.actionText,
        vdevs: p.vdevs,
    }));
}

// ---------------------------------------------------------------------------
// zpool list: plain tree (with header) or -H rows over a column set.
// ---------------------------------------------------------------------------

const LIST_COLUMNS = [
    'name', 'size', 'alloc', 'free', 'checkpoint', 'expandsize', 'frag',
    'cap', 'dedup', 'health', 'altroot', 'autotrim', 'comment',
];

// Tree header spellings differ from the -o column names.
const LIST_HEADER_ALIASES: Record<string, string> = { ckpoint: 'checkpoint', expandsz: 'expandsize' };

function applyListColumn(pool: Pool | null, vdev: Vdev | null, col: string, value: string): void {
    switch (col) {
    case 'name': if (pool) pool.name = value; if (vdev) vdev.name = value; break;
    case 'size': if (pool) pool.size = value; break;
    case 'alloc': if (pool) pool.alloc = value; break;
    case 'free': if (pool) pool.free = value; break;
    case 'checkpoint': if (pool) pool.checkpoint = value; break;
    case 'expandsize': if (pool) pool.expandSize = value; break;
    case 'frag': if (pool) pool.frag = value; break;
    case 'cap': if (pool) pool.cap = value; break;
    case 'dedup': if (pool) pool.dedup = value; break;
    case 'health':
        if (pool) {
            pool.health = value;
            pool.state = value;
        }
        if (vdev) vdev.state = value;
        break;
    case 'altroot': if (pool) pool.altRoot = value; break;
    case 'autotrim': if (pool) pool.autoTrim = value; break;
    case 'comment': if (pool) pool.comment = value; break;
    default: break;
    }
}

function emptyListPool(): Pool {
    return {
        name: '',
        state: '',
        scan: { kind: 'none', inProgress: false, line: '' },
        errors: '',
        vdevs: [],
        size: '',
        alloc: '',
        free: '',
        checkpoint: '',
        expandSize: '',
        frag: '',
        cap: '',
        dedup: '',
        health: '',
        altRoot: '',
        autoTrim: '',
        comment: '',
        properties: [],
    };
}

export function parseZpoolList(output: string, columns: string[] = LIST_COLUMNS): Pool[] {
    const lines = output.split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];

    // Plain tree form: header line starting with NAME, rows indented 2 spaces.
    if (/^NAME\s/.test(lines[0])) {
        const cols = lines[0].trim().split(/\s+/)
                .map(c => LIST_HEADER_ALIASES[c.toLowerCase()] ?? c.toLowerCase());
        const pools: Pool[] = [];
        let pool: Pool | null = null;
        let tb: TreeBuilder | null = null;

        for (const raw of lines.slice(1)) {
            const indent = raw.match(/^ */)?.[0].length ?? 0;
            const fields = splitColumns(raw);
            const name = fields[0] ?? '';
            if (!name) continue;

            // Label rows in list output pad every other column with dashes.
            if (CLASS_LABELS[name.toLowerCase()] && fields.slice(1).every(f => f === '-' || f === '')) {
                if (tb) addClassSection(tb, name);
                continue;
            }
            const depth = Math.floor(indent / 2);
            if (depth === 0) {
                pool = emptyListPool();
                tb = newTreeBuilder(makeNode('', 'root', 'normal', ''));
                pool.vdevs = [tb.root];
                pools.push(pool);
            }
            if (!pool || !tb) continue;

            const node = depth === 0 ? tb.root : makeNode(name, vdevType(name), 'normal', '');
            // Only the root row feeds pool-level columns; vdev rows share the
            // column layout but must not overwrite the pool's values.
            cols.forEach((col, i) => applyListColumn(depth === 0 ? pool : null, node, col, fields[i] ?? ''));
            if (depth === 0) node.type = 'root';
            else addTreeNode(tb, node, depth);
        }
        return pools;
    }

    // -H row form: tab-separated over the requested column set.
    return lines.map(line => {
        const pool = emptyListPool();
        const fields = line.split('\t');
        columns.forEach((col, i) => applyListColumn(pool, null, col, fields[i] ?? ''));
        return pool;
    });
}

// ---------------------------------------------------------------------------
// zpool iostat: -H tab rows or pretty (-P) rows; both carry
// name alloc free read-ops write-ops read-bandwidth write-bandwidth.
// ---------------------------------------------------------------------------

export function parseZpoolIostat(output: string): VdevIostat[] {
    const rows: VdevIostat[] = [];
    for (const raw of output.split('\n')) {
        const line = raw.trimEnd();
        if (!line.trim()) continue;

        let fields: string[];
        if (line.includes('\t')) {
            fields = line.split('\t');
            if (fields.length < 7) continue;
        } else {
            if (/^-{2,}/.test(line.trim()) || /\bcapacity\b/.test(line) || /^pool\s/.test(line)) continue;
            const tokens = line.trim().split(/\s+/);
            if (tokens.length < 7) continue;
            fields = [tokens.slice(0, tokens.length - 6).join(' '), ...tokens.slice(-6)];
        }
        rows.push({
            name: fields[0],
            alloc: fields[1],
            free: fields[2],
            readOps: fields[3],
            writeOps: fields[4],
            read: fields[5],
            write: fields[6],
        });
    }
    return rows;
}

// ---------------------------------------------------------------------------
// zpool get: NAME PROPERTY VALUE SOURCE rows (-H tab or aligned columns).
// PoolProperty.name is the property name; the target is what you asked for.
// ---------------------------------------------------------------------------

export function parseZpoolGet(output: string): PoolProperty[] {
    const props: PoolProperty[] = [];
    for (const raw of output.split('\n')) {
        if (!raw.trim()) continue;
        const fields = splitColumns(raw);
        if (fields[0] === 'NAME') continue; // non -H header
        if (fields.length >= 4) props.push({ name: fields[1], value: fields[2], source: fields[3] });
        else if (fields.length === 3) props.push({ name: fields[0], value: fields[1], source: fields[2] });
    }
    return props;
}

// ---------------------------------------------------------------------------
// zpool history: "YYYY-MM-DD.HH:MM:SS <command>" entries; -i output adds
// internal entries and indented continuation blocks.
// ---------------------------------------------------------------------------

export function parseZpoolHistory(output: string): HistoryEntry[] {
    const entries: HistoryEntry[] = [];
    for (const raw of output.split('\n')) {
        if (/^\d{4}-\d{2}-\d{2}\.\d{2}:\d{2}:\d{2}\s/.test(raw)) {
            const sp = raw.indexOf(' ');
            entries.push({ time: raw.slice(0, sp), command: raw.slice(sp + 1) });
        } else if (/^\s/.test(raw) && raw.trim() && entries.length) {
            entries[entries.length - 1].command += '\n' + raw.trim();
        }
    }
    return entries;
}

// ---------------------------------------------------------------------------
// zpool events: "Mon DD YYYY HH:MM:SS.ns<TAB>class" rows; -v adds indented
// "key = value" detail lines.
// ---------------------------------------------------------------------------

export function parseZpoolEvents(output: string): EventEntry[] {
    const entries: EventEntry[] = [];
    for (const raw of output.split('\n')) {
        if (!raw.trim()) continue;
        if (!/^\s/.test(raw) && raw.includes('\t')) {
            const fields = raw.split('\t');
            entries.push({ time: fields[0], class: fields[1] });
        } else if (/^\s/.test(raw) && entries.length) {
            const last = entries[entries.length - 1];
            last.detail = (last.detail ?? '') ? last.detail + '\n' + raw.trim() : raw.trim();
        }
    }
    return entries;
}
