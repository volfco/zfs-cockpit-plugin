import React from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { CodeBlock, CodeBlockCode } from "@patternfly/react-core/dist/esm/components/CodeBlock/index.js";
import { DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import CubeIcon from "@patternfly/react-icons/dist/esm/icons/cube-icon.js";
import OkIcon from "@patternfly/react-icons/dist/esm/icons/ok-icon.js";
import InProgressIcon from "@patternfly/react-icons/dist/esm/icons/in-progress-icon.js";
import WarningTriangleIcon from "@patternfly/react-icons/dist/esm/icons/warning-triangle-icon.js";
import ErrorCircleOIcon from "@patternfly/react-icons/dist/esm/icons/error-circle-o-icon.js";
import PencilAltIcon from "@patternfly/react-icons/dist/esm/icons/pencil-alt-icon.js";
import cockpit from 'cockpit';

import { ActionMenu, useDialogs, poolActions, vdevActions } from './actions';
import * as svc from '../service';
import type { Pool, SystemOverview, Vdev } from '../types';

const _ = cockpit.gettext;

type PFColor = 'blue' | 'green' | 'grey' | 'orange' | 'orangered' | 'purple' | 'red' | 'teal' | 'yellow';

function statusColor(status: string): PFColor {
    const s = status.toLowerCase();
    if (s === 'online' || s === 'avail' || s === 'active') return 'green';
    if (s === 'degraded' || s === 'unavail' || s === 'faulted' || s === 'suspended') return 'orangered';
    return 'grey';
}

function statusIcon(status: string) {
    const s = status.toLowerCase();
    if (s === 'online' || s === 'avail' || s === 'active') return <OkIcon />;
    if (s === 'degraded') return <WarningTriangleIcon />;
    if (s === 'unavail' || s === 'faulted' || s === 'suspended') return <ErrorCircleOIcon />;
    return undefined;
}

function StatusLabel({ status }: { status: string }) {
    if (!status) return <span className="pf-v6-u-color-200">—</span>;
    return (
        <Label
            color={statusColor(status)}
            icon={statusIcon(status)}
        >
            {status}
        </Label>
    );
}

// Screen-reader-only caption for the hand-built PF tables (no
// @patternfly/react-table dependency available).
function TableCaption({ text }: { text: string }) {
    return <caption className="pf-v6-u-screen-reader">{text}</caption>;
}

// ---------------------------------------------------------------------------
// Vdev tree — hand-built PF table mirroring `zpool status` layout: root row
// (the pool), class section labels (logs/cache/spares/special/dedup), then
// vdevs indented per depth with READ/WRITE/CKSUM counters.
// ---------------------------------------------------------------------------

interface FlatRow {
    node: Vdev;
    depth: number;
}

// Class section labels carry no state; their children render at the label's
// child indent so the table matches the CLI layout.
function isSection(node: Vdev): boolean {
    return node.state === '' && node.children.length > 0;
}

function flattenVdevs(nodes: Vdev[], depth: number, out: FlatRow[]): void {
    for (const node of nodes) {
        const section = isSection(node);
        out.push({ node, depth: section ? 0 : depth });
        flattenVdevs(node.children, section ? 1 : depth + 1, out);
    }
}

function VdevTree({ pool, refresh }: { pool: Pool; refresh: () => void }) {
    const dialogs = useDialogs(refresh);
    const rows: FlatRow[] = [];
    flattenVdevs(pool.vdevs, 0, rows);
    const label = cockpit.format(_("Virtual devices of pool $0"), pool.name);

    return (
        <>
            <div className="zfs-table-region" role="region" aria-label={label} tabIndex={0}>
                <table className="pf-v6-c-table pf-m-compact pf-m-grid-lg" aria-label={label}>
                    <TableCaption text={label} />
                    <thead className="pf-v6-c-table__thead">
                        <tr className="pf-v6-c-table__tr">
                            <th className="pf-v6-c-table__th" scope="col">{_("Name")}</th>
                            <th className="pf-v6-c-table__th" scope="col">{_("Type")}</th>
                            <th className="pf-v6-c-table__th" scope="col">{_("State")}</th>
                            <th className="pf-v6-c-table__th" scope="col">{_("Read")}</th>
                            <th className="pf-v6-c-table__th" scope="col">{_("Write")}</th>
                            <th className="pf-v6-c-table__th" scope="col">{_("Cksum")}</th>
                            <th className="pf-v6-c-table__th" scope="col">{_("Capacity")}</th>
                            <th className="pf-v6-c-table__th" scope="col" />
                        </tr>
                    </thead>
                    {rows.map(({ node, depth }, idx) => {
                        if (isSection(node)) {
                            return (
                                <tbody className="pf-v6-c-table__tbody" key={`${idx}-${node.name}`}>
                                    <tr className="pf-v6-c-table__tr">
                                        <td className="pf-v6-c-table__td zfs-vdev-section" colSpan={8}>{node.name}</td>
                                    </tr>
                                </tbody>
                            );
                        }
                        const isRoot = node.type === 'root';
                        return (
                            <tbody className="pf-v6-c-table__tbody" key={`${idx}-${node.name}`}>
                                <tr className="pf-v6-c-table__tr">
                                    <td className="pf-v6-c-table__td" data-label={_("Name")}>
                                        <span
                                            className={isRoot ? 'pf-v6-u-font-weight-bold' : undefined}
                                            style={{ paddingInlineStart: `calc(${depth} * 1.25rem)` }}
                                        >
                                            {node.name}
                                        </span>
                                        {node.message && (
                                            <div className="pf-v6-u-color-200 pf-v6-u-font-size-sm">{node.message}</div>
                                        )}
                                    </td>
                                    <td className="pf-v6-c-table__td" data-label={_("Type")}>{node.type}</td>
                                    <td className="pf-v6-c-table__td" data-label={_("State")}><StatusLabel status={node.state} /></td>
                                    <td className="pf-v6-c-table__td" data-label={_("Read")}>{node.read || '—'}</td>
                                    <td className="pf-v6-c-table__td" data-label={_("Write")}>{node.write || '—'}</td>
                                    <td className="pf-v6-c-table__td" data-label={_("Cksum")}>{node.cksum || '—'}</td>
                                    <td className="pf-v6-c-table__td" data-label={_("Capacity")}>
                                        {node.iostat ? `${node.iostat.alloc} / ${node.iostat.free}` : '—'}
                                    </td>
                                    <td className="pf-v6-c-table__td zfs-row-actions">
                                        <ActionMenu
                                            items={isRoot ? poolActions(pool, dialogs) : vdevActions(pool, node, dialogs)}
                                            label={cockpit.format(_("Actions for $0"), node.name)}
                                        />
                                    </td>
                                </tr>
                            </tbody>
                        );
                    })}
                </table>
            </div>
            {dialogs.node}
        </>
    );
}

// ---------------------------------------------------------------------------
// Pool properties — `zpool get all` table with inline edit (zpool set).
// ---------------------------------------------------------------------------

function PropertiesTable({ pool, refresh }: { pool: Pool; refresh: () => void }) {
    const [editing, setEditing] = React.useState<string | null>(null);
    const [draft, setDraft] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const save = async (prop: string) => {
        setBusy(true);
        setError(null);
        try {
            await svc.poolSet({ properties: { [prop]: draft }, pool: pool.name });
            setEditing(null);
            refresh();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const startEdit = (prop: string, value: string) => {
        setEditing(prop);
        setDraft(value);
        setError(null);
    };

    return (
        <>
            <div className="zfs-table-region" role="region" aria-label={_("Properties")} tabIndex={0}>
                <table className="pf-v6-c-table pf-m-compact pf-m-grid-lg" aria-label={_("Properties")}>
                    <TableCaption text={_("Properties")} />
                    <thead className="pf-v6-c-table__thead">
                        <tr className="pf-v6-c-table__tr">
                            <th className="pf-v6-c-table__th" scope="col">{_("Property")}</th>
                            <th className="pf-v6-c-table__th" scope="col">{_("Value")}</th>
                            <th className="pf-v6-c-table__th" scope="col">{_("Source")}</th>
                            <th className="pf-v6-c-table__th" scope="col" />
                        </tr>
                    </thead>
                    <tbody className="pf-v6-c-table__tbody">
                        {pool.properties.map(p => (
                            <tr className="pf-v6-c-table__tr" key={p.name}>
                                <th className="pf-v6-c-table__th" scope="row" data-label={_("Property")}>{p.name}</th>
                                <td className="pf-v6-c-table__td" data-label={_("Value")}>
                                    {editing === p.name
                                        ? (
                                            <TextInput
                                                aria-label={cockpit.format(_("Value of $0"), p.name)}
                                                value={draft}
                                                onChange={(_e, v) => setDraft(v)}
                                            />
                                        )
                                        : p.value}
                                </td>
                                <td className="pf-v6-c-table__td" data-label={_("Source")}>{p.source}</td>
                                <td className="pf-v6-c-table__td zfs-row-actions">
                                    {editing === p.name
                                        ? (
                                            <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                                                <Button variant="primary" size="sm" isLoading={busy} onClick={() => save(p.name)}>
                                                    {_("Save")}
                                                </Button>
                                                <Button variant="link" size="sm" isDisabled={busy} onClick={() => setEditing(null)}>
                                                    {_("Cancel")}
                                                </Button>
                                            </Flex>
                                        )
                                        : (
                                            <Button
                                                variant="plain"
                                                aria-label={cockpit.format(_("Edit $0"), p.name)}
                                                icon={<PencilAltIcon />}
                                                onClick={() => startEdit(p.name, p.value)}
                                            />
                                        )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {error && (
                <Alert variant="danger" title={_("Command failed")} isInline className="pf-v6-u-mt-sm">
                    {error}
                </Alert>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Raw `zpool status -P` output, fetched lazily on first expansion.
// ---------------------------------------------------------------------------

function RawStatus({ pool }: { pool: Pool }) {
    const [expanded, setExpanded] = React.useState(false);
    const [output, setOutput] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const fetched = React.useRef(false);

    React.useEffect(() => {
        if (!expanded || fetched.current) return;
        fetched.current = true;
        // Read-only display of data already summarized above; logged only
        // when discovery logging is enabled.
        svc.runZpool(['status', '-P', pool.name], {
            reason: cockpit.format(_("Show raw status of pool $0"), pool.name),
            discovery: true,
        })
                .then(setOutput)
                .catch(e => setError(e instanceof Error ? e.message : String(e)));
    }, [expanded, pool.name]);

    return (
        <ExpandableSection
            toggleText={_("Raw status")}
            isExpanded={expanded}
            onToggle={(_e, v) => setExpanded(v)}
        >
            {error && <Alert variant="danger" title={_("Command failed")} isInline>{error}</Alert>}
            {!error && !output && <span className="pf-v6-u-color-200">{_("Loading…")}</span>}
            {output && (
                <CodeBlock>
                    <CodeBlockCode>{output}</CodeBlockCode>
                </CodeBlock>
            )}
        </ExpandableSection>
    );
}

// ---------------------------------------------------------------------------
// Pool card
// ---------------------------------------------------------------------------

function PoolCard({ pool, refresh }: { pool: Pool; refresh: () => void }) {
    const dialogs = useDialogs(refresh);
    const [showProperties, setShowProperties] = React.useState(false);

    return (
        <Card className="zfs-pool-card">
            <CardHeader
                hasWrap
                actions={{
                    actions: (
                        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                            <StatusLabel status={pool.state} />
                            <ActionMenu items={poolActions(pool, dialogs)} label={cockpit.format(_("Actions for pool $0"), pool.name)} />
                        </Flex>
                    ),
                    hasNoOffset: false,
                }}
            >
                <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                    <CubeIcon />
                    <FlexItem>
                        <Title headingLevel="h3" size="lg">{pool.name}</Title>
                        <span className="pf-v6-u-color-200 pf-v6-u-font-size-sm">
                            {cockpit.format(_("Size $0 · Allocated $1 · Free $2"), pool.size, pool.alloc, pool.free)}
                        </span>
                    </FlexItem>
                </Flex>
            </CardHeader>
            {dialogs.node}
            <CardBody>
                <DescriptionList isHorizontal isCompact columnModifier={{ default: '1Col', lg: '2Col' }}>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Capacity")}</DescriptionListTerm>
                        <DescriptionListDescription>{pool.cap || '—'}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Allocated")}</DescriptionListTerm>
                        <DescriptionListDescription>{pool.alloc || '—'}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Free")}</DescriptionListTerm>
                        <DescriptionListDescription>{pool.free || '—'}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Fragmentation")}</DescriptionListTerm>
                        <DescriptionListDescription>{pool.frag || '—'}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Dedup")}</DescriptionListTerm>
                        <DescriptionListDescription>{pool.dedup || '—'}</DescriptionListDescription>
                    </DescriptionListGroup>
                    {pool.checkpoint && pool.checkpoint !== '-' && (
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Checkpoint")}</DescriptionListTerm>
                            <DescriptionListDescription>{pool.checkpoint}</DescriptionListDescription>
                        </DescriptionListGroup>
                    )}
                    {pool.altRoot && pool.altRoot !== '-' && (
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Altroot")}</DescriptionListTerm>
                            <DescriptionListDescription>{pool.altRoot}</DescriptionListDescription>
                        </DescriptionListGroup>
                    )}
                    {pool.comment && (
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Comment")}</DescriptionListTerm>
                            <DescriptionListDescription>{pool.comment}</DescriptionListDescription>
                        </DescriptionListGroup>
                    )}
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Scan")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            {pool.scan.line
                                ? (
                                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'wrap' }}>
                                        {pool.scan.inProgress && (
                                            <Label color="orange" icon={<InProgressIcon />}>
                                                {cockpit.format(_("$0% done"), pool.scan.percent ?? '?')}
                                            </Label>
                                        )}
                                        {pool.scan.paused && <Label color="orange">{_("paused")}</Label>}
                                        <span>{pool.scan.line}</span>
                                    </Flex>
                                )
                                : _("none")}
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Errors")}</DescriptionListTerm>
                        <DescriptionListDescription>{pool.errors || '—'}</DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>

                {pool.statusText && (
                    <Alert variant="warning" title={_("Status")} isInline className="pf-v6-u-mt-md">
                        {pool.statusText}
                    </Alert>
                )}
                {pool.actionText && (
                    <Alert variant="info" title={_("Action")} isInline className="pf-v6-u-mt-sm">
                        {pool.actionText}
                    </Alert>
                )}

                <div className="pf-v6-u-mt-md">
                    <VdevTree pool={pool} refresh={refresh} />
                </div>

                <div className="pf-v6-u-mt-md">
                    <ExpandableSection
                        toggleText={_("Properties")}
                        isExpanded={showProperties}
                        onToggle={(_e, v) => setShowProperties(v)}
                    >
                        <PropertiesTable pool={pool} refresh={refresh} />
                    </ExpandableSection>
                    <RawStatus pool={pool} />
                </div>
            </CardBody>
        </Card>
    );
}

export function PoolsPage({ overview, refresh }: { overview: SystemOverview; refresh: () => void }) {
    return (
        <Stack hasGutter>
            {overview.pools.map(pool => (
                <StackItem key={pool.name}>
                    <PoolCard pool={pool} refresh={refresh} />
                </StackItem>
            ))}
        </Stack>
    );
}
