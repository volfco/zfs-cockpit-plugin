import React from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import BookmarkIcon from "@patternfly/react-icons/dist/esm/icons/bookmark-icon.js";
import CameraIcon from "@patternfly/react-icons/dist/esm/icons/camera-icon.js";
import CubeIcon from "@patternfly/react-icons/dist/esm/icons/cube-icon.js";
import DatabaseIcon from "@patternfly/react-icons/dist/esm/icons/database-icon.js";
import cockpit from 'cockpit';

import { ActionMenu } from './actions';
import {
    datasetActions, openCreateDataset, openCreateVolume, useDsDialogs,
} from './datasetActions';
import { PropertiesPanel } from './propertiesPanel';
import * as svc from '../service';
import type {
    Dataset, DatasetType, DiffEntry, HoldEntry, SpaceEntry, SystemOverview, UsageEntry,
} from '../types';

const _ = cockpit.gettext;

const TYPE_LABELS: Record<DatasetType, string> = {
    filesystem: _("filesystem"),
    volume: _("volume"),
    snapshot: _("snapshot"),
    bookmark: _("bookmark"),
};

function typeIcon(type: DatasetType) {
    if (type === 'volume') return <DatabaseIcon />;
    if (type === 'snapshot') return <CameraIcon />;
    if (type === 'bookmark') return <BookmarkIcon />;
    return <CubeIcon />;
}

// Snapshot/bookmark rows sit one indent level under their filesystem.
function baseName(d: Dataset): string {
    if (d.type === 'snapshot') return d.name.slice(0, d.name.indexOf('@'));
    if (d.type === 'bookmark') return d.name.slice(0, d.name.indexOf('#'));
    return d.name;
}

function depthOf(d: Dataset): number {
    const extra = (d.type === 'snapshot' || d.type === 'bookmark') ? 1 : 0;
    return baseName(d).split('/').length - 1 + extra;
}

function leafOf(d: Dataset): string {
    if (d.type === 'snapshot') return d.name.slice(d.name.indexOf('@'));
    if (d.type === 'bookmark') return d.name.slice(d.name.indexOf('#'));
    return d.name.split('/').pop() ?? d.name;
}

// Screen-reader-only caption for the hand-built PF tables (no
// @patternfly/react-table dependency available).
function TableCaption({ text }: { text: string }) {
    return <caption className="pf-v6-u-screen-reader">{text}</caption>;
}

function SimpleTable({ label, columns, rows }: { label: string; columns: string[]; rows: string[][] }) {
    return (
        <div className="zfs-table-region" role="region" aria-label={label} tabIndex={0}>
            <table className="pf-v6-c-table pf-m-compact pf-m-grid-lg" aria-label={label}>
                <TableCaption text={label} />
                <thead className="pf-v6-c-table__thead">
                    <tr className="pf-v6-c-table__tr">
                        {columns.map(c => (
                            <th key={c} className="pf-v6-c-table__th" scope="col">{c}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="pf-v6-c-table__tbody">
                    {rows.map((r, i) => (
                        <tr key={i} className="pf-v6-c-table__tr">
                            {r.map((cell, j) => (
                                <td key={j} className="pf-v6-c-table__td" data-label={columns[j]}>{cell || '—'}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Detail tab panels — each fetches lazily on first mount and refetches when
// the page-wide reloadKey bumps (any command completed).
// ---------------------------------------------------------------------------

function SpacePanel({ name, reloadKey }: { name: string; reloadKey: number }) {
    const [rows, setRows] = React.useState<SpaceEntry[] | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        svc.fetchSpace(name)
                .then(setRows)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, [name, reloadKey]);

    if (error) return <Alert variant="danger" title={_("Command failed")} isInline>{error}</Alert>;
    if (!rows) return <span className="pf-v6-u-color-200">{_("Loading…")}</span>;
    return (
        <SimpleTable
            label={cockpit.format(_("Space usage of $0"), name)}
            columns={[_("Name"), _("Avail"), _("Used"), _("Used by snapshots"), _("Used by dataset"), _("Used by refreservation"), _("Used by children")]}
            rows={rows.map(s => [
                s.name, s.avail, s.used, s.usedBySnapshot, s.usedByDataset,
                s.usedByRefreservation, s.usedByChildren,
            ])}
        />
    );
}

function HoldsPanel({ name, reloadKey }: { name: string; reloadKey: number }) {
    const [rows, setRows] = React.useState<HoldEntry[] | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        svc.fetchHolds(name)
                .then(setRows)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, [name, reloadKey]);

    if (error) return <Alert variant="danger" title={_("Command failed")} isInline>{error}</Alert>;
    if (!rows) return <span className="pf-v6-u-color-200">{_("Loading…")}</span>;
    return (
        <SimpleTable
            label={cockpit.format(_("Holds on $0"), name)}
            columns={[_("Snapshot"), _("Tag"), _("Held since")]}
            rows={rows.map(h => [h.name, h.tag, h.timestamp])}
        />
    );
}

function DiffPanel({ ds, datasets, reloadKey }: { ds: Dataset; datasets: Dataset[]; reloadKey: number }) {
    const fsName = ds.type === 'snapshot' ? ds.name.slice(0, ds.name.indexOf('@')) : ds.name;
    const snaps = datasets.filter(d => d.type === 'snapshot' && d.name.startsWith(`${fsName}@`));
    const [snap, setSnap] = React.useState(ds.type === 'snapshot' ? ds.name : snaps[0]?.name ?? '');
    const [rows, setRows] = React.useState<DiffEntry[] | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!snap) return;
        svc.fetchDiff(snap)
                .then(setRows)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, [snap, reloadKey]);

    if (ds.type === 'bookmark')
        return <span className="pf-v6-u-color-200">{_("Diff is not available for bookmarks.")}</span>;
    if (ds.type === 'volume')
        return <span className="pf-v6-u-color-200">{_("Diff is not available for volumes.")}</span>;

    return (
        <>
            {ds.type !== 'snapshot' && (
                <Flex className="pf-v6-u-mb-sm">
                    <FlexItem>
                        <FormSelect
                            aria-label={_("Snapshot to compare with")}
                            value={snap}
                            onChange={(_e, v) => { setSnap(v); setRows(null) }}
                        >
                            <FormSelectOption value="" label="—" />
                            {snaps.map(s => (
                                <FormSelectOption key={s.name} value={s.name} label={s.name} />
                            ))}
                        </FormSelect>
                    </FlexItem>
                </Flex>
            )}
            {error && <Alert variant="danger" title={_("Command failed")} isInline>{error}</Alert>}
            {!error && !rows && snap && <span className="pf-v6-u-color-200">{_("Loading…")}</span>}
            {rows && (
                <SimpleTable
                    label={cockpit.format(_("Changes since $0"), snap)}
                    columns={[_("Change"), _("Path"), _("New path"), _("Timestamp")]}
                    rows={rows.map(d => [d.change, d.path, d.newPath ?? '', d.timestamp ?? ''])}
                />
            )}
        </>
    );
}

function UsagePanel({ name, reloadKey }: { name: string; reloadKey: number }) {
    const [kind, setKind] = React.useState<'userspace' | 'groupspace' | 'projectspace'>('userspace');
    const [rows, setRows] = React.useState<UsageEntry[] | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        svc.fetchUsage(kind, name)
                .then(setRows)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, [kind, name, reloadKey]);

    return (
        <>
            <Flex className="pf-v6-u-mb-sm">
                <FlexItem>
                    <FormSelect
                        aria-label={_("Usage type")}
                        value={kind}
                        onChange={(_e, v) => { setKind(v as typeof kind); setRows(null) }}
                    >
                        <FormSelectOption value="userspace" label={_("Userspace")} />
                        <FormSelectOption value="groupspace" label={_("Groupspace")} />
                        <FormSelectOption value="projectspace" label={_("Projectspace")} />
                    </FormSelect>
                </FlexItem>
            </Flex>
            {error && <Alert variant="danger" title={_("Command failed")} isInline>{error}</Alert>}
            {!error && !rows && <span className="pf-v6-u-color-200">{_("Loading…")}</span>}
            {rows && (
                <SimpleTable
                    label={cockpit.format(_("$0 of $1"), kind, name)}
                    columns={[_("Type"), _("Name"), _("Used"), _("Quota"), _("Objects used"), _("Object quota")]}
                    rows={rows.map(u => [u.type, u.name, u.used, u.quota, u.objUsed, u.objQuota])}
                />
            )}
        </>
    );
}

const DETAIL_TABS = [
    { key: 'properties', label: _("Properties") },
    { key: 'space', label: _("Space") },
    { key: 'holds', label: _("Holds") },
    { key: 'diff', label: _("Diff") },
    { key: 'userspace', label: _("Userspace") },
];

function DatasetDetails({ ds, datasets, reloadKey, onChanged }: {
    ds: Dataset;
    datasets: Dataset[];
    reloadKey: number;
    onChanged: () => void;
}) {
    const [tab, setTab] = React.useState('properties');
    // Visited tabs stay mounted (their dialogs must survive tab switches);
    // only the first activation fetches, reloadKey refetches mounted panels.
    const [visited, setVisited] = React.useState<Set<string>>(() => new Set(['properties']));

    React.useEffect(() => {
        setVisited(v => (v.has(tab) ? v : new Set(v).add(tab)));
    }, [tab]);

    const panel = (key: string) => {
        switch (key) {
        case 'properties':
            return <PropertiesPanel target={ds.name} reloadKey={reloadKey} onChanged={onChanged} />;
        case 'space':
            return <SpacePanel name={ds.name} reloadKey={reloadKey} />;
        case 'holds':
            return ds.type === 'snapshot'
                ? <HoldsPanel name={ds.name} reloadKey={reloadKey} />
                : <span className="pf-v6-u-color-200">{_("Holds apply to snapshots only.")}</span>;
        case 'diff':
            return <DiffPanel ds={ds} datasets={datasets} reloadKey={reloadKey} />;
        default:
            return <UsagePanel name={ds.name} reloadKey={reloadKey} />;
        }
    };

    // Hand-built tab strip: the PF Tabs component types need @types/node
    // (absent) and its stylesheet is not loaded by app.scss.
    return (
        <div>
            <div role="tablist" aria-label={_("Dataset details")}>
                <Flex spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'wrap' }}>
                    {DETAIL_TABS.map(t => (
                        <FlexItem key={t.key}>
                            <Button
                                role="tab"
                                aria-selected={tab === t.key}
                                variant={tab === t.key ? 'primary' : 'secondary'}
                                onClick={() => setTab(t.key)}
                            >
                                {t.label}
                            </Button>
                        </FlexItem>
                    ))}
                </Flex>
            </div>
            <div role="tabpanel" className="pf-v6-u-mt-md">
                {DETAIL_TABS.filter(t => visited.has(t.key)).map(t => (
                    <div key={t.key} hidden={t.key !== tab}>
                        {panel(t.key)}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Datasets page — flat hierarchy table (fs children indented under parents,
// snapshots and bookmarks as children of their fs) with per-row expandable
// details and the full zfs action surface in the row menu.
// ---------------------------------------------------------------------------

export function DatasetsPage({ overview, refresh }: { overview: SystemOverview; refresh: () => void }) {
    const [tick, setTick] = React.useState(0);
    const [search, setSearch] = React.useState('');
    const [typeFilter, setTypeFilter] = React.useState('all');
    const [expanded, setExpanded] = React.useState<string | null>(null);

    const changed = () => {
        setTick(t => t + 1);
        refresh();
    };
    const dialogs = useDsDialogs(changed);

    const rows = overview.datasets.filter(d =>
        (typeFilter === 'all' || d.type === typeFilter) &&
        d.name.toLowerCase().includes(search.trim().toLowerCase()));

    const toggle = (name: string) => setExpanded(prev => (prev === name ? null : name));
    const label = _("ZFS datasets");

    return (
        <>
            <Flex
                spaceItems={{ default: 'spaceItemsSm' }}
                className="pf-v6-u-mb-md"
                flexWrap={{ default: 'wrap' }}
            >
                <FlexItem>
                    <Button variant="primary" onClick={() => openCreateDataset(dialogs, '')}>
                        {_("Create dataset…")}
                    </Button>
                </FlexItem>
                <FlexItem>
                    <Button variant="secondary" onClick={() => openCreateVolume(dialogs, '')}>
                        {_("Create volume…")}
                    </Button>
                </FlexItem>
                <FlexItem>
                    <TextInput
                        aria-label={_("Search datasets")}
                        placeholder={_("Search names")}
                        value={search}
                        onChange={(_e, v) => setSearch(v)}
                    />
                </FlexItem>
                <FlexItem>
                    <FormSelect
                        aria-label={_("Filter by type")}
                        value={typeFilter}
                        onChange={(_e, v) => setTypeFilter(v)}
                    >
                        <FormSelectOption value="all" label={_("All types")} />
                        <FormSelectOption value="filesystem" label={TYPE_LABELS.filesystem} />
                        <FormSelectOption value="volume" label={TYPE_LABELS.volume} />
                        <FormSelectOption value="snapshot" label={TYPE_LABELS.snapshot} />
                        <FormSelectOption value="bookmark" label={TYPE_LABELS.bookmark} />
                    </FormSelect>
                </FlexItem>
            </Flex>

            {rows.length === 0
                ? <Alert variant="info" title={_("No datasets match the filter")} isInline />
                : (
                    <div className="zfs-table-region" role="region" aria-label={label} tabIndex={0}>
                        <table className="pf-v6-c-table pf-m-compact pf-m-grid-lg" aria-label={label}>
                            <TableCaption text={label} />
                            <thead className="pf-v6-c-table__thead">
                                <tr className="pf-v6-c-table__tr">
                                    <th className="pf-v6-c-table__th" scope="col">{_("Name")}</th>
                                    <th className="pf-v6-c-table__th" scope="col">{_("Type")}</th>
                                    <th className="pf-v6-c-table__th" scope="col">{_("Used")}</th>
                                    <th className="pf-v6-c-table__th" scope="col">{_("Avail")}</th>
                                    <th className="pf-v6-c-table__th" scope="col">{_("Refer")}</th>
                                    <th className="pf-v6-c-table__th" scope="col">{_("Mountpoint")}</th>
                                    <th className="pf-v6-c-table__th" scope="col" />
                                </tr>
                            </thead>
                            {rows.map(d => {
                                const isExpanded = expanded === d.name;
                                return (
                                    <tbody className="pf-v6-c-table__tbody" key={d.name}>
                                        <tr className="pf-v6-c-table__tr" onClick={() => toggle(d.name)}>
                                            <td className="pf-v6-c-table__td" data-label={_("Name")}>
                                                <span
                                                    style={{
                                                        paddingInlineStart: `calc(${depthOf(d)} * 1.25rem)`,
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                    }}
                                                >
                                                    {typeIcon(d.type)}
                                                    <Button
                                                        variant="link"
                                                        isInline
                                                        aria-expanded={isExpanded}
                                                        onClick={e => { e.stopPropagation(); toggle(d.name) }}
                                                    >
                                                        {leafOf(d)}
                                                    </Button>
                                                </span>
                                            </td>
                                            <td className="pf-v6-c-table__td" data-label={_("Type")}>
                                                <Label color="grey">{TYPE_LABELS[d.type]}</Label>
                                            </td>
                                            <td className="pf-v6-c-table__td" data-label={_("Used")}>{d.used}</td>
                                            <td className="pf-v6-c-table__td" data-label={_("Avail")}>{d.avail || '—'}</td>
                                            <td className="pf-v6-c-table__td" data-label={_("Refer")}>{d.refer}</td>
                                            <td className="pf-v6-c-table__td" data-label={_("Mountpoint")}>{d.mountpoint || '—'}</td>
                                            <td
                                                className="pf-v6-c-table__td zfs-row-actions"
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <ActionMenu
                                                    items={datasetActions(d, overview.datasets, dialogs)}
                                                    label={cockpit.format(_("Actions for $0"), d.name)}
                                                />
                                            </td>
                                        </tr>
                                        {isExpanded && (
                                            <tr className="zfs-pd-details-row">
                                                <td colSpan={7}>
                                                    <div className="zfs-pd-details">
                                                        <DatasetDetails
                                                            ds={d}
                                                            datasets={overview.datasets}
                                                            reloadKey={tick}
                                                            onChanged={changed}
                                                        />
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                );
                            })}
                        </table>
                    </div>
                )}
            {dialogs.node}
        </>
    );
}
