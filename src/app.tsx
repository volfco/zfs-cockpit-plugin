import React from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Nav, NavItem, NavList } from "@patternfly/react-core/dist/esm/components/Nav/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Badge } from "@patternfly/react-core/dist/esm/components/Badge/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import SearchIcon from "@patternfly/react-icons/dist/esm/icons/search-icon.js";
import SyncIcon from "@patternfly/react-icons/dist/esm/icons/sync-icon.js";
import CubeIcon from "@patternfly/react-icons/dist/esm/icons/cube-icon.js";

import cockpit from 'cockpit';
import type { EventEntry, HistoryEntry, SystemOverview } from './types';
import {
    getCommandLog, subscribeCommandLog, runCommandLine, fetchOverview,
    fetchPoolEvents, fetchPoolHistory, poolEvents,
} from './service';
import { CreatePoolDialog, ImportPoolDialog, RawCommandDialog } from './components/dialogs';
import { useDialogs } from './components/actions';
import { PoolsPage } from './components/poolsPage';
import { DatasetsPage } from './components/datasetsPage';
import { CommandLog } from './components/commandLog';
import { SettingsPage } from './components/settingsPage';

const _ = cockpit.gettext;

// Screen-reader-only caption for the hand-built PF tables.
function TableCaption({ text }: { text: string }) {
    return <caption className="pf-v6-u-screen-reader">{text}</caption>;
}

// ---------------------------------------------------------------------------
// History section — `zpool history` entries with a per-pool filter and the
// -i (include internal) switch.
// ---------------------------------------------------------------------------

function HistorySection({ overview }: { overview: SystemOverview }) {
    const [poolFilter, setPoolFilter] = React.useState('');
    const [internal, setInternal] = React.useState(false);
    const [entries, setEntries] = React.useState<HistoryEntry[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);
        // shortcut: zpool history carries no user attribution (time + command
        // only), so the table has no user column; add one if OpenZFS ever
        // emits it.
        fetchPoolHistory({ ...(poolFilter ? { pool: poolFilter } : {}), incremental: internal })
                .then(found => { if (alive) setEntries(found); })
                .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
                .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false };
    }, [poolFilter, internal]);

    return (
        <StackItem>
            <Flex
                justifyContent={{ default: 'justifyContentSpaceBetween' }}
                alignItems={{ default: 'alignItemsCenter' }}
                flexWrap={{ default: 'wrap' }}
            >
                <FlexItem>
                    <Title headingLevel="h2" size="xl">{_("History")}</Title>
                </FlexItem>
                <Flex spaceItems={{ default: 'spaceItemsMd' }} alignItems={{ default: 'alignItemsCenter' }} flexWrap={{ default: 'wrap' }}>
                    <FormSelect
                        aria-label={_("Filter by pool")}
                        value={poolFilter}
                        onChange={(_e, v) => setPoolFilter(v)}
                    >
                        <FormSelectOption value="" label={_("All pools")} />
                        {overview.pools.map(p => (
                            <FormSelectOption key={p.name} value={p.name} label={p.name} />
                        ))}
                    </FormSelect>
                    <Switch
                        id="zfs-history-internal"
                        label={_("Include internal (-i)")}
                        isChecked={internal}
                        onChange={(_e, v) => setInternal(v)}
                    />
                </Flex>
            </Flex>
            {error && <Alert variant="danger" title={_("Failed to read pool history")} isInline className="pf-v6-u-mt-md">{error}</Alert>}
            {loading && <Spinner size="lg" aria-label={_("Loading pool history")} className="pf-v6-u-mt-md" />}
            {!loading && !error && (
                <div className="zfs-table-region pf-v6-u-mt-md" role="region" aria-label={_("History")} tabIndex={0}>
                    <table className="pf-v6-c-table pf-m-compact pf-m-grid-lg" aria-label={_("History")}>
                        <TableCaption text={_("History")} />
                        <thead className="pf-v6-c-table__thead">
                            <tr className="pf-v6-c-table__tr">
                                <th className="pf-v6-c-table__th" scope="col">{_("Time")}</th>
                                <th className="pf-v6-c-table__th" scope="col">{_("Command")}</th>
                            </tr>
                        </thead>
                        <tbody className="pf-v6-c-table__tbody">
                            {entries.map((e, idx) => (
                                <tr className="pf-v6-c-table__tr" key={`${e.time}-${idx}`}>
                                    <td className="pf-v6-c-table__td zfs-log-time" data-label={_("Time")}>{e.time}</td>
                                    <td className="pf-v6-c-table__td zfs-log-time" data-label={_("Command")}>
                                        <pre className="zfs-history-command">{e.command}</pre>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </StackItem>
    );
}

// ---------------------------------------------------------------------------
// Events section — `zpool events` with verbose/follow switches and a guarded
// "clear events" action.
// ---------------------------------------------------------------------------

function EventsSection() {
    const [verbose, setVerbose] = React.useState(false);
    const [follow, setFollow] = React.useState(false);
    const [entries, setEntries] = React.useState<EventEntry[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const load = React.useCallback(() => {
        setLoading(true);
        setError(null);
        fetchPoolEvents({ verbose })
                .then(setEntries)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setLoading(false));
    }, [verbose]);

    React.useEffect(() => { load() }, [load]);

    // Follow mode polls every 2s; polling stops when the switch is off (and
    // with the component unmounted on tab switch).
    React.useEffect(() => {
        if (!follow) return;
        const timer = window.setInterval(load, 2000);
        return () => window.clearInterval(timer);
    }, [follow, load]);

    const dialogs = useDialogs(load);

    const clearEvents = () => dialogs.openConfirm({
        title: _("Clear events"),
        body: _("Clear the kernel ZFS event log? Existing events are discarded and cannot be recovered."),
        confirmVariant: 'warning',
        confirmLabel: _("Clear events"),
        onConfirm: async () => {
            const out = await poolEvents({ clear: true });
            load();
            return out;
        },
    });

    return (
        <StackItem>
            {dialogs.node}
            <Flex
                justifyContent={{ default: 'justifyContentSpaceBetween' }}
                alignItems={{ default: 'alignItemsCenter' }}
                flexWrap={{ default: 'wrap' }}
            >
                <FlexItem>
                    <Title headingLevel="h2" size="xl">{_("Events")}</Title>
                </FlexItem>
                <Flex spaceItems={{ default: 'spaceItemsMd' }} alignItems={{ default: 'alignItemsCenter' }} flexWrap={{ default: 'wrap' }}>
                    <Switch
                        id="zfs-events-verbose"
                        label={_("Verbose (-v)")}
                        isChecked={verbose}
                        onChange={(_e, v) => setVerbose(v)}
                    />
                    <Switch
                        id="zfs-events-follow"
                        label={_("Follow")}
                        isChecked={follow}
                        onChange={(_e, v) => setFollow(v)}
                    />
                    <Button variant="secondary" size="sm" onClick={clearEvents}>
                        {_("Clear events")}
                    </Button>
                </Flex>
            </Flex>
            {error && <Alert variant="danger" title={_("Failed to read pool events")} isInline className="pf-v6-u-mt-md">{error}</Alert>}
            {loading && entries.length === 0 && <Spinner size="lg" aria-label={_("Loading pool events")} className="pf-v6-u-mt-md" />}
            {entries.length > 0 && (
                <div className="zfs-table-region pf-v6-u-mt-md" role="region" aria-label={_("Events")} tabIndex={0}>
                    <table className="pf-v6-c-table pf-m-compact pf-m-grid-lg" aria-label={_("Events")}>
                        <TableCaption text={_("Events")} />
                        <thead className="pf-v6-c-table__thead">
                            <tr className="pf-v6-c-table__tr">
                                <th className="pf-v6-c-table__th" scope="col">{_("Time")}</th>
                                <th className="pf-v6-c-table__th" scope="col">{_("Class")}</th>
                                <th className="pf-v6-c-table__th" scope="col">{_("Description")}</th>
                            </tr>
                        </thead>
                        <tbody className="pf-v6-c-table__tbody">
                            {entries.map((e, idx) => (
                                <tr className="pf-v6-c-table__tr" key={`${e.time}-${idx}`}>
                                    <td className="pf-v6-c-table__td zfs-log-time" data-label={_("Time")}>{e.time}</td>
                                    <td className="pf-v6-c-table__td" data-label={_("Class")}>{e.class}</td>
                                    <td className="pf-v6-c-table__td" data-label={_("Description")}>
                                        {e.detail
                                            ? <pre className="zfs-history-command">{e.detail}</pre>
                                            : <span className="pf-v6-u-color-200">—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {!loading && !error && entries.length === 0 && (
                <p className="pf-v6-u-color-200 pf-v6-u-mt-md">{_("No events recorded.")}</p>
            )}
        </StackItem>
    );
}

function EventsHistoryPage({ overview }: { overview: SystemOverview }) {
    return (
        <Stack hasGutter>
            <HistorySection overview={overview} />
            <EventsSection />
        </Stack>
    );
}

// ---------------------------------------------------------------------------
// Application shell
// ---------------------------------------------------------------------------

export const Application = () => {
    const [overview, setOverview] = React.useState<SystemOverview | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [tab, setTab] = React.useState('pools');
    const [rawOpen, setRawOpen] = React.useState(false);
    const [createOpen, setCreateOpen] = React.useState(false);
    const [importOpen, setImportOpen] = React.useState(false);

    // `background` refreshes keep the current tab (and any open dialog)
    // mounted, so a command's success/error stays visible in its modal; only
    // the initial load and error retries replace the page with the spinner.
    const loadData = React.useCallback(async (background = false) => {
        if (!background) setLoading(true);
        setError(null);
        try {
            const data = await fetchOverview();
            setOverview(data);
        } catch (e: unknown) {
            // Background failure keeps the stale data instead of unmounting
            // open dialogs; the foreground path surfaces it with the Retry alert.
            if (!background) setError(e instanceof Error ? e.message : String(e));
        } finally {
            if (!background) setLoading(false);
        }
    }, []);

    React.useEffect(() => { loadData() }, [loadData]);

    // Re-render the command-log tab badge when the log changes.
    const [logCount, setLogCount] = React.useState(getCommandLog().length);
    React.useEffect(() => subscribeCommandLog(() => setLogCount(getCommandLog().length)), []);

    let content: React.ReactNode;
    if (loading) {
        content = (
            <PageSection
                isFilled
                className="pf-v6-u-display-flex pf-v6-u-align-items-center pf-v6-u-justify-content-center"
            >
                <Spinner size="xl" aria-label={_("Loading ZFS information")} />
            </PageSection>
        );
    } else if (error) {
        content = (
            <PageSection>
                <Alert
                    variant="danger"
                    title={_("Error loading ZFS information")}
                    isInline
                    actionLinks={
                        <Button variant="link" onClick={() => loadData()} icon={<SyncIcon />}>
                            {_("Retry")}
                        </Button>
                    }
                >
                    {error}
                </Alert>
            </PageSection>
        );
    } else if (!overview) {
        content = null;
    } else if (tab === 'pools') {
        content = (
            <PageSection>
                {overview.pools.length === 0
                    ? (
                        <EmptyState icon={CubeIcon} titleText={_("No ZFS pools found")} headingLevel="h2">
                            <EmptyStateBody>
                                {_("Create a new pool or import an existing one to get started.")}
                            </EmptyStateBody>
                            <Flex spaceItems={{ default: 'spaceItemsSm' }} justifyContent={{ default: 'justifyContentCenter' }}>
                                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                                    {_("Create pool…")}
                                </Button>
                                <Button variant="secondary" onClick={() => setImportOpen(true)}>
                                    {_("Import pool…")}
                                </Button>
                            </Flex>
                        </EmptyState>
                    )
                    : <PoolsPage overview={overview} refresh={() => loadData(true)} />}
            </PageSection>
        );
    } else if (tab === 'datasets') {
        content = (
            <PageSection>
                <DatasetsPage overview={overview} refresh={() => loadData(true)} />
            </PageSection>
        );
    } else if (tab === 'events') {
        content = (
            <PageSection>
                <EventsHistoryPage overview={overview} />
            </PageSection>
        );
    } else if (tab === 'commandlog') {
        content = (
            <PageSection>
                <CommandLog />
            </PageSection>
        );
    } else {
        content = (
            <PageSection>
                <SettingsPage reload={() => loadData(true)} />
            </PageSection>
        );
    }

    return (
        <Page sidebar={null} className="zfs-page ct-page-fill" mainAriaLabel={_("ZFS")}>
            {/* Compact plugin header: this page renders inside the Cockpit
                shell, so no sidebar/masthead chrome of its own. */}
            <PageSection isFilled={false} className="zfs-page-header">
                <Flex
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                    alignItems={{ default: 'alignItemsCenter' }}
                    flexWrap={{ default: 'wrap' }}
                >
                    <FlexItem>
                        <Title headingLevel="h1" size="xl">{_("ZFS Manager")}</Title>
                    </FlexItem>
                    <FlexItem>
                        <Flex spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'wrap' }}>
                            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
                                {_("Create pool…")}
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                                {_("Import pool…")}
                            </Button>
                            <Button variant="secondary" size="sm" icon={<SyncIcon />} onClick={() => loadData(true)}>
                                {_("Refresh")}
                            </Button>
                            <Button variant="secondary" size="sm" icon={<SearchIcon />} onClick={() => setRawOpen(true)}>
                                {_("Run zfs/zpool command…")}
                            </Button>
                        </Flex>
                    </FlexItem>
                </Flex>
            </PageSection>

            {!loading && !error && overview && (
                <PageSection isFilled={false} type="subnav" padding={{ default: 'noPadding' }}>
                    <Nav
                        variant="horizontal-subnav"
                        aria-label={_("ZFS navigation")}
                        onSelect={(_event, result) => setTab(String(result.itemId))}
                    >
                        <NavList>
                            <NavItem itemId="pools" isActive={tab === 'pools'}>
                                {_("Pools")}
                            </NavItem>
                            <NavItem itemId="datasets" isActive={tab === 'datasets'}>
                                {_("Datasets")}
                            </NavItem>
                            <NavItem itemId="events" isActive={tab === 'events'}>
                                {_("Events & History")}
                            </NavItem>
                            <NavItem itemId="commandlog" isActive={tab === 'commandlog'}>
                                <Flex flexWrap={{ default: 'nowrap' }} spaceItems={{ default: 'spaceItemsXs' }} alignItems={{ default: 'alignItemsCenter' }}>
                                    <span>{_("Command log")}</span>
                                    {logCount > 0 && <Badge isRead>{logCount}</Badge>}
                                </Flex>
                            </NavItem>
                            <NavItem itemId="settings" isActive={tab === 'settings'}>
                                {_("Settings")}
                            </NavItem>
                        </NavList>
                    </Nav>
                </PageSection>
            )}

            {content}

            <CreatePoolDialog
                isOpen={createOpen}
                onClose={() => setCreateOpen(false)}
                onSuccess={() => loadData(true)}
            />
            <ImportPoolDialog
                isOpen={importOpen}
                onClose={() => setImportOpen(false)}
                onSuccess={() => loadData(true)}
            />
            <RawCommandDialog
                isOpen={rawOpen}
                onClose={() => { setRawOpen(false); loadData(true) }}
                onRun={runCommandLine}
            />
        </Page>
    );
};
