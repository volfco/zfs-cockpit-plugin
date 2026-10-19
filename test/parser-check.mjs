// Minimal parser self-check: node test/parser-check.mjs
// Fails loudly if the zfs/zpool output parsers regress. Loads the real
// captures in test/fixtures/raw/; lines marked "synthetic" are documented
// format variants that were never captured mid-flight (see plan.md).
import { readFileSync } from 'node:fs';
import {
    parseZpoolStatus, parseZpoolList, parseZpoolIostat, parseZpoolGet,
    parseZpoolHistory, parseZpoolEvents, parseZpoolImport, parsePoolScan,
    vdevType,
} from '../src/zpool.ts';
import {
    parseZfsList, parseZfsGet, parseZfsSpace, parseZfsHolds,
    parseZfsSendDryRun, parseZfsDiff, parseZfsUpgrade,
} from '../src/zfs.ts';

let failures = 0;
function check(cond, msg) {
    if (cond) return;
    failures++;
    console.error(`FAIL: ${msg}`);
}

const raw = name => readFileSync(new URL(`./fixtures/raw/${name}`, import.meta.url), 'utf8');
// Fixtures pack several captures per file, split by "=MARKER=" lines.
function sections(text) {
    const out = { '': '' };
    let cur = '';
    for (const line of text.split('\n')) {
        const m = line.match(/^=([A-Z0-9-]+)=$/);
        if (m) { cur = m[1]; out[cur] = ''; continue }
        out[cur] += line + '\n';
    }
    return out;
}

// --- zpool status: scratch pool tree (raidz1-0 + logs + cache + spares) -----
{
    const [pool] = parseZpoolStatus(sections(raw('zpool-status.txt'))['']);
    check(pool && pool.name === 'scratch' && pool.state === 'ONLINE', 'status: scratch ONLINE');
    check(pool.errors === 'No known data errors', 'status: errors line');
    const root = pool.vdevs[0];
    check(root.type === 'root' && root.read === '0' && root.cksum === '0', 'status: root row counters');
    check(root.children.length === 4, `status: 4 top entries, got ${root.children.length}`);
    const [raidz, logs, cache, spares] = root.children;
    check(raidz.name === 'raidz1-0' && raidz.type === 'raidz1' && raidz.class === 'normal',
        'status: raidz1-0 normal');
    check(raidz.children.length === 4 && raidz.children[0].type === 'file'
        && raidz.children[0].path === '/tmp/zfs-fixtures/disk1.img', 'status: raidz leaves');
    check(logs.type === 'log' && logs.children[0].name === 'mirror-1'
        && logs.children[0].class === 'log' && logs.children[0].children.length === 2,
        'status: logs section -> mirror-1');
    check(cache.type === 'cache' && cache.children[0].name === '/tmp/zfs-fixtures/disk8.img'
        && cache.children[0].class === 'cache', 'status: cache section leaf');
    check(spares.type === 'spare' && spares.children[0].state === 'AVAIL'
        && spares.children[0].class === 'spare', 'status: spares section leaf');
}

// --- DEGRADED variant: status/action prose + completed scrub -----------------
{
    const [pool] = parseZpoolStatus(sections(raw('offline-degraded.txt'))['']);
    check(pool.state === 'DEGRADED', 'degraded: state');
    check(pool.statusText.includes('taken offline'), 'degraded: status prose');
    check(pool.actionText.includes('zpool replace'), 'degraded: action prose');
    check(pool.scan.kind === 'scrub' && pool.scan.repaired === '0B' && pool.scan.errors === '0',
        'degraded: completed scrub scan line');
    const leaves = pool.vdevs[0].children[0].children;
    check(leaves[1].state === 'OFFLINE', 'degraded: offline leaf state');
    const on = parseZpoolStatus(sections(raw('offline-degraded.txt')).ON)[0];
    check(on.scan.kind === 'resilver' && on.scan.repaired === '4.50K', 'resilvered scan line');
    const replaced = parseZpoolStatus(sections(raw('replace-resilver.txt'))[''])[0];
    check(replaced.scan.kind === 'resilver' && replaced.scan.repaired === '460K',
        'replace-resilver: completed resilver scan line');
}

// --- scan lines (2 synthetic in-progress forms) ------------------------------
{
    const scrub = parsePoolScan('scrub repaired 0B in 00:00:00 with 0 errors on Sun Oct 18 11:29:59 2026');
    check(scrub.kind === 'scrub' && scrub.since === 'Sun Oct 18 11:29:59 2026', 'scan: scrub-states line');
    // synthetic: documented in-progress format (help/zpool-scrub.txt example)
    const prog = parsePoolScan('scan: scrub in progress since Sun Oct 18 11:29:59 2026, 42.5% done, 00:12:34 to go');
    check(prog.kind === 'scrub' && prog.inProgress && prog.percent === '42.5'
        && prog.since === 'Sun Oct 18 11:29:59 2026', 'scan: synthetic scrub in progress');
    // synthetic: documented in-progress format
    const res = parsePoolScan('resilver in progress since Sun Oct 18 11:30:01 2026');
    check(res.kind === 'resilver' && res.inProgress && res.since === 'Sun Oct 18 11:30:01 2026',
        'scan: synthetic resilver in progress');
}

// --- zpool iostat (-H and -P forms) -----------------------------------------
{
    const h = sections(raw('zpool-iostat.txt'))[''];
    const rows = parseZpoolIostat(h);
    const scratch = rows.find(r => r.name === 'scratch');
    check(scratch && scratch.alloc === '976K' && scratch.writeOps === '147', 'iostat -H: pool row');
    const disk1 = rows.find(r => r.name === '/tmp/zfs-fixtures/disk1.img');
    check(disk1 && disk1.writeOps === '39' && disk1.write === '95.1K', 'iostat -H: leaf row');
    const pretty = parseZpoolIostat(sections(raw('zpool-iostat.txt')).P);
    check(pretty.some(r => r.name === 'scratch' && r.free === '1.87G'), 'iostat -P: pool row');
    check(pretty.some(r => r.name === '/tmp/zfs-fixtures/disk8.img' && r.alloc === '6K'), 'iostat -P: leaf row');
}

// --- zpool get rows with sources --------------------------------------------
{
    const props = parseZpoolGet(sections(raw('zpool-get-all.txt')).H);
    const find = n => props.find(p => p.name === n);
    check(find('comment') && find('comment').value === 'cockpit-plugin-fixture'
        && find('comment').source === 'local', 'zpool get: local source');
    check(find('altroot') && find('altroot').source === 'default', 'zpool get: default source');
    check(find('health') && find('health').value === 'ONLINE' && find('health').source === '-',
        'zpool get: readonly source');
    const vdev = parseZpoolGet(sections(raw('zpool-get-all.txt')).VD);
    check(vdev.some(p => p.name === 'state' && p.value === 'ONLINE')
        && vdev.some(p => p.name === 'children'), 'zpool get: vdev get rows');
}

// --- zpool list (plain tree + -H rows) --------------------------------------
{
    const tree = parseZpoolList(sections(raw('replace-resilver.txt')).LIST);
    check(tree.length === 1 && tree[0].name === 'scratch' && tree[0].health === 'ONLINE',
        'zpool list: tree root');
    check(tree[0].vdevs[0].children.length === 4, 'zpool list: tree children');
    // fixture captured -o without altroot: name,size,alloc,free,checkpoint,
    // expandsize,frag,cap,dedup,health,autotrim,comment
    const flat = parseZpoolList(sections(raw('zpool-list.txt'))['H-O'],
        ['name', 'size', 'alloc', 'free', 'checkpoint', 'expandsize', 'frag', 'cap', 'dedup', 'health', 'autotrim', 'comment']);
    check(flat[0].autoTrim === 'off' && flat[0].comment === 'cockpit-plugin-fixture',
        'zpool list: -H -o columns');
}

// --- zfs list: all four dataset types ---------------------------------------
{
    const cols = ['name', 'type', 'used', 'avail', 'refer', 'mountpoint', 'canmount', 'keystatus'];
    const ds = parseZfsList(sections(raw('zfs-list.txt'))[''], cols);
    check(ds.length === 10, `zfs list: 10 rows, got ${ds.length}`);
    check(ds.some(d => d.type === 'filesystem') && ds.some(d => d.type === 'volume')
        && ds.some(d => d.type === 'snapshot') && ds.some(d => d.type === 'bookmark'),
    'zfs list: all four types');
    const bm = ds.find(d => d.name === 'scratch/fs1#bm1');
    check(bm && bm.type === 'bookmark' && bm.refer === '32.9K', 'zfs list: bookmark row');
    check(ds.find(d => d.name === 'scratch/fs1').mountpoint === '/mnt/scratch/fs1',
        'zfs list: mountpoint column');
    // per-type sections: type inferred from @/# names
    const snaps = parseZfsList(sections(raw('zfs-list.txt')).S, ['name', 'used', 'avail', 'refer', 'written']);
    check(snaps.length === 2 && snaps.every(d => d.type === 'snapshot'), 'zfs list: snapshot section');
    const bms = parseZfsList(sections(raw('zfs-list.txt')).B, ['name', 'used', 'avail', 'refer']);
    check(bms.length === 1 && bms[0].type === 'bookmark', 'zfs list: bookmark section');
}

// --- zfs get source parsing --------------------------------------------------
{
    const props = parseZfsGet(sections(raw('zfs-get-sources.txt'))['']);
    const find = n => props.find(p => p.name === n);
    check(find('quota').source === 'local', 'zfs get: local source');
    check(find('reservation').source === 'default', 'zfs get: default source');
    check(find('type').source === '-', 'zfs get: none source');
    const rec = parseZfsGet(sections(raw('zfs-get-sources.txt')).REC);
    check(rec.length > 50 && rec.every(p => p.received !== undefined)
        && rec.find(p => p.name === 'usedbydataset').value === '32.9K', 'zfs get: received column');
    // synthetic: inherited source form (not present in the captures)
    const inh = parseZfsGet('scratch/enc/child\tcompression\ton\tinherited from scratch/enc\t-');
    check(inh[0].source === 'inherited from scratch/enc', 'zfs get: inherited source');
}

// --- holds / send dry-run ----------------------------------------------------
{
    const holds = parseZfsHolds(sections(raw('zfs-holds.txt'))['']);
    check(holds.length === 1 && holds[0].name === 'scratch/fs1@snap1'
        && holds[0].tag === 'keep' && holds[0].timestamp.includes('2026'), 'holds row');
    const full = parseZfsSendDryRun(sections(raw('zfs-send-dryrun.txt'))['']);
    check(full.kind === 'full' && full.to === 'scratch/fs1@snap1' && full.size === '12912',
        'send dry-run: full');
    const inc = parseZfsSendDryRun(sections(raw('zfs-send-dryrun.txt')).INC);
    check(inc.kind === 'incremental' && inc.from === 'scratch/fs1@snap1'
        && inc.to === 'scratch/fs1@snap2' && inc.size === '624', 'send dry-run: incremental');
}

// --- import listing with damaged pools --------------------------------------
{
    const pools = parseZpoolImport(sections(raw('export-import.txt')).IMPORT);
    check(pools.length === 2, `import: 2 pools, got ${pools.length}`);
    const hdd0 = pools.find(p => p.name === 'hdd0');
    const ssd1 = pools.find(p => p.name === 'ssd1');
    check(hdd0.state === 'UNAVAIL' && hdd0.id === '7202412747075044166'
        && hdd0.statusText.includes('corrupted data'), 'import: hdd0 block');
    const hddRoot = hdd0.vdevs[0];
    check(hddRoot.type === 'root' && hddRoot.message === 'insufficient replicas',
        'import: root message');
    check(hddRoot.children[1].name === 'mirror-1' && hddRoot.children[1].state === 'UNAVAIL'
        && hddRoot.children[4].name === 'indirect-4' && hddRoot.children[4].type === 'indirect',
        'import: hdd0 vdev states');
    check(ssd1.state === 'DEGRADED' && ssd1.actionText.includes('can be imported'),
        'import: ssd1 block');
    const raidz = ssd1.vdevs[0].children[0];
    check(raidz.name === 'raidz2-0' && raidz.type === 'raidz2' && raidz.state === 'DEGRADED'
        && raidz.children.length === 9
        && raidz.children[8].name === 'scsi-358ce38ee204afda9'
        && raidz.children[8].state === 'UNAVAIL', 'import: ssd1 vdev states');
}

// --- history / events --------------------------------------------------------
{
    const hist = parseZpoolHistory(sections(raw('zpool-history.txt'))['']);
    check(hist.length === 15 && hist[0].time === '2026-10-18.11:28:30'
        && hist[0].command.startsWith('zpool create'), 'history rows');
    const internal = parseZpoolHistory(sections(raw('zpool-history.txt')).I);
    check(internal.some(e => e.command.includes('ioctl hold')), 'history: -i internal entries');
    const events = parseZpoolEvents(raw('zpool-events.txt'));
    check(events.length >= 20 && events[0].class === 'sysevent.fs.zfs.config_sync'
        && events[0].time.startsWith('Oct 18 2026'), 'events rows');
    const verbose = parseZpoolEvents(raw('events-verbose.txt'));
    check(verbose.some(e => (e.detail || '').includes('pool = "scratch"')), 'events: -v details');
}

// --- space / upgrade --------------------------------------------------------
{
    // zfs-space.txt captured `zfs space`, which is not a subcommand; error
    // text must not parse into rows. Real form is `zfs list -H -o space`.
    check(parseZfsSpace(raw('zfs-space.txt')).length === 0, 'space: error text yields no rows');
    // synthetic: `zfs list -H -o space` row
    const space = parseZfsSpace('scratch/fs1\t236M\t65.8K\t0B\t32.9K\t0B\t0B');
    check(space[0].usedByRefreservation === '0B' && space[0].avail === '236M', 'space: row parse');
    const up = parseZfsUpgrade(raw('upgrade-versions.txt'));
    check(up.versions.includes('1') && up.versions.includes('5'), 'upgrade: filesystem versions');
    check(up.features.includes('async_destroy') && up.features.includes('userobj_accounting'),
        'upgrade: pool features');
}

// --- zfs diff: plain and -t tab forms (zfs-diff.txt real captures) -----------
{
    const fix = sections(raw('zfs-diff.txt'));
    const plain = parseZfsDiff(fix.PLAIN);
    check(plain.length === 5, `diff plain: 5 rows, got ${plain.length}`);
    check(plain[0].change === 'M' && plain[0].path === '/mnt/scratch/fs1/'
        && plain[0].timestamp === undefined && plain[0].fileType === undefined,
    'diff plain: first row');
    check(plain[1].change === '+' && plain[1].path === '/mnt/scratch/fs1/dir1',
        'diff plain: added dir');
    const ht = parseZfsDiff(fix.HT);
    check(ht.length === 5, `diff -H -t: 5 rows, got ${ht.length}`);
    check(typeof ht[0].timestamp === 'string' && ht[0].timestamp === '1792367286.480996292',
        'diff -H -t: timestamp preserved as string');
    check(ht[0].change === 'M' && ht[0].fileType === '/' && ht[1].fileType === '/',
        'diff -H -t: change M + dir type /');
    check(ht[2].change === '+' && ht[2].fileType === 'F'
        && ht[2].path === '/mnt/scratch/fs1/dir1/nested.txt',
    'diff -H -t: change + + file type F');
    check(ht[3].timestamp === '1792367286.456996160', 'diff -H -t: per-row timestamps');
    const single = parseZfsDiff(fix.HTSINGLE);
    check(single.length === 5 && single[0].timestamp === '1792367286.480996292'
        && single[0].change === 'M' && single[0].path === '/mnt/scratch/fs1/'
        && single[0].fileType === undefined, 'diff -H -t without -F: 3-field rows');
}

// --- replacing-1 pseudo-vdev nested in raidz (mid-resilver capture) ---------
{
    const [pool] = parseZpoolStatus(sections(raw('replacing-capture.txt'))['']);
    check(pool && pool.name === 'scratch' && pool.state === 'ONLINE', 'replacing: pool row');
    const raidz = pool.vdevs[0].children[0];
    check(raidz.name === 'raidz1-0' && raidz.children.length === 4, 'replacing: raidz1-0 leaves');
    const replacing = raidz.children[1];
    check(replacing.name === 'replacing-1' && replacing.type === 'replacing'
        && replacing.children.length === 2
        && replacing.children[0].name === '/tmp/zfs-fixtures/disk2.img'
        && replacing.children[1].name === '/tmp/zfs-fixtures/disk10.img',
    'replacing: replacing-1 with two children nested in raidz1-0');
    check(vdevType('draid2-0') === 'draid', 'vdevType: draid');
}

if (failures) {
    console.error(`${failures} parser check(s) failed`);
    process.exit(1);
}
console.log('parser checks OK');
